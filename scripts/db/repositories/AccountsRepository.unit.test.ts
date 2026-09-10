import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { db } from "../database";
import { AccountsRepository } from "./AccountsRepository";

const TEST_ACCOUNTS = [
  {
    chainId: 1,
    address: "0xabc0000000000000000000000000000000000001" as Address,
    label: "coinbase",
    nameTag: "Coinbase: Hot Wallet",
  },
  {
    chainId: 1,
    address: "0xabc0000000000000000000000000000000000002" as Address,
    label: "coinbase",
    nameTag: "Coinbase: Cold Wallet",
  },
  {
    chainId: 1,
    address: "0xabc0000000000000000000000000000000000003" as Address,
    label: "binance",
    nameTag: "Binance: Hot Wallet",
  },
  {
    chainId: 137,
    address: "0xabc0000000000000000000000000000000000001" as Address,
    label: "coinbase",
    nameTag: "Coinbase Polygon",
  },
];

beforeEach(async () => {
  for (const row of TEST_ACCOUNTS) {
    await db
      .insertInto("accounts")
      .values(row)
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
});

afterEach(async () => {
  await db.deleteFrom("accounts").where("address", "like", "0xabc%").execute();
});

describe("AccountsRepository", () => {
  test("selectAllAccounts returns rows", async () => {
    const rows = await AccountsRepository.selectAllAccounts();
    expect(rows.length).toBeGreaterThanOrEqual(TEST_ACCOUNTS.length);
  });

  test("selectAccountsByLabel filters by label", async () => {
    const rows = await AccountsRepository.selectAccountsByLabel("coinbase");
    expect(rows.every((r) => r.label === "coinbase")).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(3); // 2 on ETH + 1 on Polygon
  });

  describe("selectAccountsByAddress", () => {
    test("returns all chains for same address", async () => {
      const rows = await AccountsRepository.selectAccountsByAddress(
        "0xabc0000000000000000000000000000000000001",
      );
      expect(rows.length).toBeGreaterThanOrEqual(2); // chain 1 + chain 137
    });

    test("case-insensitive address search", async () => {
      const address = "0xabc0000000000000000000000000000000000002";
      const rows = await AccountsRepository.selectAccountsByAddress(
        address.toUpperCase() as Address,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.address === address)).toBe(true);
    });
  });
});
