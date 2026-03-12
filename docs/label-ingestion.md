# Label Ingestion Pipeline

How to publish label data to the SQS ingestion queue.

## Usage

Set the required env vars and run the send script. You will be prompted to select which chains to send:

```bash
SQS_LABEL_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789/queue \
AWS_REGION=us-east-1 \
bun run scripts/sqs/send-labels-to-sqs.ts
```

Or add them to your `.env` file:

```
SQS_LABEL_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789/queue
AWS_REGION=us-east-1
```

The script will:

1. Prompt you to select one or more chains
2. Send all active labels in batches of 100 as `label.batch.ingested` events
3. Send a `label.ingestion.completed` event when done
4. Send a `label.ingestion.failed` event and exit with code 1 if a batch fails

Labels are scraped and written to SQLite via `bun run pull`. Re-scraping a chain bumps `updated_at` on all seen rows — rows with stale `updated_at` after a scrape were removed from Etherscan.

## Queue Configuration

| Env Var               | Description |
| --------------------- | ----------- |
| `SQS_LABEL_QUEUE_URL` | Queue URL   |
| `AWS_REGION`          | AWS region  |

## Message Envelope

Every message must be wrapped in this envelope:

```json
{
  "id": "<uuid-v4>",
  "type": "DUNE_LABELS",
  "payload": { ... },
  "timestamp": "2026-03-11T00:00:00.000Z"
}
```

## Message Attributes

Include these SQS message attributes on every send:

| Attribute     | Type   | Example                |
| ------------- | ------ | ---------------------- |
| `messageType` | String | `DUNE_LABELS`          |
| `eventType`   | String | `label.batch.ingested` |
| `source`      | String | `your_source_name`     |

## Event Types

| `eventType`                 | Description                         |
| --------------------------- | ----------------------------------- |
| `label.batch.ingested`      | Multiple labels in one message      |
| `label.ingestion.completed` | Signals end of a full ingestion run |
| `label.ingestion.failed`    | Signals a failed ingestion run      |

## Payload Schemas

### `label.batch.ingested`

```json
{
  "eventType": "label.batch.ingested",
  "source": "your_source_name",
  "timestamp": "2026-03-11T00:00:00.000Z",
  "metadata": {
    "runId": "<uuid-v4>",
    "totalLabels": 2,
    "batchNumber": 1,
    "chain": "eth"
  },
  "labels": [
    {
      "address": "0x...",
      "label": "DEX Trader",
      "category": "trading",
      "confidence": 0.95,
      "source": "your_source_name",
      "metadata": {}
    }
  ]
}
```

### `label.ingestion.completed`

```json
{
  "eventType": "label.ingestion.completed",
  "source": "your_source_name",
  "timestamp": "2026-03-11T00:00:00.000Z",
  "metadata": {
    "runId": "<uuid-v4>",
    "totalLabels": 100,
    "totalLabelsIngested": 98,
    "totalBatches": 10,
    "durationMs": 5200
  }
}
```

### `label.ingestion.failed`

```json
{
  "eventType": "label.ingestion.failed",
  "source": "your_source_name",
  "timestamp": "2026-03-11T00:00:00.000Z",
  "error": "Descriptive error message",
  "metadata": {
    "runId": "<uuid-v4>",
    "totalLabels": 100
  }
}
```

## Field Validation Rules

### Label fields

| Field        | Required | Constraints      |
| ------------ | -------- | ---------------- |
| `address`    | Yes      | 1–100 chars      |
| `label`      | Yes      | 1–255 chars      |
| `source`     | Yes      | 1–100 chars      |
| `category`   | No       | max 100 chars    |
| `confidence` | No       | float 0–1        |
| `metadata`   | No       | free-form object |

### Metadata fields

| Field          | Required | Constraints                |
| -------------- | -------- | -------------------------- |
| `runId`        | Yes      | valid UUID v4              |
| `totalLabels`  | Yes      | positive integer           |
| `batchNumber`  | No       | positive integer           |
| `totalBatches` | No       | positive integer           |
| `chain`        | No       | string (e.g. `eth`, `sol`) |
