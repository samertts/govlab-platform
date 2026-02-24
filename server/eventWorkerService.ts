import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import { processEventProjections } from "./readModelProjections";
import { orchestrateSuggestion } from "./unifiedSuggestionOrchestrator";
import { processNotification } from "./notificationEngine";
import { validateEventOrigin } from "./securityGuardrails";
import { verifyEventSignature, quarantineEvent } from "./eventSigningService";

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let processedCount = 0;
let failedCount = 0;
let lastCycleAt: Date | null = null;

export function startEventWorker(): void {
  if (workerRunning) return;
  workerRunning = true;

  workerInterval = setInterval(async () => {
    await processBatch();
  }, POLL_INTERVAL_MS);

  setImmediate(async () => {
    await processBatch();
  });
}

export function stopEventWorker(): void {
  workerRunning = false;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function getWorkerStatus(): {
  running: boolean;
  processedCount: number;
  failedCount: number;
  lastCycleAt: string | null;
} {
  return {
    running: workerRunning,
    processedCount,
    failedCount,
    lastCycleAt: lastCycleAt?.toISOString() || null,
  };
}

async function processBatch(): Promise<void> {
  try {
    const unprocessed = await storage.getUnprocessedEvents(BATCH_SIZE);
    if (unprocessed.length === 0) return;

    for (const event of unprocessed) {
      await processEvent(event);
    }

    lastCycleAt = new Date();
  } catch (_err) {
  }
}

const retryTracker = new Map<number, number>();

async function processEvent(event: any): Promise<void> {
  try {
    if (!validateEventOrigin(event)) {
      await storage.markEventFailed(event.id);
      failedCount++;
      return;
    }

    const payload = event.payload as any;
    if (payload && payload.signatureHash) {
      const sigResult = verifyEventSignature({
        eventType: event.eventType,
        payload,
        signatureHash: payload.signatureHash,
        issuerIdentity: payload.issuerIdentity,
        issuedAt: payload.issuedAt,
      });

      if (!sigResult.valid) {
        await quarantineEvent(event, sigResult.reason || "INVALID_SIGNATURE");
        await storage.markEventFailed(event.id);
        failedCount++;
        return;
      }
    }

    await processEventProjections(event);

    await orchestrateSuggestion(event);

    await processNotification(event);

    await storage.markEventProcessed(event.id);
    retryTracker.delete(event.id);
    processedCount++;
  } catch (_err) {
    const attempts = (retryTracker.get(event.id) || 0) + 1;
    retryTracker.set(event.id, attempts);
    if (attempts >= MAX_RETRIES) {
      try {
        await storage.markEventFailed(event.id);
      } catch (_innerErr) {
      }
      retryTracker.delete(event.id);
      failedCount++;
    }
  }
}
