import "dotenv/config";
import { z } from "zod";
import { getChainConfig } from "../cli";
import { AccountsRepository } from "../db/repositories/AccountsRepository";
import { SqsSender } from "./SqsSender";
import type { BatchPayload, Label } from "./types";

const SOURCE = "eth-labels";
const BATCH_SIZE = 100;

function toLabel(row: {
  address: string;
  label: string;
  chainId: number;
}): Label {
  const blockchain = CHAIN_DUNE_NAMES[row.chainId];
  return {
    address: row.address,
    label: row.label,
    source: SOURCE,
    metadata: {
      chainId: row.chainId,
      ...(blockchain ? { blockchain } : {}),
    },
  };
}

function chunk<T>(arr: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Internal chain identifiers used in metadata.chain
const CHAIN_INTERNAL_NAMES: Record<number, string> = {
  1: "eth",
  10: "opt",
  56: "bsc",
  100: "gnosis",
  137: "pol",
  8453: "base",
  42161: "arb",
  42220: "celo",
  900: "sol",
};

// Dune blockchain names used in labels[].metadata.blockchain
const CHAIN_DUNE_NAMES: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  56: "bnb",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
  900: "solana",
};

function chainNameForId(chainId: number): string {
  return CHAIN_INTERNAL_NAMES[chainId] ?? String(chainId);
}

async function main() {
  const runId = crypto.randomUUID();
  const startMs = Date.now();
  const sender = new SqsSender(SOURCE);

  const { chains: selectedChains } = await getChainConfig();
  const chainIds = [
    ...new Set(
      selectedChains.map((c): number => (c === "solscan" ? 900 : c.chainId)),
    ),
  ];

  const allAccounts = (
    await Promise.all(
      chainIds.map((id) => AccountsRepository.selectAccountsByChainId(id)),
    )
  ).flat();

  const totalLabels = allAccounts.length;
  console.log(`\nStarting label ingestion run ${runId}`);
  console.log(`Found ${totalLabels} active accounts to send`);

  // Send active labels
  const batches = chunk(allAccounts, BATCH_SIZE);
  let totalIngested = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNumber = i + 1;
    const firstChainId = z
      .object({ chainId: z.number() })
      .parse(batch[0]).chainId;
    const chain = chainNameForId(firstChainId);
    const labels: Array<Label> = batch.map(toLabel);

    const payload: BatchPayload = {
      eventType: "label.batch.ingested",
      source: SOURCE,
      timestamp: new Date().toISOString(),
      metadata: {
        runId,
        totalLabels,
        batchNumber,
        totalBatches: batches.length,
        chain,
      },
      labels,
    };

    try {
      await sender.send(payload, "label.batch.ingested");
      totalIngested += labels.length;
      console.log(
        `  Batch ${batchNumber}/${batches.length} sent (${labels.length} labels, chain=${chain})`,
      );
    } catch (err) {
      console.error(`  Batch ${batchNumber} failed:`, err);
      await sender.send(
        {
          eventType: "label.ingestion.failed",
          source: SOURCE,
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
          metadata: { runId, totalLabels },
        },
        "label.ingestion.failed",
      );
      process.exit(1);
    }
  }

  await sender.send(
    {
      eventType: "label.ingestion.completed",
      source: SOURCE,
      timestamp: new Date().toISOString(),
      metadata: {
        runId,
        totalLabels,
        totalLabelsIngested: totalIngested,
        totalBatches: batches.length,
        durationMs: Date.now() - startMs,
      },
    },
    "label.ingestion.completed",
  );

  console.log(
    `\nDone. ${totalIngested} labels sent in ${Date.now() - startMs}ms`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
