/**
 * What a fetched account label page represents.
 *
 * - "results"      a real table page, even if it holds no rows
 * - "end"          past the last row; etherscan serves its error page
 * - "unrecognised" anything else: a Cloudflare interstitial, a 403, a
 *                  truncated response
 *
 * The distinction matters because the pager stops on a short page and marks
 * the label complete. Reporting a blocked page as "end" would silently drop
 * every remaining page of that label and never retry it.
 */
export type AccountPageKind = "results" | "end" | "unrecognised";

const END_MARKER = "We encountered an unexpected error";
/** Present on every real results page, including an empty one. */
const TABLE_MARKER = 'id="table-subcatid-';

export function classifyAccountPage(html: string): AccountPageKind {
  if (html.includes(END_MARKER)) return "end";
  if (html.includes(TABLE_MARKER)) return "results";
  return "unrecognised";
}
