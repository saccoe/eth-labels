import { z } from "zod";

export const LabelSchema = z.object({
  address: z.string().min(1).max(100),
  label: z.string().min(1).max(255),
  source: z.string().min(1).max(100),
  category: z.string().max(100).optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Label = z.infer<typeof LabelSchema>;

export const BatchMetadataSchema = z.object({
  runId: z.string().uuid(),
  totalLabels: z.number().int().positive(),
  batchNumber: z.number().int().positive().optional(),
  totalBatches: z.number().int().positive().optional(),
  chain: z.string().optional(),
});

export type BatchMetadata = z.infer<typeof BatchMetadataSchema>;

export const BatchPayloadSchema = z.object({
  eventType: z.literal("label.batch.ingested"),
  source: z.string().min(1).max(100),
  timestamp: z.string(),
  metadata: BatchMetadataSchema,
  labels: z.array(LabelSchema).min(1),
});

export type BatchPayload = z.infer<typeof BatchPayloadSchema>;

export const CompletionPayloadSchema = z.object({
  eventType: z.literal("label.ingestion.completed"),
  source: z.string().min(1).max(100),
  timestamp: z.string(),
  metadata: z.object({
    runId: z.string().uuid(),
    totalLabels: z.number().int().positive(),
    totalLabelsIngested: z.number().int().min(0),
    totalBatches: z.number().int().positive(),
    durationMs: z.number().int().min(0),
  }),
});

export type CompletionPayload = z.infer<typeof CompletionPayloadSchema>;

export const FailurePayloadSchema = z.object({
  eventType: z.literal("label.ingestion.failed"),
  source: z.string().min(1).max(100),
  timestamp: z.string(),
  error: z.string(),
  metadata: z.object({
    runId: z.string().uuid(),
    totalLabels: z.number().int().min(0),
  }),
});

export type FailurePayload = z.infer<typeof FailurePayloadSchema>;

export const MessageEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("DUNE_LABELS"),
  payload: z.union([
    BatchPayloadSchema,
    CompletionPayloadSchema,
    FailurePayloadSchema,
  ]),
  timestamp: z.string(),
});

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;
