import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import type { AnalyzerEventQueueEntry } from "@shared/schema";

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 30;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000;

const SENSITIVE_PAYLOAD_KEYS = [
  "nationalIdEncrypted", "national_id_encrypted", "nationalIdHash",
  "national_id_hash", "password", "token", "secret", "tokenHash",
];

function sanitizePayload(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload.map(item => sanitizePayload(item));
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_PAYLOAD_KEYS.includes(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizePayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

const jobBackoffUntil = new Map<number, number>();

function isEventInBackoff(eventId: number): boolean {
  const until = jobBackoffUntil.get(eventId);
  if (!until) return false;
  if (Date.now() >= until) {
    jobBackoffUntil.delete(eventId);
    return false;
  }
  return true;
}

function setEventBackoff(eventId: number, retryCount: number): void {
  const delay = BASE_BACKOFF_MS * Math.pow(2, retryCount - 1);
  jobBackoffUntil.set(eventId, Date.now() + delay);
}

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let processedCount = 0;
let failedCount = 0;
let lastCycleAt: Date | null = null;
let cycleCount = 0;

export function startAnalyzerWorker(): void {
  if (workerRunning) return;
  workerRunning = true;

  workerInterval = setInterval(async () => {
    await processAnalyzerBatch();
  }, POLL_INTERVAL_MS);

  setImmediate(async () => {
    await processAnalyzerBatch();
  });
}

export function stopAnalyzerWorker(): void {
  workerRunning = false;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function getAnalyzerWorkerStatus(): {
  running: boolean;
  processedCount: number;
  failedCount: number;
  lastCycleAt: string | null;
  cycleCount: number;
} {
  return {
    running: workerRunning,
    processedCount,
    failedCount,
    lastCycleAt: lastCycleAt?.toISOString() || null,
    cycleCount,
  };
}

async function processAnalyzerBatch(): Promise<void> {
  try {
    const pendingEvents = await storage.getPendingAnalyzerEvents(BATCH_SIZE);
    if (pendingEvents.length === 0) {
      lastCycleAt = new Date();
      cycleCount++;
      return;
    }

    for (const event of pendingEvents) {
      if (isEventInBackoff(event.id)) continue;
      await processAnalyzerEvent(event);
    }

    lastCycleAt = new Date();
    cycleCount++;
  } catch (_err) {}
}

async function processAnalyzerEvent(event: AnalyzerEventQueueEntry): Promise<void> {
  try {
    const payload = event.payload as Record<string, any> | null;
    if (!payload) {
      await storage.markAnalyzerEventFailed(event.id, "Empty payload");
      failedCount++;
      return;
    }

    const testCode = payload.testCode || "";
    const resultValue = String(payload.resultValue ?? "");
    const specimenIdStr = payload.specimenId || "";
    const patientIdStr = payload.patientId || "";
    const patientMrn = payload.patientMrn || "";

    if (!testCode) {
      await storage.markAnalyzerEventFailed(event.id, "Missing test code");
      failedCount++;
      return;
    }

    const analyzer = await storage.getAnalyzerById(event.analyzerId);
    if (!analyzer) {
      await storage.markAnalyzerEventFailed(event.id, "Analyzer not found");
      failedCount++;
      return;
    }

    let resolvedLabId: number | null = event.labId || null;
    if (!resolvedLabId && analyzer.facilityCode) {
      const labs = await storage.getLabs();
      const matchingLab = labs.find(l => l.facilityCode === analyzer.facilityCode);
      if (matchingLab) resolvedLabId = matchingLab.id;
    }

    let resolvedPatientId: number | null = null;
    let resolvedSpecimenId: number | null = null;

    if (patientIdStr) {
      const numId = parseInt(patientIdStr, 10);
      if (!isNaN(numId)) {
        const patient = await storage.getPatient(numId);
        if (patient && (!resolvedLabId || patient.labId === resolvedLabId)) {
          resolvedPatientId = patient.id;
        }
      }
    }
    if (!resolvedPatientId && patientMrn) {
      const patients = await storage.getPatients(patientMrn, resolvedLabId);
      if (patients.length === 1) resolvedPatientId = patients[0].id;
    }

    if (specimenIdStr) {
      const numId = parseInt(specimenIdStr, 10);
      if (!isNaN(numId)) {
        const sample = await storage.getSample(numId);
        if (sample && (!resolvedLabId || sample.labId === resolvedLabId)) {
          resolvedSpecimenId = sample.id;
          if (!resolvedPatientId) resolvedPatientId = sample.patientId;
        }
      }
    }

    const provenanceJson = {
      analyzerId: event.analyzerId,
      messageHash: event.messageHash,
      eventQueueId: event.id,
      ingestedAt: event.createdAt?.toISOString() || new Date().toISOString(),
      processedAt: new Date().toISOString(),
      facilityCode: analyzer.facilityCode,
      analyzerType: analyzer.analyzerType,
      originType: "ANALYZER",
    };

    await storage.createResultHot({
      resultId: 0,
      specimenId: resolvedSpecimenId || 0,
      patientId: resolvedPatientId || 0,
      labId: resolvedLabId,
      testCode,
      resultValue,
      resultStatus: "analyzer_received",
      sourceType: "ANALYZER",
      sourceId: event.analyzerId,
      enteredBy: null,
      enteredAt: new Date(),
      verifiedBy: null,
      verifiedAt: null,
      ingestionMethod: payload.messageType || "ANALYZER",
      amendmentChainRef: null,
      provenanceJson,
    });

    await storage.markAnalyzerEventProcessed(event.id);
    processedCount++;

    setImmediate(async () => {
      try {
        await eventBus.emitAndPersist({
          eventType: EventTypes.RESULT_ENTERED,
          entityType: "result_hot",
          entityId: event.id,
          payload: sanitizePayload({
            testCode,
            resultValue,
            analyzerId: event.analyzerId,
            patientId: resolvedPatientId,
            specimenId: resolvedSpecimenId,
            originType: "ANALYZER",
            advisoryOriginFlag: false,
            sourceType: "ANALYZER",
          }),
          emittedBy: null,
        });
      } catch (_eventErr) {}
    });

  } catch (_err) {
    const retryCount = (event.retryCount || 0) + 1;
    if (retryCount >= MAX_RETRIES) {
      await storage.markAnalyzerEventFailed(event.id, `Max retries (${MAX_RETRIES}) exceeded`);
      failedCount++;
    } else {
      await storage.incrementAnalyzerEventRetry(event.id);
      setEventBackoff(event.id, retryCount);
    }
  }
}
