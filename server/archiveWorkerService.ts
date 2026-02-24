import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import type { ResultHot, Event } from "@shared/schema";

const POLL_INTERVAL_MS = 60_000;
const ARCHIVE_AGE_DAYS = 90;
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;

const SENSITIVE_PAYLOAD_KEYS = [
  "nationalIdEncrypted", "national_id_encrypted", "nationalIdHash",
  "national_id_hash", "password", "token", "secret", "tokenHash",
];

const labRateTracker = new Map<number, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60_000;
const MAX_ARCHIVES_PER_LAB_PER_WINDOW = 200;

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let archivedCount = 0;
let failedCount = 0;
let lastCycleAt: Date | null = null;
let cycleCount = 0;

export function startArchiveWorker(): void {
  if (workerRunning) return;
  workerRunning = true;

  workerInterval = setInterval(async () => {
    await processArchiveBatch();
  }, POLL_INTERVAL_MS);
}

export function stopArchiveWorker(): void {
  workerRunning = false;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function getArchiveWorkerStatus(): {
  running: boolean;
  archivedCount: number;
  failedCount: number;
  lastCycleAt: string | null;
  cycleCount: number;
} {
  return {
    running: workerRunning,
    archivedCount,
    failedCount,
    lastCycleAt: lastCycleAt?.toISOString() || null,
    cycleCount,
  };
}

function sanitizePayload(obj: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_PAYLOAD_KEYS.includes(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizePayload(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        item && typeof item === "object" ? sanitizePayload(item) : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function checkLabRateLimit(labId: number | null): boolean {
  if (!labId) return true;
  const now = Date.now();
  const entry = labRateTracker.get(labId);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    labRateTracker.set(labId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MAX_ARCHIVES_PER_LAB_PER_WINDOW) return false;
  entry.count++;
  return true;
}

async function processArchiveBatch(): Promise<void> {
  try {
    const hotResults = await storage.getResultsHotOlderThan(ARCHIVE_AGE_DAYS, BATCH_SIZE);
    if (hotResults.length === 0) {
      lastCycleAt = new Date();
      cycleCount++;
      return;
    }

    const archivedRecords: ResultHot[] = [];
    for (const hotRecord of hotResults) {
      if (!checkLabRateLimit(hotRecord.labId)) continue;
      const success = await archiveSingleRecord(hotRecord);
      if (success) archivedRecords.push(hotRecord);
    }

    if (archivedRecords.length > 0) {
      await updatePatientSummaries(archivedRecords);
    }

    lastCycleAt = new Date();
    cycleCount++;
  } catch (_err) {
  }
}

async function archiveSingleRecord(record: ResultHot): Promise<boolean> {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      await storage.createResultArchive({
        resultId: record.resultId,
        specimenId: record.specimenId,
        patientId: record.patientId,
        labId: record.labId,
        testCode: record.testCode,
        resultValue: record.resultValue,
        resultStatus: record.resultStatus,
        createdAt: record.createdAt,
        verifiedAt: record.verifiedAt,
      });

      await storage.deleteResultHot(record.id);

      archivedCount++;

      try {
        await eventBus.emitAndPersist({
          eventType: EventTypes.DATA_ARCHIVED,
          entityType: "result",
          entityId: record.resultId,
          payload: sanitizePayload({
            resultId: record.resultId,
            testCode: record.testCode,
            labId: record.labId,
            patientId: record.patientId,
            archivedAt: new Date().toISOString(),
          }),
          emittedBy: null,
        });
      } catch (_eventErr) {}

      return true;
    } catch (_err) {
      retries++;
      if (retries >= MAX_RETRIES) {
        failedCount++;
        try {
          await eventBus.emitAndPersist({
            eventType: EventTypes.DATA_ARCHIVE_FAILED,
            entityType: "result",
            entityId: record.resultId,
            payload: sanitizePayload({
              resultId: record.resultId,
              testCode: record.testCode,
              labId: record.labId,
              retries: MAX_RETRIES,
            }),
            emittedBy: null,
          });
        } catch (_eventErr) {}
      }
    }
  }
  return false;
}

async function updatePatientSummaries(archivedRecords: ResultHot[]): Promise<void> {
  const patientGroups = new Map<string, ResultHot[]>();

  for (const record of archivedRecords) {
    const key = `${record.patientId}:${record.labId || 0}`;
    const group = patientGroups.get(key) || [];
    group.push(record);
    patientGroups.set(key, group);
  }

  const entries = Array.from(patientGroups.entries());
  for (const [_key, records] of entries) {
    try {
      const patientId = records[0].patientId;
      const labId = records[0].labId;

      const existing = await storage.getPatientHistorySummary(patientId, labId ?? undefined);

      const totalTests = (existing?.totalTests || 0) + records.length;
      const latestDate = records.reduce((latest: Date | null, r: ResultHot) => {
        const d = r.verifiedAt || r.createdAt;
        return d && (!latest || d > latest) ? d : latest;
      }, existing?.lastTestDate || null);

      const chronicFlags = existing?.chronicFlags || [];
      const riskMarkers = existing?.riskMarkers || [];

      await storage.upsertPatientHistorySummary({
        patientId,
        labId,
        totalTests,
        lastTestDate: latestDate,
        chronicFlags,
        riskMarkers,
      });

      try {
        await eventBus.emitAndPersist({
          eventType: EventTypes.PATIENT_HISTORY_UPDATED,
          entityType: "patient_history_summary",
          entityId: patientId,
          payload: sanitizePayload({ patientId, labId, totalTests }),
          emittedBy: null,
        });
      } catch (_eventErr) {}
    } catch (_err) {
    }
  }
}

export function setupArchiveEventSubscription(): void {
  eventBus.on(EventTypes.RESULT_VERIFIED, (event: Event) => {
    setImmediate(async () => {
      try {
        const payload = event.payload as Record<string, any> | null;
        if (!payload) return;

        const resultId = payload.resultId || event.entityId;
        const specimenId = payload.specimenId || payload.sampleId;
        const patientId = payload.patientId;
        const labId = event.labId || payload.labId;
        const testCode = payload.testCode || "";
        const resultValue = payload.resultValue || "";

        if (!resultId || !specimenId || !patientId) return;

        await storage.createResultHot({
          resultId,
          specimenId,
          patientId,
          labId: labId || null,
          testCode,
          resultValue,
          resultStatus: "verified",
          verifiedAt: new Date(),
        });
      } catch (_err) {
      }
    });
  });

  eventBus.on(EventTypes.RESULT_ENTERED, (event: Event) => {
    setImmediate(async () => {
      try {
        const payload = event.payload as Record<string, any> | null;
        if (!payload) return;

        const resultId = payload.resultId || event.entityId;
        const specimenId = payload.specimenId || payload.sampleId;
        const patientId = payload.patientId;
        const labId = event.labId || payload.labId;
        const testCode = payload.testCode || "";
        const resultValue = payload.resultValue || "";

        if (!resultId || !specimenId || !patientId) return;

        await storage.createResultHot({
          resultId,
          specimenId,
          patientId,
          labId: labId || null,
          testCode,
          resultValue,
          resultStatus: "completed",
        });
      } catch (_err) {
      }
    });
  });
}
