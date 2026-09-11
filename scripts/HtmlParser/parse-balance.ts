/**
 * Normalise a *scan balance cell to a bare decimal string.
 *
 * Cells read "0.016363656115590326 ETH" — the currency varies by explorer and
 * follows from the row's chain_id, so it is dropped. The digits are kept as a
 * string rather than parsed: 18-decimal values are not exactly representable
 * as a float, and the wei integer for a large balance overflows a signed
 * 64-bit column.
 */
export function parseBalance(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /-?\d[\d,]*(\.\d+)?/.exec(raw.trim());
  if (!match) return null;
  return match[0].replace(/,/g, "");
}
