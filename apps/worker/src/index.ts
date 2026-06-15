/**
 * Worker bootstrap (spec §6.1 / §6.2).
 * Spins up one BullMQ Worker per queue with the spec's retry/backoff policy and
 * a daily node-cron job to recompute citation counts.
 */
import { Worker, type Job } from "bullmq";
import cron from "node-cron";
import {
  QUEUE_NAMES,
  redisConnection,
  specBackoffStrategy,
  getAdminClient,
  writeAudit,
} from "@company-brain/shared";
import { handleSyncConnection } from "./jobs/syncConnection.js";
import { handleProcessDocument } from "./jobs/processDocument.js";
import { handleChunkDocument } from "./jobs/chunkDocument.js";
import { handleEmbedChunks } from "./jobs/embedChunks.js";

const connection = redisConnection();
const settings = { backoffStrategy: specBackoffStrategy };

function makeWorker<T>(
  name: string,
  handler: (job: Job<T>) => Promise<void>,
  concurrency = 5,
): Worker<T> {
  const worker = new Worker<T>(name, handler, {
    connection,
    concurrency,
    settings,
  });
  worker.on("failed", (job, err) => {
    console.error(`[${name}] job ${job?.id} failed:`, err.message);
  });
  worker.on("completed", (job) => {
    console.log(`[${name}] job ${job.id} completed`);
  });
  return worker;
}

/** On final failure of a document-scoped job, mark the document as errored. */
async function markDocumentError(documentId: string | undefined, message: string) {
  if (!documentId) return;
  const supabase = getAdminClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("org_id")
    .eq("id", documentId)
    .single<{ org_id: string }>();
  await supabase
    .from("documents")
    .update({ status: "error" })
    .eq("id", documentId);
  if (doc) await writeAudit(doc.org_id, "document.error", { documentId, message });
}

const workers: Worker[] = [
  makeWorker(QUEUE_NAMES.syncConnection, handleSyncConnection, 2),
  makeWorker(QUEUE_NAMES.processDocument, handleProcessDocument, 5),
  makeWorker(QUEUE_NAMES.chunkDocument, handleChunkDocument, 5),
  makeWorker(QUEUE_NAMES.embedChunks, handleEmbedChunks, 3),
];

// Mark documents errored when their jobs exhaust retries.
for (const name of [QUEUE_NAMES.processDocument, QUEUE_NAMES.chunkDocument, QUEUE_NAMES.embedChunks]) {
  const worker = workers.find((w) => w.name === name)!;
  worker.on("failed", async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const documentId = (job.data as { documentId?: string }).documentId;
      await markDocumentError(documentId, err.message);
    }
  });
}

// Daily recompute of citation_count_30d (spec §7).
cron.schedule("0 3 * * *", async () => {
  try {
    await getAdminClient().rpc("recompute_citation_counts");
    console.log("[cron] recomputed citation counts");
  } catch (err) {
    console.error("[cron] recompute failed:", err);
  }
});

console.log("Company Brain worker started. Listening on queues:", Object.values(QUEUE_NAMES));

async function shutdown() {
  console.log("Shutting down workers…");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
