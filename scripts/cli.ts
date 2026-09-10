import inquirer from "inquirer";
import type { ApiParser } from "./ApiParser/ApiParser";
import type { Chain } from "./Chain/Chain";
import type { HtmlParser } from "./HtmlParser/HtmlParser";
import { scanConfig } from "./scan-config";

export const SOLSCAN_SENTINEL = "solscan";
export type ChainSelection =
  | Chain<ApiParser, HtmlParser>
  | typeof SOLSCAN_SENTINEL;

type Selectable = {
  /** lowercase key matched against ETH_LABELS_CHAINS */
  key: string;
  /** label shown in the interactive picker */
  label: string;
  value: ChainSelection;
};

const selectables: ReadonlyArray<Selectable> = [
  ...scanConfig.map((chain) => ({
    key: chain.chainName.toLowerCase(),
    label: chain.chainName,
    value: chain as ChainSelection,
  })),
  {
    key: SOLSCAN_SENTINEL,
    label: "solscan (Solana)",
    value: SOLSCAN_SENTINEL as ChainSelection,
  },
];

/**
 * Select chains to pull.
 *
 * Non-interactive: set ETH_LABELS_CHAINS to a comma-separated list of chain
 * names from scan-config (e.g. "etherscan,polygon,solscan"), or "all".
 */
export async function getChainConfig(): Promise<{
  chains: ReadonlyArray<ChainSelection>;
}> {
  const fromEnv = process.env.ETH_LABELS_CHAINS?.trim();
  if (fromEnv) {
    if (fromEnv.toLowerCase() === "all") {
      return { chains: selectables.map((entry) => entry.value) };
    }
    const wanted = new Set(
      fromEnv
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    const missing = [...wanted].filter(
      (name) => !selectables.some((entry) => entry.key === name),
    );
    if (missing.length > 0) {
      throw new Error(
        `Unknown chain name(s) in ETH_LABELS_CHAINS: ${missing.join(", ")}. ` +
          `Valid: ${selectables.map((entry) => entry.key).join(", ")}`,
      );
    }
    const selected = selectables.filter((entry) => wanted.has(entry.key));
    if (selected.length === 0) {
      throw new Error("ETH_LABELS_CHAINS matched no chains");
    }
    console.log(
      `Using chains from ETH_LABELS_CHAINS: ${selected
        .map((entry) => entry.key)
        .join(", ")}`,
    );
    return { chains: selected.map((entry) => entry.value) };
  }

  const selected = await inquirer.prompt<{ chains: Array<ChainSelection> }>([
    {
      type: "checkbox",
      name: "chains",
      message: "Select chains to pull",
      choices: selectables.map((entry) => ({
        name: entry.label,
        value: entry.value,
      })),
    },
  ]);
  return { chains: selected.chains };
}
