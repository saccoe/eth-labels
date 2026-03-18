import inquirer from "inquirer";
import type { ApiParser } from "./ApiParser/ApiParser";
import type { Chain } from "./Chain/Chain";
import type { HtmlParser } from "./HtmlParser/HtmlParser";
import { scanConfig } from "./scan-config";

export const SOLSCAN_SENTINEL = "solscan";
export type ChainSelection =
  | Chain<ApiParser, HtmlParser>
  | typeof SOLSCAN_SENTINEL;

export async function getChainConfig() {
  const choices: Array<{ name: string; value: ChainSelection }> = [
    ...scanConfig.map((chain) => ({
      name: chain.chainName,
      value: chain as ChainSelection,
    })),
    { name: "solscan (Solana)", value: SOLSCAN_SENTINEL },
  ];

  const selected = await inquirer.prompt<{ chains: Array<ChainSelection> }>([
    {
      type: "checkbox",
      name: "chains",
      message: "Select chains to pull",
      choices,
    },
  ]);
  return { chains: selected.chains };
}
