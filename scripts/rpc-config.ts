/**
 * Public RPC endpoints per chain, used for on-chain ERC20 metadata fallback.
 * The env var is always tried first if set.
 * Entries are tried in order until one returns data.
 */
export const rpcConfig: Partial<
  Record<number, { envVar: string; publicRpcs: Array<string> }>
> = {
  1: {
    envVar: "ETHEREUM_RPC",
    publicRpcs: [
      "https://eth.llamarpc.com",
      "https://ethereum.publicnode.com",
      "https://rpc.ankr.com/eth",
      "https://cloudflare-eth.com",
    ],
  },
  10: {
    envVar: "OPTIMISM_RPC",
    publicRpcs: [
      "https://optimism.llamarpc.com",
      "https://optimism.publicnode.com",
      "https://rpc.ankr.com/optimism",
    ],
  },
  56: {
    envVar: "BSC_RPC",
    publicRpcs: [
      "https://binance.llamarpc.com",
      "https://bsc.publicnode.com",
      "https://rpc.ankr.com/bsc",
    ],
  },
  100: {
    envVar: "GNOSIS_RPC",
    publicRpcs: [
      "https://gnosis.publicnode.com",
      "https://rpc.ankr.com/gnosis",
    ],
  },
  137: {
    envVar: "POLYGON_RPC",
    publicRpcs: [
      "https://polygon.llamarpc.com",
      "https://polygon.publicnode.com",
      "https://rpc.ankr.com/polygon",
    ],
  },
  8453: {
    envVar: "BASE_RPC",
    publicRpcs: [
      "https://base.llamarpc.com",
      "https://base.publicnode.com",
      "https://rpc.ankr.com/base",
    ],
  },
  42161: {
    envVar: "ARBITRUM_RPC",
    publicRpcs: [
      "https://arbitrum.llamarpc.com",
      "https://arbitrum-one.publicnode.com",
      "https://rpc.ankr.com/arbitrum",
    ],
  },
  42220: {
    envVar: "CELO_RPC",
    publicRpcs: ["https://celo.publicnode.com", "https://rpc.ankr.com/celo"],
  },
};

export function getRpcUrls(chainId: number): Array<string> {
  const config = rpcConfig[chainId];
  if (!config) return [];
  const envRpc = process.env[config.envVar];
  return [...(envRpc ? [envRpc] : []), ...config.publicRpcs];
}
