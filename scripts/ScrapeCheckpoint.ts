import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { z } from "zod";

const CHECKPOINT_DIR = join(import.meta.dir, "../data/tmp");

const CheckpointSchema = z.object({
  chainId: z.number(),
  startedAt: z.string(),
  tokenUrls: z.array(z.string()),
  accountUrls: z.array(z.string()),
  completedTokenUrls: z.array(z.string()),
  completedAccountUrls: z.array(z.string()),
  /**
   * Progress *within* a label, as label URL (without its &start= cursor) to the
   * next start offset to fetch. Large labels are hundreds of sequential
   * requests, and a Cloudflare block partway through would otherwise discard
   * every page fetched so far. Defaulted so checkpoints written before this
   * field existed still load.
   */
  pageProgress: z.record(z.string(), z.number()).default({}),
  /**
   * Labels that could not be read at all. A label removed from etherscan
   * redirects to an unrelated page rather than erroring, which the page
   * classifier correctly refuses to treat as an empty label — but one dead
   * label must not abort the whole run, so it is recorded here and skipped.
   * Defaulted so older checkpoints still load.
   */
  failedUrls: z.array(z.string()).default([]),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

function checkpointPath(chainId: number): string {
  return join(CHECKPOINT_DIR, `checkpoint-${chainId}.json`);
}

function ensureDir() {
  if (!existsSync(CHECKPOINT_DIR)) {
    mkdirSync(CHECKPOINT_DIR, { recursive: true });
  }
}

export function loadCheckpoint(chainId: number): Checkpoint | null {
  const path = checkpointPath(chainId);
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return CheckpointSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

export function saveCheckpoint(checkpoint: Checkpoint) {
  ensureDir();
  writeFileSync(
    checkpointPath(checkpoint.chainId),
    JSON.stringify(checkpoint, null, 2),
    "utf-8",
  );
}

export function deleteCheckpoint(chainId: number) {
  const path = checkpointPath(chainId);
  if (existsSync(path)) rmSync(path);
}

export function markTokenDone(checkpoint: Checkpoint, url: string): Checkpoint {
  return {
    ...checkpoint,
    completedTokenUrls: [...checkpoint.completedTokenUrls, url],
  };
}

/**
 * Strip only the pagination cursor, so a label has one stable progress key.
 *
 * Splitting on "&start=" would also discard anything after it — token URLs
 * carry "&subcatid=N", and two subcategories of one label would then collide
 * on the same key and resume at each other's offsets.
 */
export function pageKey(labelUrl: string): string {
  return labelUrl.replace(/&start=\d+/, "");
}

/** Next start offset to fetch for a label; 0 when it has not been started. */
export function getPageProgress(
  checkpoint: Checkpoint,
  labelUrl: string,
): number {
  return checkpoint.pageProgress[pageKey(labelUrl)] ?? 0;
}

/** Record that everything before `nextStart` is written and durable. */
export function setPageProgress(
  checkpoint: Checkpoint,
  labelUrl: string,
  nextStart: number,
): Checkpoint {
  return {
    ...checkpoint,
    pageProgress: {
      ...checkpoint.pageProgress,
      [pageKey(labelUrl)]: nextStart,
    },
  };
}

/** Drop a finished label's page cursor so the checkpoint stays small. */
export function clearPageProgress(
  checkpoint: Checkpoint,
  labelUrl: string,
): Checkpoint {
  const pageProgress = { ...checkpoint.pageProgress };
  delete pageProgress[pageKey(labelUrl)];
  return { ...checkpoint, pageProgress };
}

/** Record a label that could not be read, so the run can move past it. */
export function markFailed(checkpoint: Checkpoint, url: string): Checkpoint {
  if (checkpoint.failedUrls.includes(url)) return checkpoint;
  return { ...checkpoint, failedUrls: [...checkpoint.failedUrls, url] };
}

export function markAccountDone(
  checkpoint: Checkpoint,
  url: string,
): Checkpoint {
  return {
    ...checkpoint,
    completedAccountUrls: [...checkpoint.completedAccountUrls, url],
  };
}

export async function promptResume(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Resume previous scrape? [y/N] ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
