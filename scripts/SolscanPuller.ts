import { z } from "zod";
import type { BrowserFetcher } from "./browser-fetch";
import { AccountsRepository } from "./db/repositories/AccountsRepository";
import { TokensRepository } from "./db/repositories/TokensRepository";
import { ProgressBar } from "./ProgressBar";
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

export const SOLANA_CHAIN_ID = 900;
const BASE_API = "https://api-v2.solscan.io/v2";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const labelListSchema = z.object({
  success: z.literal(true),
  data: z.array(
    z.object({
      tag: z.string(),
      tag_name: z.string(),
      info: z.array(
        z.object({
          type: z.enum(["account", "token"]),
          count: z.number(),
        }),
      ),
    }),
  ),
});

const labelDetailSchema = z.object({
  success: z.literal(true),
  data: z.array(
    z.object({
      address: z.string(),
      type: z.enum(["account", "token"]),
    }),
  ),
  metadata: z
    .object({
      accounts: z
        .record(
          z.object({
            account_label: z.string().optional(),
          }),
        )
        .optional(),
    })
    .passthrough()
    .optional(),
});

type LabelEntry = z.infer<typeof labelListSchema>["data"][number];

// ── SolscanPuller ──────────────────────────────────────────────────────────────

export class SolscanPuller {
  #browserFetcher: BrowserFetcher;
  #progressBar = new ProgressBar();

  public constructor(browserFetcher: BrowserFetcher) {
    this.#browserFetcher = browserFetcher;
  }

