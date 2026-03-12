import type { ApiParser } from "../ApiParser/ApiParser";
import { EtherscanApiParser } from "../ApiParser/EtherscanApiParser";
import { EtherscanHtmlParser } from "../HtmlParser/EtherscanParser";
import { Chain } from "./Chain";

export class PolygonscanChain extends Chain<ApiParser, EtherscanHtmlParser> {
  public constructor() {
    const website = "https://polygonscan.com";
    const chainName = "polygonscan";
    const apiPuller = new EtherscanApiParser(website);
    const htmlPuller = new EtherscanHtmlParser();
    super(website, chainName, apiPuller, htmlPuller);
  }
}
