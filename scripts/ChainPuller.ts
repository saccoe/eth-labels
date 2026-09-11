import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { z } from "zod";
import type { ApiParser } from "./ApiParser/ApiParser";
import type { BrowserFetcher } from "./browser-fetch";
import type { Chain } from "./Chain/Chain";
import { CheerioParser } from "./CheerioParser";
import { classifyAccountPage } from "./classify-account-page";
import { AccountsRepository } from "./db/repositories/AccountsRepository";
import { TokensRepository } from "./db/repositories/TokensRepository";
import { fetchHtml } from "./fetch-html";
import type { HtmlParser } from "./HtmlParser/HtmlParser";
import { ProgressBar } from "./ProgressBar";
import { getRpcUrls } from "./rpc-config";
import {
  clearPageProgress,
  deleteCheckpoint,
  getPageProgress,
  loadCheckpoint,
  markAccountDone,
  markTokenDone,
  pageKey,
  promptResume,
  saveCheckpoint,
  setPageProgress,
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
  /**
   * Native-currency balance as a decimal string, e.g. "0.016363656115590326".
   * Point-in-time; dated by the row's updated_at.
   */
  balance: string | null;
  /** Transaction count at scrape time; dated by the row's updated_at. */
  txnCount: number | null;
};
export type TokenRow = {
  address: Address;
  name: string | null;
  symbol: string | null;
  website: string | null;
  /** Absolute URL, e.g. https://etherscan.io/token/images/foo.svg */
  image: string | null;
  /** Whole dollars at scrape time; dated by the row's updated_at. */
  marketCap: number | null;
  /** Holder count at scrape time; dated by the row's updated_at. */
  holders: number | null;
};
export type AccountRows = Array<AccountRow>;
export type TokenRows = Array<TokenRow>;

/**
 * Etherscan renders at most 100 account rows per request; anything larger
 * returns its error page. Mirrors the token listing's page size.
 */
const ACCOUNT_PAGE_SIZE = 100;

/**
 * How many times a page that is neither a results table nor the end-of-label
 * error page is retried before the scrape gives up and raises.
 */
