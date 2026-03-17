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