  async #fetchApi(path: string): Promise<unknown> {
    const text = await this.#browserFetcher.fetchFromPageContext(
      `${BASE_API}${path}`,
    );
    return JSON.parse(text) as unknown;
  }

  async #fetchLabelList(): Promise<Array<LabelEntry>> {
    const raw = await this.#fetchApi("/label-cloud/list");
    return labelListSchema.parse(raw).data;
  }

  async #fetchAddresses(
    tag: string,
    type: "account" | "token",
  ): Promise<Array<{ address: string; nameTag: string | null }>> {
    const raw = await this.#fetchApi(
      `/label-cloud/detail?tag=${encodeURIComponent(tag)}&type=${type}`,
    );
    const parsed = labelDetailSchema.parse(raw);
    const accountsMeta: Partial<Record<string, { account_label?: string }>> =
      parsed.metadata?.accounts ?? {};

    return parsed.data.map((item) => ({
      address: item.address,
      nameTag: accountsMeta[item.address]?.account_label ?? null,
    }));
  }

  async #writeAccounts(
    entries: Array<{ address: string; nameTag: string | null }>,
    label: string,
  ): Promise<void> {
    this.#progressBar.startLabel(label, entries.length);
    for (const { address, nameTag } of entries) {
      try {
        await AccountsRepository.insertAccount({
          chainId: SOLANA_CHAIN_ID,
          address: address as `0x${string}`,
          label,
          nameTag: nameTag ?? "",
        });
      } catch (e) {
        console.warn(`issue inserting account ${address}`, e);
      }
      this.#progressBar.stepAddress();
    }
  }

  async #writeTokens(
    entries: Array<{ address: string; nameTag: string | null }>,
    label: string,
  ): Promise<void> {
    this.#progressBar.startLabel(label, entries.length);
    for (const { address } of entries) {
      try {
        await TokensRepository.insertToken({
          chainId: SOLANA_CHAIN_ID,
          address: address as `0x${string}`,
          label,
          name: null,
          symbol: null,
          website: null,
          image: null,
        });
      } catch (e) {
        console.warn(`issue inserting token ${address}`, e);
      }
      this.#progressBar.stepAddress();
    }
  }

  #initCheckpoint(labels: Array<LabelEntry>): Checkpoint {
    const tokenUrls: Array<string> = [];
    const accountUrls: Array<string> = [];
    for (const label of labels) {
      for (const info of label.info) {
        const url = `solscan:${info.type}:${label.tag}`;
        if (info.type === "token") tokenUrls.push(url);
        else accountUrls.push(url);
      }
    }
    const checkpoint: Checkpoint = {
      chainId: SOLANA_CHAIN_ID,
      startedAt: new Date().toISOString(),
      tokenUrls,
      accountUrls,
      completedTokenUrls: [],
      completedAccountUrls: [],
    };
    saveCheckpoint(checkpoint);
    return checkpoint;
  }

  public async pullAndWriteAllLabels(): Promise<void> {
    // Establish session on solscan.io before making API calls
    console.log("\n🌐 Navigating to Solscan...");
    await this.#browserFetcher.navigateAndGetHtml(
      "https://solscan.io/labelcloud",
    );

    // Check for existing checkpoint
    const existing = loadCheckpoint(SOLANA_CHAIN_ID);
    let checkpoint: Checkpoint;

    if (existing) {
      const doneTokens = existing.completedTokenUrls.length;
      const doneAccounts = existing.completedAccountUrls.length;
      console.log(
        `\n⚠️  Found a checkpoint from ${existing.startedAt} for Solana`,
      );
      console.log(
        `   Tokens:   ${doneTokens}/${existing.tokenUrls.length} done`,
      );
      console.log(
        `   Accounts: ${doneAccounts}/${existing.accountUrls.length} done`,
      );
      const shouldResume = await promptResume();
      if (shouldResume) {
        checkpoint = existing;
        console.log(`\n▶️  Resuming from checkpoint...`);
      } else {
        deleteCheckpoint(SOLANA_CHAIN_ID);
        console.log("\n📋 Fetching label list...");
        const labels = await this.#fetchLabelList();
        checkpoint = this.#initCheckpoint(labels);
      }
    } else {
      console.log("\n📋 Fetching label list...");
      const labels = await this.#fetchLabelList();
      checkpoint = this.#initCheckpoint(labels);
    }

    const completedTokenSet = new Set(checkpoint.completedTokenUrls);
    const completedAccountSet = new Set(checkpoint.completedAccountUrls);
    const remainingTokens = checkpoint.tokenUrls.filter(
      (u) => !completedTokenSet.has(u),
    );
    const remainingAccounts = checkpoint.accountUrls.filter(
      (u) => !completedAccountSet.has(u),
    );

    const total = checkpoint.tokenUrls.length + checkpoint.accountUrls.length;
    const completed =
      checkpoint.completedTokenUrls.length +
      checkpoint.completedAccountUrls.length;

    console.log(
      `\n🐢 Pulling Solana labels... (${remainingTokens.length + remainingAccounts.length} remaining)`,
    );
    this.#progressBar.start(total, completed);

    // Pull tokens
    for (const url of remainingTokens) {
      const tag = url.split(":")[2];
      try {
        const entries = await this.#fetchAddresses(tag, "token");
        await this.#writeTokens(entries, tag);
        checkpoint = markTokenDone(checkpoint, url);
        saveCheckpoint(checkpoint);
      } catch (e) {
        console.warn(`  ⚠️  Failed to fetch tokens for tag "${tag}":`, e);
      }
      this.#progressBar.step();
      await sleep(Math.floor(Math.random() * 500) + 300);
    }

    // Pull accounts
    for (const url of remainingAccounts) {
      const tag = url.split(":")[2];
      try {
        const entries = await this.#fetchAddresses(tag, "account");
        await this.#writeAccounts(entries, tag);
        checkpoint = markAccountDone(checkpoint, url);
        saveCheckpoint(checkpoint);
      } catch (e) {
        console.warn(`  ⚠️  Failed to fetch accounts for tag "${tag}":`, e);
      }
      this.#progressBar.step();
      await sleep(Math.floor(Math.random() * 500) + 300);
    }

    this.#progressBar.stop();
    deleteCheckpoint(SOLANA_CHAIN_ID);
    console.log(`\n✅ Solana scrape complete!`);
  }
}
