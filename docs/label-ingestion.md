# Label Ingestion Pipeline

How to publish label data to the SQS ingestion queue.

## Usage

Set the required env vars and run the send script. You will be prompted to select which chains to send:

```bash
bun run scripts/sqs/send-labels-to-sqs.ts
```

Or add the required env vars to your `.env` file (see Queue Configuration below).

The script will:

1. Prompt you to select one or more chains
2. Send all active labels in batches of 100 as `label.batch.ingested` events
3. Send a `label.ingestion.completed` event when done
4. Send a `label.ingestion.failed` event and exit with code 1 if a batch fails

Labels are scraped and written to SQLite via `bun run pull`. Re-scraping a chain bumps `updated_at` on all seen rows — rows with stale `updated_at` after a scrape were removed from Etherscan.

## Local Testing (LocalStack)

Queue URL for local development:

```
SQS_LABEL_QUEUE_URL=http://sqs.us-east-2.localhost.localstack.cloud:4566/000000000000/label-ingestion-queue
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

## Queue Configuration

| Env Var               | Description                          |
| --------------------- | ------------------------------------ |
| `SQS_LABEL_QUEUE_URL` | Queue URL                            |
| `AWS_REGION`          | AWS region                           |
| `SQS_ENDPOINT`        | LocalStack endpoint (local dev only) |

## Message Envelope

Every message is wrapped in this envelope:

```json
{
  "id": "<uuid-v4>",
  "type": "DUNE_LABELS",
  "timestamp": "2026-03-17T10:30:00.000Z",
  "payload": { ... }
}
```

## Event Types

| `eventType`                 | Description                         |
| --------------------------- | ----------------------------------- |
| `label.batch.ingested`      | Multiple labels in one message      |
| `label.ingestion.completed` | Signals end of a full ingestion run |
| `label.ingestion.failed`    | Signals a failed ingestion run      |

## Chain Resolution

The processor resolves chain in this order:

1. **`labels[].metadata.blockchain`** — Dune's blockchain field (mapped to internal chain)
2. **`metadata.chain`** — explicit chain on the event metadata
3. **Address format inference** — fallback when no blockchain metadata is provided

> If `labels[].metadata.blockchain` is set to an unsupported value, the processor **throws an error** to prevent misclassification.

### Internal Chain Identifiers (`metadata.chain`)

| Value    | Chain           |
| -------- | --------------- |
| `eth`    | Ethereum        |
| `pol`    | Polygon         |
| `arb`    | Arbitrum        |
| `opt`    | Optimism        |
| `base`   | Base            |
| `bsc`    | BNB Smart Chain |
| `gnosis` | Gnosis          |
| `celo`   | Celo            |
| `sol`    | Solana          |

### Dune Blockchain Names (`labels[].metadata.blockchain`)

| Dune value | Maps to internal |
| ---------- | ---------------- |
| `ethereum` | `eth`            |
| `polygon`  | `pol`            |
| `arbitrum` | `arb`            |
| `optimism` | `opt`            |
| `base`     | `base`           |
| `bnb`      | `bsc`            |
| `solana`   | `sol`            |

Any other value causes the processor to throw an error.

### Address Format Inference (fallback)

| Address pattern                        | Inferred chain       |
| -------------------------------------- | -------------------- |
| Starts with `0x`, exactly 42 chars     | `eth`                |
| Starts with `0x`, longer than 42 chars | `sui`                |
| Starts with `EQ` or `UQ`               | `ton`                |
| 32–44 chars, no `0x` prefix            | `sol`                |
| Anything else                          | `eth` (with warning) |

## Payload Schemas

### `label.batch.ingested`

```json
{
  "eventType": "label.batch.ingested",
  "source": "eth-labels",
  "timestamp": "2026-03-17T10:30:00.000Z",
  "metadata": {
    "runId": "<uuid-v4>",
    "totalLabels": 100,
    "batchNumber": 1,
    "totalBatches": 5,
    "chain": "eth"
  },
  "labels": [
    {
      "address": "0x...",
      "label": "wintermute",
      "source": "eth-labels",
      "metadata": {
        "chainId": 1
      }
    }
  ]
}
```

### `label.ingestion.completed`

```json
{
  "eventType": "label.ingestion.completed",
  "source": "eth-labels",
  "timestamp": "2026-03-17T10:30:00.000Z",
  "metadata": {
    "runId": "<uuid-v4>",
    "totalLabels": 3305,
    "totalLabelsIngested": 3305,
    "totalBatches": 34,
    "durationMs": 5200
  }
}
```

### `label.ingestion.failed`

```json
{
  "eventType": "label.ingestion.failed",
  "source": "eth-labels",
  "timestamp": "2026-03-17T10:30:00.000Z",
  "error": "Descriptive error message",
  "metadata": {
    "runId": "<uuid-v4>",
    "totalLabels": 3305
  }
}
```
