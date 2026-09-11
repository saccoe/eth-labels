import * as cheerio from "cheerio";
import type { Address } from "viem";
import { parseFormattedNumber } from "../ApiParser/ApiParser";
import type {
  AccountRow,
  AccountRows,
  TokenRow,
  TokenRows,
} from "../ChainPuller";
import { extractAddressFrom } from "./extract-address";
import { HtmlParser } from "./HtmlParser";
import { parseBalance } from "./parse-balance";

export class BscscanHtmlParser extends HtmlParser {
  public selectAllAccountAddresses(html: string): AccountRows {
    const $ = cheerio.load(html);
    const selector = `#table-subcatid-0 > tbody`;
    const tableElements = $(selector);
    const parent = tableElements.last();

    let addressesInfo: AccountRows = [];
    parent.find("tr").each((index, tableRow) => {
      const tableCells = $(tableRow).find("td");

      const span = $(tableCells[0]).find("a > span");
      const address = extractAddressFrom([
        span.attr("data-highlight-target"),
        $(tableCells[0]).find("a").attr("href"),
        span.text(),
      ]);
      if (!address) return;

      const newAddressInfo: AccountRow = {
        address,
        nameTag: $(tableCells[1]).text().trim(),
        balance: parseBalance(
          $(tableCells[2]).find("[data-bs-title]").attr("data-bs-title") ??
            $(tableCells[2]).text(),
        ),
        txnCount: parseFormattedNumber($(tableCells[3]).text()),
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
    parent.find("tr").each((index, tableRow) => {
      const tableCells = $(tableRow).find("td");

      const anchorWithDataBsTitle = $(tableCells[1]).find("a");

      const address =
        anchorWithDataBsTitle.find("span").attr("data-highlight-target") || "";

      if (typeof address !== "string") return;

      const tokenName =
        $(tableCells[2])
          .find("a > div > span.hash-tag.text-truncate > span")
          .text() ||
        $(tableCells[2]).find("a > div > span.hash-tag.text-truncate").text() ||
        "";
      const tokenSymbol = $(tableCells[2])
        .find("a > div > span.text-muted")
        .text()
        .slice(1, -1);
      const website = ($(tableCells[5]).find("a").attr("href") || "") // had to change .attr("data-original-title") to .attr("href") for arbiscan
        .toLowerCase();
      const tokenRow: TokenRow = {
        address: address.trim().toLowerCase() as Address,
        name: tokenName,
        symbol: tokenSymbol,
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