const ACCOUNT_PAGE_ATTEMPTS = 3;

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

  /**
   * Navigate the token label page and read its subcategory ids off .nav-pills.
   *
   * This navigation is load-bearing beyond discovery: etherscan's token API
   * rejects a POST issued from anywhere but the label page being queried.
   */
  async #discoverSubcatUrls(tokenUrl: string): Promise<Array<string>> {
    const tokenHtml = await fetchHtml(tokenUrl, this.#browserFetcher);
    const subcatIds = this.#selectSubcatIds(tokenHtml, "data-sub-category-id");
    if (subcatIds.length === 0) return [`${tokenUrl}&subcatid=0`];
    return subcatIds.map((id) => `${tokenUrl}&subcatid=${id}`);
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

      // Spread the scraped row rather than listing columns: picking fields by
      // hand silently dropped marketCap and holders when they were added.
      // name and symbol are overridden because they may be RPC-backfilled.
      const newToken = {
        ...tokenRow,
        chainId: this.#chain.chainId,
        label: label,
        name,
        symbol,
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
      const label = z.string().parse(tokenUrl.split("/").pop()?.split("?")[0]);

      for (const subcatUrl of await this.#discoverSubcatUrls(tokenUrl)) {
        // Resume mid-subcategory; everything before this offset is written.
        const resumeFrom = getPageProgress(checkpoint, subcatUrl);
        if (resumeFrom > 0) {
          console.log(`\n  ⏩ Resuming "${label}" from row ${resumeFrom}`);
        }
        const startUrl = subcatUrl.replace(
          /&start=\d+/,
          `&start=${resumeFrom}`,
        );

        await this.#chain.apiPuller.fetchTokens(
          startUrl,
          async (rows, nextStart) => {
            // Write before recording the cursor: a block in between repeats a
            // page, which the unique index absorbs, rather than losing rows.
            await this.#writeTokens(rows, label);
            checkpoint = setPageProgress(checkpoint, subcatUrl, nextStart);
            onProgress(checkpoint);
          },
        );

        checkpoint = clearPageProgress(checkpoint, subcatUrl);
        onProgress(checkpoint);
      }

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
      // Spread the scraped row rather than listing columns: picking fields by
      // hand silently dropped balance and txnCount when they were added.
      const newAccount = {
        ...accountRow,
        chainId: this.#chain.chainId,
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

  /**
   * Read the subcategory ids off a label page.
   *
   * ".nav-pills" alone is not enough: the site's search-panel dropdown carries
   * that class too, so it matches on every page. Anchors are kept only when
   * they actually carry the id attribute, and an empty result means the label
   * has no subcategories — which is currently true of every etherscan label.
   */
  #selectSubcatIds(html: string, attribute: string): Array<string> {
    this.#cheerioParser.loadHtml(html);
    return this.#cheerioParser
      .querySelector(".nav-pills")
      .find("li > a")
      .toArray()
      .map((anchor) => this.#cheerioParser.getAttr(anchor, attribute))
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  #parseAccountPage(accountHtml: string): AccountRows {
    const subcatIds = this.#selectSubcatIds(accountHtml, "val");
    if (subcatIds.length === 0) {
      return this.#chain.htmlPuller.selectAllAccountAddresses(accountHtml, "0");
    }
    let accountRows: AccountRows = [];
    for (const subcatId of subcatIds) {
      accountRows = [
        ...accountRows,
        ...this.#chain.htmlPuller.selectAllAccountAddresses(
          accountHtml,
          subcatId,
        ),
      ];
    }
    return accountRows;
  }

  /**
   * Fetch one page of an account label.
   *
   * Returns null only for a genuine end of the label, which etherscan signals
   * with its error page. Any page that is neither that nor a results table —
   * a Cloudflare interstitial, a 403, a truncated response — is retried and
   * then raised. It must never be reported as an empty page: the caller stops
   * on a short page and marks the label complete, so a blocked request would
   * silently drop every remaining page and never retry it.
   */
  async #pullAccountPage(
    labelUrl: string,
    start: number,
  ): Promise<AccountRows | null> {
    const url = `${pageKey(labelUrl)}&start=${start}`;

    for (let attempt = 1; attempt <= ACCOUNT_PAGE_ATTEMPTS; attempt++) {
      const html = await fetchHtml(url, this.#browserFetcher);

      const kind = classifyAccountPage(html);
      if (kind === "end") return null;
      if (kind === "results") return this.#parseAccountPage(html);

      console.warn(
        `  ⚠️  Unrecognised page for ${url} (attempt ${attempt}/${ACCOUNT_PAGE_ATTEMPTS})`,
      );
      await sleep(attempt * 5_000);
    }

    throw new Error(
      `Could not read ${url} after ${ACCOUNT_PAGE_ATTEMPTS} attempts — ` +
        `refusing to treat it as the end of the label. Progress is ` +
        `checkpointed; rerun to resume from row ${start}.`,
    );
  }

  async #pullAllAccounts(
    accountUrls: Array<string>,
    checkpoint: Checkpoint,
    onProgress: (updated: Checkpoint) => void,
  ) {
    for (const accountUrl of accountUrls) {
      const label = z
        .string()
        .parse(accountUrl.split("/").pop()?.split("?")[0]);

      // Resume mid-label. Everything before this offset is already written.
      let start = getPageProgress(checkpoint, accountUrl);
      if (start > 0) {
        console.log(`\n  ⏩ Resuming "${label}" from row ${start}`);
      }

      for (;;) {
        const randomWait = Math.floor(Math.random() * 1000) + 300;
        await sleep(randomWait);

        const pageRows = await this.#pullAccountPage(accountUrl, start);
        if (pageRows === null) break;

        // Write before advancing the cursor: a block between the two costs a
        // repeated page, which the unique index absorbs, rather than lost rows.
        await this.#writeAccounts(pageRows, label);

        start += ACCOUNT_PAGE_SIZE;
        checkpoint = setPageProgress(checkpoint, accountUrl, start);
        onProgress(checkpoint);

        if (pageRows.length < ACCOUNT_PAGE_SIZE) break;
      }

      checkpoint = clearPageProgress(checkpoint, accountUrl);
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
      pageProgress: {},
    };
    saveCheckpoint(checkpoint);
    return checkpoint;
  }
}
