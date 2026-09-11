import type { Address } from "viem";

const ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/;

/**
 * Pull a 0x address out of a *scan table cell attribute.
 *
 * The attribute is not always a bare address. An account with a name tag has
 * its anchor's data-bs-title rendered as the tag, a newline, then the address
 * in parentheses — "Binance (0x3f5CE5…)" — and newer
 * *scan UIs truncate the visible link text ("0x170c7C38…43826"), so matching
 * the whole string against an address pattern rejects almost every row.
 * Search for the address inside the candidate instead.
 *
 * Returns a lowercased address, or null when the candidate holds none.
 */
export function extractAddress(
  candidate: string | null | undefined,
): Address | null {
  if (!candidate) return null;
  const match = ADDRESS_PATTERN.exec(candidate);
  return match ? (match[0].toLowerCase() as Address) : null;
}

/**
 * Try several attributes in turn, returning the first that holds an address.
 * Visible text is tried last because it is the one most likely truncated.
 */
export function extractAddressFrom(
  candidates: ReadonlyArray<string | null | undefined>,
): Address | null {
  for (const candidate of candidates) {
    const address = extractAddress(candidate);
    if (address) return address;
  }
  return null;
}
