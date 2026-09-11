import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { extractAddress, extractAddressFrom } from "./extract-address";

const ADDRESS = "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE";
const LOWER = ADDRESS.toLowerCase() as Address;

describe("extractAddress", () => {
  test("reads a bare address", () => {
    expect(extractAddress(ADDRESS)).toBe(LOWER);
  });

  test("reads the address out of a name-tagged title", () => {
    // what etherscan renders for an account that has a name tag; a
    // whole-string match rejects this, which broke 99% of account rows
    expect(extractAddress(`Binance\n(${ADDRESS})`)).toBe(LOWER);
    expect(extractAddress(`Binance 10\n(${ADDRESS})`)).toBe(LOWER);
  });

  test("reads the address out of an href", () => {
    expect(extractAddress(`/address/${ADDRESS}`)).toBe(LOWER);
  });

  test("returns null when there is no address", () => {
    expect(extractAddress("Binance")).toBeNull();
    expect(extractAddress("")).toBeNull();
    expect(extractAddress(null)).toBeNull();
    expect(extractAddress(undefined)).toBeNull();
  });

  test("returns null for a truncated address rather than a wrong one", () => {
    expect(extractAddress("0x170c7C38419767816CC7Ec519DA67D1a")).toBeNull();
    expect(extractAddress("0x3f5CE5FB...C936f0bE")).toBeNull();
  });
});

describe("extractAddressFrom", () => {
  test("takes the first candidate that holds an address", () => {
    expect(extractAddressFrom(["Binance", undefined, ADDRESS])).toBe(LOWER);
  });

  test("skips truncated text in favour of a later full address", () => {
    // visible text is truncated on newer *scan UIs, so it must not win
    expect(
      extractAddressFrom([
        "0x170c7C38419767816CC7Ec519DA67D1a",
        `/address/${ADDRESS}`,
      ]),
    ).toBe(LOWER);
  });

  test("returns null when no candidate holds an address", () => {
    expect(extractAddressFrom(["Binance", "", null, undefined])).toBeNull();
  });
});
