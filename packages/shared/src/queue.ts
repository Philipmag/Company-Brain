/**
 * BullMQ queue names, job payloads, and shared connection options (spec §6.1).
 */
import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { env } from "./env.js";
import { JOB_ATTEMPTS, JOB_BACKOFF_DELAYS_MS } from "./constants.js";

export const QUEUE_NAMES = {
  syncConnection: "sync-connection",
  processDocument: "process-document",
  chunkDocument: "chunk-document",
  embedChunks: "embed-chunks",
  cleanupStaleChunks: "cleanup-stale-chunks",
} as const;

export interface SyncConnectionJob {
  connectionId: string;
  orgId: string;
}

export interface ProcessDocumentJob {
  orgId: string;
  connectionId: string | null;
  /** For drive: the provider file id. For upload: the storage object path. */
  sourceRef: string;
  sourceType: "google_drive" | "slack" | "upload";
  /** Pre-resolved documents.id when re-processing (upload flow). */
  documentId?: string;
}

export interface ChunkDocumentJob {
  orgId: string;
  documentId: string;
}

export interface EmbedChunksJob {
  orgId: string;
  documentId: string;
  /** Previous chunk ids to delete after the new chunks are written. */
  previousChunkIds: string[];
}

export interface CleanupStaleChunksJob {
  orgId: string;
  documentId: string;
  chunkIds: string[];
}

let connection: ConnectionOptions | null = null;
export function redisConnection(): ConnectionOptions {
  if (!connection) {
    connection = { url: env.redisUrl } as ConnectionOptions;
  }
  return connection;
}

export const defaultJobOptions: JobsOptions = {
  attempts: JOB_ATTEMPTS,
  backoff: { type: "spec-backoff" },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

/**
 * BullMQ "custom" backoff strategy implementing the spec's 1m/5m/30m schedule.
 * Register on the Worker via `settings.backoffStrategy`.
 */
export function specBackoffStrategy(attemptsMade: number): number {
  const idx = Math.min(attemptsMade - 1, JOB_BACKOFF_DELAYS_MS.length - 1);
  return JOB_BACKOFF_DELAYS_MS[Math.max(0, idx)]!;
}

// Lazily-created queue singletons.
const queues = new Map<string, Queue>();
function getQueue<T>(name: string): Queue<T> {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, { connection: redisConnection(), defaultJobOptions }),
    );
  }
  return queues.get(name) as Queue<T>;
}

export const queues_ = {
  syncConnection: () => getQueue<SyncConnectionJob>(QUEUE_NAMES.syncConnection),
  processDocument: () => getQueue<ProcessDocumentJob>(QUEUE_NAMES.processDocument),
  chunkDocument: () => getQueue<ChunkDocumentJob>(QUEUE_NAMES.chunkDocument),
  embedChunks: () => getQueue<EmbedChunksJob>(QUEUE_NAMES.embedChunks),
  cleanupStaleChunks: () =>
    getQueue<CleanupStaleChunksJob>(QUEUE_NAMES.cleanupStaleChunks),
};

export async function enqueueSync(job: SyncConnectionJob): Promise<void> {
  await queues_.syncConnection().add(QUEUE_NAMES.syncConnection, job);
}
export async function enqueueProcessDocument(job: ProcessDocumentJob): Promise<void> {
  await queues_.processDocument().add(QUEUE_NAMES.processDocument, job);
}
export async function enqueueChunkDocument(job: ChunkDocumentJob): Promise<void> {
  await queues_.chunkDocument().add(QUEUE_NAMES.chunkDocument, job);
}
export async function enqueueEmbedChunks(job: EmbedChunksJob): Promise<void> {
  await queues_.embedChunks().add(QUEUE_NAMES.embedChunks, job);
}
