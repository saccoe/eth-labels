import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Address } from "viem";
import { z } from "zod";
import { app } from ".";
import { db } from "../scripts/db/database";

const fetchLocally = async (path: string) => {
  return app
    .handle(new Request(`http://localhost:3000${path}`))
    .then((res) => res.json());
};

const TEST_ACCOUNTS = [
  {
    chainId: 1,
    address: "0xaaa0000000000000000000000000000000000001" as Address,
    label: "coinbase",
    nameTag: "Coinbase 8",
  },
  {
    chainId: 1,
    address: "0xaaa0000000000000000000000000000000000002" as Address,
    label: "phish-hack",
    nameTag: "Fake_Phishing8",
  },
];

const TEST_TOKENS = [
  {
    chainId: 1,
    address: "0xaaa0000000000000000000000000000000000010" as Address,
    label: "defi",
    name: "Ubeswap",
    symbol: "UBE",
  },
  {
    chainId: 1,
    address: "0xaaa0000000000000000000000000000000000011" as Address,
    label: "defi",
    name: "Ubeswap V2",
    symbol: "UBE2",
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
  for (const row of TEST_TOKENS) {
    await db
      .insertInto("tokens")
      .values(row)
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
});

afterEach(async () => {
  await db.deleteFrom("accounts").where("address", "like", "0xaaa%").execute();
  await db.deleteFrom("tokens").where("address", "like", "0xaaa%").execute();
});

describe("Elysia", () => {
  it("/labels returns distinct labels", async () => {
    const labels = z.array(z.string()).parse(await fetchLocally("/labels"));
    expect(labels).toContain("coinbase");
    expect(labels).toContain("defi");
    expect(new Set(labels).size).toBe(labels.length); // no duplicates
  });

  it("/accounts filters by nameTag case-insensitively", async () => {
    const accounts = z
      .array(z.object({ address: z.string(), nameTag: z.string() }))
      .parse(await fetchLocally("/accounts?nameTag=COINBASE%208&chainId=1"));
    expect(accounts.length).toBeGreaterThanOrEqual(1);
    expect(
      accounts.every((a) => a.nameTag.toLowerCase().includes("coinbase 8")),
    ).toBe(true);
  });

  it("/accounts filters by address case-insensitively", async () => {
    const address = "0xaaa0000000000000000000000000000000000002";
    const accounts = z
      .array(z.object({ address: z.string(), nameTag: z.string() }))
      .parse(await fetchLocally(`/accounts?address=${address.toUpperCase()}`));
    expect(accounts.length).toBeGreaterThanOrEqual(1);
    expect(accounts.every((a) => a.address === address)).toBe(true);
  });

  it("/tokens filters by name and symbol case-insensitively", async () => {
    const tokens = z
      .array(
        z.object({
          address: z.string(),
          label: z.string(),
          name: z.string(),
          symbol: z.string(),
        }),
      )
      .parse(await fetchLocally("/tokens?name=uBeSwAp&symbol=uBe"));
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(tokens.every((t) => t.name.toLowerCase().includes("ubeswap"))).toBe(
      true,
    );
  });
});
