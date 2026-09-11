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

export class EtherscanHtmlParser extends HtmlParser {
  public constructor() {
    super();
    super.setUseApiForTokenRows(true);
  }

  public selectAllAccountAddresses(
    html: string,
    subcatId: string = "0",
  ): AccountRows {
    const $ = cheerio.load(html);
    const selector = `#table-subcatid-${subcatId} > tbody`;
    const tableElements = $(selector);
    const parent = tableElements.last();

    let addressesInfo: AccountRows = [];
    parent.find("tr").each((index, tableRow) => {
      const tableCells = $(tableRow).find("td");

      const anchor = $(tableCells[0]).find("a[data-bs-title]");
      const address = extractAddressFrom([
        anchor.attr("data-bs-title"),
        anchor.attr("href"),
        anchor.text(),
      ]);
      if (!address) return;

      // The visible balance is rounded to 8dp; the tooltip carries full
      // precision, so prefer it and drop the currency suffix.
      const balanceCell = $(tableCells[2]);
      const balance =
        balanceCell.find("[data-bs-title]").attr("data-bs-title") ??
        balanceCell.text();

      const newAddressInfo: AccountRow = {
        address,
        nameTag: $(tableCells[1]).text().trim(),
        balance: parseBalance(balance),
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

      const anchorWithDataBsTitle = $(tableCells[1]).find("a[data-bs-title]");

      const address = anchorWithDataBsTitle.attr("data-bs-title");
      if (typeof address !== "string") {
        return;
      }
      const tokenNameColumn = $(tableCells[2]).text().trim();
      const regex = /^(.*)\n\s*\((.*)\)/;
      const match = tokenNameColumn.match(regex);
      const tokenName = match?.[1];
      const tokenSymbol = match?.[2];
      const image = $(tableCells[2]).find("a > img").attr("src");
      const website = $(tableCells[5]).text().trim().toLowerCase();
      const tokenRow: TokenRow = {
        address: address.trim() as Address,
        website,
        name: tokenName || null,
        symbol: tokenSymbol || null,
        image: image || null,
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
