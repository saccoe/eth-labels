import {
  SQSClient,
  SendMessageCommand,
  type MessageAttributeValue,
} from "@aws-sdk/client-sqs";
import { z } from "zod";
import type {
  BatchPayload,
  CompletionPayload,
  FailurePayload,
  MessageEnvelope,
} from "./types";

const EnvSchema = z.object({
  SQS_LABEL_QUEUE_URL: z.string().url(),
  AWS_REGION: z.string().min(1),
});

type EventType =
  | "label.batch.ingested"
  | "label.ingestion.completed"
  | "label.ingestion.failed";

type Payload = BatchPayload | CompletionPayload | FailurePayload;

export class SqsSender {
  readonly #client: SQSClient;
  readonly #queueUrl: string;
  readonly #source: string;

  public constructor(source: string) {
    const env = EnvSchema.parse(process.env);
    this.#client = new SQSClient({ region: env.AWS_REGION });
    this.#queueUrl = env.SQS_LABEL_QUEUE_URL;
    this.#source = source;
  }

  public async send(payload: Payload, eventType: EventType): Promise<void> {
    const envelope: MessageEnvelope = {
      id: crypto.randomUUID(),
      type: "DUNE_LABELS",
      payload,
      timestamp: new Date().toISOString(),
    };

    const messageAttributes: Record<string, MessageAttributeValue> = {
      messageType: { DataType: "String", StringValue: "DUNE_LABELS" },
      eventType: { DataType: "String", StringValue: eventType },
      source: { DataType: "String", StringValue: this.#source },
    };

    const command = new SendMessageCommand({
      QueueUrl: this.#queueUrl,
      MessageBody: JSON.stringify(envelope),
      MessageAttributes: messageAttributes,
    });

    await this.#client.send(command);
  }
}
