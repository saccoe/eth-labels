import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { z } from "zod";
import type { ApiParser } from "./ApiParser/ApiParser";
import type { BrowserFetcher } from "./browser-fetch";
import type { Chain } from "./Chain/Chain";
import { CheerioParser } from "./CheerioParser";
import { AccountsRepository } from "./db/repositories/AccountsRepository";
import { TokensRepository } from "./db/repositories/TokensRepository";
import { fetchHtml } from "./fetch-html";
import type { HtmlParser } from "./HtmlParser/HtmlParser";
import { ProgressBar } from "./ProgressBar";
import { getRpcUrls } from "./rpc-config";
import {
  deleteCheckpoint,
  loadCheckpoint,
  markAccountDone,
  markTokenDone,
  promptResume,
  saveCheckpoint,
  type Checkpoint,
} from "./ScrapeCheckpoint";
import { sleep } from "./utils/sleep";

type AllLabels = {
  accounts: Array<string>;
  tokens: Array<string>;
  blocks: ReadonlyArray<string>;
};
export type AccountRow = {
  address: Address;
  nameTag: string | null;
};
export type TokenRow = {
  address: Address;
  name: string | null;
  symbol: string | null;
  website: string | null;
  image: string | null;
};
export type AccountRows = Array<AccountRow>;
export type TokenRows = Array<TokenRow>;

/**
 * Labels where RPC metadata lookups are skipped.
 * Addresses in these categories are the valuable data — name/symbol don't matter.
 */
const SECURITY_LABELS = new Set([
  "spam",
  "suspicious",
  "phish-hack",
  "heist",
  "fake-icos",
]);

/**
 * Pulls and writes everything for a given chain
 */
export class ChainPuller {
  #chain: Chain<ApiParser, HtmlParser>;
  #cheerioParser = new CheerioParser();
  #progressBar = new ProgressBar();
  #browserFetcher: BrowserFetcher;

  public baseUrl: string;

  private constructor(
    chain: Chain<ApiParser, HtmlParser>,
    browserFetcher: BrowserFetcher,
  ) {
    this.#chain = chain;
    this.baseUrl = chain.website;
    this.#browserFetcher = browserFetcher;
    this.#chain.apiPuller.setBrowserFetcher(browserFetcher);
  }

  public static async init(
    chain: Chain<ApiParser, HtmlParser>,
    browserFetcher: BrowserFetcher,
  ) {
    const self = new ChainPuller(chain, browserFetcher);
    return Promise.resolve(self);
  }

  async #pullAllLabels() {
    const labelCloudHtml = await fetchHtml(
      `${this.baseUrl}/labelcloud`,
      this.#browserFetcher,
    );

