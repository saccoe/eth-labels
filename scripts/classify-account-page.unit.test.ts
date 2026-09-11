import { describe, expect, test } from "bun:test";
import { classifyAccountPage } from "./classify-account-page";

describe("classifyAccountPage", () => {
  test("a results table is results, even with no rows", () => {
    expect(
      classifyAccountPage('<div id="table-subcatid-0"><tbody></tbody></div>'),
    ).toBe("results");
    expect(
      classifyAccountPage(
        '<table id="table-subcatid-0"><tbody><tr><td>x</td></tr></tbody></table>',
      ),
    ).toBe("results");
  });

  test("a table for a non-zero subcategory is still results", () => {
    expect(classifyAccountPage('<div id="table-subcatid-3">')).toBe("results");
  });

  test("etherscan's error page means past the end of the label", () => {
    expect(
      classifyAccountPage(
        "<h1>Sorry!</h1><p>We encountered an unexpected error.</p>",
      ),
    ).toBe("end");
  });

  test("a Cloudflare interstitial is unrecognised, never the end", () => {
    // the case that matters: reported as "end", the pager would mark the label
    // complete and silently drop every remaining page
    expect(
      classifyAccountPage("<title>Just a moment...</title><body></body>"),
    ).toBe("unrecognised");
  });

  test("a blank or truncated response is unrecognised", () => {
    expect(classifyAccountPage("")).toBe("unrecognised");
    expect(classifyAccountPage("<html><body></body></html>")).toBe(
      "unrecognised",
    );
    expect(classifyAccountPage("<h1>403 Forbidden</h1>")).toBe("unrecognised");
  });

  test("the end marker wins when an error page also mentions a table", () => {
    expect(
      classifyAccountPage(
        'We encountered an unexpected error <div id="table-subcatid-0">',
      ),
    ).toBe("end");
  });
});
