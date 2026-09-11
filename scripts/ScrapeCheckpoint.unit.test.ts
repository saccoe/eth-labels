import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  clearPageProgress,
  deleteCheckpoint,
  getPageProgress,
  loadCheckpoint,
  pageKey,
  saveCheckpoint,
  setPageProgress,
  type Checkpoint,
} from "./ScrapeCheckpoint";

const CHECKPOINT_DIR = join(import.meta.dir, "../data/tmp");
const TEST_CHAIN_ID = 999999;

const baseCheckpoint = (): Checkpoint => ({
  chainId: TEST_CHAIN_ID,
  startedAt: new Date().toISOString(),
  tokenUrls: [],
  accountUrls: ["https://etherscan.io/accounts/label/binance?size=100&start=0"],
  completedTokenUrls: [],
  completedAccountUrls: [],
  pageProgress: {},
});

afterEach(() => deleteCheckpoint(TEST_CHAIN_ID));

describe("pageKey", () => {
  test("strips the pagination cursor so one label has one key", () => {
    const key = "https://etherscan.io/accounts/label/binance?size=100";
    expect(pageKey(`${key}&start=0`)).toBe(key);
    expect(pageKey(`${key}&start=400`)).toBe(key);
    // a label already without a cursor is returned unchanged
    expect(pageKey(key)).toBe(key);
  });

  test("keeps params after the cursor so token subcategories stay distinct", () => {
    const base = "https://etherscan.io/tokens/label/defi?size=100";
    const sub0 = pageKey(`${base}&start=0&subcatid=0`);
    const sub1 = pageKey(`${base}&start=0&subcatid=1`);
    expect(sub0).toBe(`${base}&subcatid=0`);
    expect(sub1).toBe(`${base}&subcatid=1`);
    // distinct subcategories must not share one progress entry
    expect(sub0).not.toBe(sub1);
    // and the same subcategory at a different offset must resolve to one key
    expect(pageKey(`${base}&start=400&subcatid=0`)).toBe(sub0);
  });
});

describe("page progress", () => {
  const url = "https://etherscan.io/accounts/label/binance?size=100&start=0";

  test("is zero for a label that has not been started", () => {
    expect(getPageProgress(baseCheckpoint(), url)).toBe(0);
  });

  test("round-trips regardless of the cursor on the url", () => {
    const saved = setPageProgress(baseCheckpoint(), url, 300);
    // the same label read back via a different cursor still resolves
    const withOtherCursor = url.replace("start=0", "start=300");
    expect(getPageProgress(saved, withOtherCursor)).toBe(300);
  });

  test("clearing drops the label so finished labels do not accumulate", () => {
    const saved = setPageProgress(baseCheckpoint(), url, 300);
    const cleared = clearPageProgress(saved, url);
    expect(getPageProgress(cleared, url)).toBe(0);
    expect(Object.keys(cleared.pageProgress)).toHaveLength(0);
  });

  test("survives a save/load round trip, which is the point of resuming", () => {
    saveCheckpoint(setPageProgress(baseCheckpoint(), url, 500));
    expect(getPageProgress(loadCheckpoint(TEST_CHAIN_ID)!, url)).toBe(500);
  });
});

describe("backward compatibility", () => {
  test("loads a checkpoint written before pageProgress existed", () => {
    if (!existsSync(CHECKPOINT_DIR))
      mkdirSync(CHECKPOINT_DIR, { recursive: true });
    const legacy = {
      chainId: TEST_CHAIN_ID,
      startedAt: new Date().toISOString(),
      tokenUrls: [],
      accountUrls: [
        "https://etherscan.io/accounts/label/aave?size=100&start=0",
      ],
      completedTokenUrls: [],
      completedAccountUrls: [],
    };
    const path = join(CHECKPOINT_DIR, `checkpoint-${TEST_CHAIN_ID}.json`);
    writeFileSync(path, JSON.stringify(legacy), "utf-8");

    const loaded = loadCheckpoint(TEST_CHAIN_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.pageProgress).toEqual({});
    rmSync(path, { force: true });
  });
});
