import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Address } from "viem";
import type {
  AccountRow,
  AccountRows,
  TokenRow,
  TokenRows,
} from "../ChainPuller";
import { extractAddressFrom } from "./extract-address";
import { HtmlParser } from "./HtmlParser";

/**
 * Prefer full addresses from attributes over truncated visible text, and pull
 * the address out of composite values: an account with a name tag renders as
 * the tag, a newline, then the address in parentheses, which a whole-string
 * match rejects.
 */
function extractAddressFromAnchor(
  anchor: cheerio.Cheerio<Element>,
): Address | null {
  return extractAddressFrom([
    anchor.attr("data-bs-title"),
    anchor.attr("data-original-title"),
    anchor.attr("data-highlight-target"),
    anchor.attr("data"),
    anchor.attr("href"),
    anchor.text(),
  ]);
}

export class OptimismHtmlParser extends HtmlParser {
  public selectAllAccountAddresses(html: string): AccountRows {
    const $ = cheerio.load(html);
    const selector = `#table-subcatid-0 > tbody`;
    const tableElements = $(selector);
    const parent = tableElements.last();

    let addressesInfo: AccountRows = [];
    parent.find("tr").each((_index, tableRow) => {
      const tableCells = $(tableRow).find("td");

      const anchor = $(tableCells[0]).find("a").first();
      const address = extractAddressFromAnchor(anchor);
      if (!address) return;

      const newAddressInfo: AccountRow = {
        address,
        nameTag: $(tableCells[1]).text().trim(),
      };

      addressesInfo = [...addressesInfo, newAddressInfo];
    });

    return addressesInfo;
  }
  public selectAllTokenAddresses(html: string): TokenRows {
    const $ = cheerio.load(html);
    const selector = `#table-subcatid-0 > tbody`;
    const tableElements = $(selector);
    const parent = tableElements.last();

    let addressesInfo: TokenRows = [];
    parent.find("tr").each((_index, tableRow) => {
      const tableCells = $(tableRow).find("td");

      const anchor = $(tableCells[1]).find("a").first();
      const address = extractAddressFromAnchor(anchor);
      if (!address) return;

      const tokenNameColumn = $(tableCells[2]).text().trim();

      const regex = /^(.*)\s\((.*)\)/;
      const match = tokenNameColumn.match(regex);
      const tokenName = match?.[1];
      const tokenSymbol = match?.[2];
      const website = (
        $(tableCells[5]).find("a").attr("data-original-title") || ""
      ).toLowerCase();
      const tokenRow: TokenRow = {
        address,
        name: tokenName || "",
        symbol: tokenSymbol || "",
        website,
        image: null, // TODO: Add image parsing here
        // Market data comes from the API path (ApiParser.fetchTokens);
        // these HTML token parsers are not on the live scrape path.
        marketCap: null,
        holders: null,
      };

      addressesInfo = [...addressesInfo, tokenRow];
    });
    return addressesInfo;
  }
}