    const allAnchors = z
      .array(z.string().url().startsWith("https://"))
      .parse(
        this.#cheerioParser
          .selectAllLabels(labelCloudHtml)
          .map((anchor) => `${this.baseUrl}${anchor}`),
      );
    const allLabels: AllLabels = { accounts: [], tokens: [], blocks: [] };
    allAnchors.forEach((url) => {
      if (url.includes("/accounts/")) {
        allLabels.accounts = [...allLabels.accounts, url];
      } else if (url.includes("/tokens/")) {
        allLabels.tokens = [...allLabels.tokens, url];
      } else if (url.includes("/blocks/")) {
        allLabels.blocks = [...allLabels.blocks, url];
      } else if (url.includes("/txs/")) {
        // ignore these for now
      } else {
        throw new Error(
          `url "${url}" does not belong to "accounts", "tokens", "blocks", nor "txs"`,
        );
      }
    });
    return allLabels;
  }

  async #pullTokens(tokenUrl: string) {
    const tokenHtml = await fetchHtml(tokenUrl, this.#browserFetcher);
    this.#cheerioParser.loadHtml(tokenHtml);
    const navPills = this.#cheerioParser.querySelector(".nav-pills");
    let subcatUrlsToPull: Array<string> = [];
    if (navPills.length > 0) {
      const anchors = navPills.find("li > a");
      const subcatIds: Array<string> = anchors.toArray().map((anchor) => {
        const subcatId = z
          .string()
          .parse(this.#cheerioParser.getAttr(anchor, "data-sub-category-id"));
        return subcatId;
      });
      for (const subcatId of subcatIds) {
        const subcatUrl = `${tokenUrl}&subcatid=${subcatId}`;
        subcatUrlsToPull = [...subcatUrlsToPull, subcatUrl];
      }
    } else {
      subcatUrlsToPull = [`${tokenUrl}&subcatid=0`];
    }
    let tokenRows: TokenRows = [];
    for (const subcatUrl of subcatUrlsToPull) {
      tokenRows = [
        ...tokenRows,
        ...(await this.#chain.apiPuller.fetchTokens(subcatUrl)),
      ];
    }
    return tokenRows;
  }

  async #fetchErc20Metadata(
    address: Address,
  ): Promise<{ name: string | null; symbol: string | null }> {
    const rpcUrls = getRpcUrls(this.#chain.chainId);

    for (const rpcUrl of rpcUrls) {
      try {
        const client = createPublicClient({ transport: http(rpcUrl) });
        const [name, symbol] = await Promise.all([
          client
            .readContract({ address, abi: erc20Abi, functionName: "name" })
            .catch(() => null),
          client
            .readContract({ address, abi: erc20Abi, functionName: "symbol" })
            .catch(() => null),
        ]);
        if (name || symbol)
          return { name: name ?? null, symbol: symbol ?? null };
      } catch {
        // try next rpc
      }
    }

    return { name: null, symbol: null };
  }

  async #writeTokens(tokenRows: TokenRows, label: string) {
    const shouldSkipRpc = SECURITY_LABELS.has(label);
    this.#progressBar.startLabel(label, tokenRows.length);
    for (const tokenRow of tokenRows) {
      let { name, symbol } = tokenRow;

      if (!shouldSkipRpc && (!name || !symbol)) {
        const onChain = await this.#fetchErc20Metadata(tokenRow.address);
        name = name ?? onChain.name;
        symbol = symbol ?? onChain.symbol;
        if (onChain.name || onChain.symbol) {
          console.log(
            `  ⛓️ Fetched on-chain metadata for ${tokenRow.address}: name=${name}, symbol=${symbol}`,
          );
        }
      }

      const newToken = {
        chainId: this.#chain.chainId,
        address: tokenRow.address,
        label: label,
        name,
        symbol,
        website: tokenRow.website,
        image: tokenRow.image,
      };
      try {
        await TokensRepository.insertToken(newToken);
      } catch (e) {
        console.log("issue with token ", newToken);
        console.warn(e);
      }
      this.#progressBar.stepAddress();
    }
  }

  async #pullAllTokens(
    tokenUrls: Array<string>,
    checkpoint: Checkpoint,
    onProgress: (updated: Checkpoint) => void,
  ) {
    for (const tokenUrl of tokenUrls) {
      const tokenRows = await this.#pullTokens(tokenUrl);
      const label = z.string().parse(tokenUrl.split("/").pop()?.split("?")[0]);
      await this.#writeTokens(tokenRows, label);
      checkpoint = markTokenDone(checkpoint, tokenUrl);
      onProgress(checkpoint);
      this.#progressBar.step();
      const randomWait = Math.floor(Math.random() * 500) + 500;
      await sleep(randomWait);
    }
    return checkpoint;
  }

  async #writeAccounts(accountRows: AccountRows, label: string) {
    this.#progressBar.startLabel(label, accountRows.length);
    for (const accountRow of accountRows) {
      const newAccount = {
        chainId: this.#chain.chainId,
        address: accountRow.address,
        label: label,
        nameTag: accountRow.nameTag ?? "",
      };
      try {
        await AccountsRepository.insertAccount(newAccount);
      } catch (e) {
        console.warn("issue inserting account ", newAccount);
        console.warn(e);
      }
      this.#progressBar.stepAddress();
    }
  }

  async #pullAccountStaging(accountUrl: string) {
    const accountHtml = await fetchHtml(accountUrl, this.#browserFetcher);
    this.#cheerioParser.loadHtml(accountHtml);
    const navPills = this.#cheerioParser.querySelector(".nav-pills");
    let accountRows: AccountRows = [];
    if (navPills.length > 0) {
      const anchors = navPills.find("li > a");
      const subcatIds: Array<string> = anchors.toArray().map((anchor) => {
        const subcatId = z
          .string()
          .parse(this.#cheerioParser.getAttr(anchor, "val"));
        return subcatId;
      });
      for (const subcatId of subcatIds) {
        const subcatAccounts = this.#chain.htmlPuller.selectAllAccountAddresses(
          accountHtml,
          subcatId,
        );
        accountRows = [...accountRows, ...subcatAccounts];
      }
    } else {
      accountRows = this.#chain.htmlPuller.selectAllAccountAddresses(
        accountHtml,
        "0",
      );
    }
    return accountRows;
  }

  async #pullAllAccounts(
    accountUrls: Array<string>,
    checkpoint: Checkpoint,
    onProgress: (updated: Checkpoint) => void,
  ) {
    for (const accountUrl of accountUrls) {
      const randomWait = Math.floor(Math.random() * 1000) + 300;
      await sleep(randomWait);
      const accountRows = await this.#pullAccountStaging(accountUrl);
      const label = z
        .string()
        .parse(accountUrl.split("/").pop()?.split("?")[0]);
      await this.#writeAccounts(accountRows, label);
      checkpoint = markAccountDone(checkpoint, accountUrl);
      onProgress(checkpoint);
      this.#progressBar.step();
    }
    return checkpoint;
  }

  public async pullAndWriteAllLabels() {
    const chainId = this.#chain.chainId;

    // Check for an existing checkpoint
    const existing = loadCheckpoint(chainId);
    let checkpoint: Checkpoint;

    if (existing) {
      const doneTokens = existing.completedTokenUrls.length;
      const doneAccounts = existing.completedAccountUrls.length;
      const totalTokens = existing.tokenUrls.length;
      const totalAccounts = existing.accountUrls.length;
      console.log(
        `\n⚠️  Found a checkpoint from ${existing.startedAt} for chain ${chainId}`,
      );
      console.log(`   Tokens:   ${doneTokens}/${totalTokens} done`);
      console.log(`   Accounts: ${doneAccounts}/${totalAccounts} done`);
      const shouldResume = await promptResume();
      if (shouldResume) {
        checkpoint = existing;
        console.log(`\n▶️  Resuming from checkpoint...`);
      } else {
        deleteCheckpoint(chainId);
        checkpoint = await this.#initCheckpoint(chainId);
      }
    } else {
      checkpoint = await this.#initCheckpoint(chainId);
    }

    const completedTokenSet = new Set(checkpoint.completedTokenUrls);
    const completedAccountSet = new Set(checkpoint.completedAccountUrls);
    const remainingTokens = checkpoint.tokenUrls.filter(
      (u) => !completedTokenSet.has(u),
    );
    const remainingAccounts = checkpoint.accountUrls.filter(
      (u) => !completedAccountSet.has(u),
    );

    const onProgress = (updated: Checkpoint) => saveCheckpoint(updated);

    console.log(`\n🐢 Pulling tokens... (${remainingTokens.length} remaining)`);
    this.#progressBar.start(
      checkpoint.tokenUrls.length,
      checkpoint.completedTokenUrls.length,
    );
    checkpoint = await this.#pullAllTokens(
      remainingTokens,
      checkpoint,
      onProgress,
    );
    console.log(`\n✅ Tokens completed!`);

    console.log(
      `\n🐢 Pulling accounts... (${remainingAccounts.length} remaining)`,
    );
    this.#progressBar.start(
      checkpoint.accountUrls.length,
      checkpoint.completedAccountUrls.length,
    );
    checkpoint = await this.#pullAllAccounts(
      remainingAccounts,
      checkpoint,
      onProgress,
    );
    console.log(`\n✅ Accounts completed!`);

    deleteCheckpoint(chainId);
    console.log(`\n🗑️  Checkpoint cleared.`);
  }

  async #initCheckpoint(chainId: number): Promise<Checkpoint> {
    const scrapeStartedAt = new Date().toISOString();
    console.log(`\n🕐 Scrape started at ${scrapeStartedAt}`);
    const labels = await this.#pullAllLabels();
    const checkpoint: Checkpoint = {
      chainId,
      startedAt: scrapeStartedAt,
      tokenUrls: labels.tokens,
      accountUrls: labels.accounts,
      completedTokenUrls: [],
      completedAccountUrls: [],
    };
    saveCheckpoint(checkpoint);
    return checkpoint;
  }
}
