import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import { globalEventBudget } from "./globalEventBudget";
import type { LocalSyncEvent } from "@shared/schema";
import { randomUUID } from "crypto";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 25;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 3_000;

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

const eventBackoffUntil = new Map<number, number>();

function isEventInBackoff(eventId: number): boolean {
  const until = eventBackoffUntil.get(eventId);
  if (!until) return false;
  if (Date.now() >= until) {
    eventBackoffUntil.delete(eventId);
    return false;
  }
  return true;
}

function setEventBackoff(eventId: number, retryCount: number): void {
  const delay = BASE_BACKOFF_MS * Math.pow(2, retryCount - 1);
  eventBackoffUntil.set(eventId, Date.now() + delay);
}

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let processedCount = 0;
let failedCount = 0;
let conflictCount = 0;
let lastCycleAt: Date | null = null;
let cycleCount = 0;

export function startOfflineSyncWorker(): void {
  if (workerRunning) return;
  workerRunning = true;

  workerInterval = setInterval(async () => {
    await processSyncBatch();
  }, POLL_INTERVAL_MS);

  setImmediate(async () => {
    await processSyncBatch();
  });
}

export function stopOfflineSyncWorker(): void {
  workerRunning = false;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function getOfflineSyncWorkerStatus(): {
  running: boolean;
  processedCount: number;
  failedCount: number;
  conflictCount: number;
  lastCycleAt: string | null;
  cycleCount: number;
} {
  return {
    running: workerRunning,
    processedCount,
    failedCount,
    conflictCount,
    lastCycleAt: lastCycleAt?.toISOString() || null,
    cycleCount,
  };
}

async function processSyncBatch(): Promise<void> {
  try {
    if (globalEventBudget.isBackpressureActive()) {
      lastCycleAt = new Date();
      cycleCount++;
      return;
    }

    const pendingEvents = await storage.getPendingSyncEvents(BATCH_SIZE);
    if (pendingEvents.length === 0) {
      lastCycleAt = new Date();
      cycleCount++;
      return;
    }

    const facilityBatch: Record<string, LocalSyncEvent[]> = {};
    for (const event of pendingEvents) {
      if (isEventInBackoff(event.id)) continue;
      if (!facilityBatch[event.facilityCode]) facilityBatch[event.facilityCode] = [];
      facilityBatch[event.facilityCode].push(event);
    }

    for (const facilityCode of Object.keys(facilityBatch)) {
      const events = facilityBatch[facilityCode];
      const syncStart = Date.now();
      let batchSuccess = true;

      for (const event of events) {
        const result = await processSyncEvent(event);
        if (!result) batchSuccess = false;
        globalEventBudget.recordEvent();
      }

      const syncLatency = Date.now() - syncStart;
      await updateFacilityStatus(facilityCode, batchSuccess, syncLatency, events.length);
    }

    lastCycleAt = new Date();
    cycleCount++;
  } catch (_err) {}
}

async function processSyncEvent(event: LocalSyncEvent): Promise<boolean> {
  try {
    const existing = await storage.getSyncEventByUuid(event.eventUuid);
    if (existing && existing.id !== event.id && existing.syncStatus === "SYNCED") {
      await storage.updateSyncEventStatus(event.id, "SYNCED");
      processedCount++;
      return true;
    }

    const payload = event.payload as Record<string, any> | null;
    if (!payload) {
      await storage.updateSyncEventStatus(event.id, "FAILED", "Empty payload");
      failedCount++;
      return false;
    }

    const sanitizedPayload = sanitizePayload(payload);

    if (payload.facilityCode && payload.facilityCode !== event.facilityCode) {
      await storage.updateSyncEventStatus(event.id, "FAILED", "Facility code mismatch in payload");
      failedCount++;
      return false;
    }

    const conflictDetected = await detectConflict(event, sanitizedPayload);
    if (conflictDetected) {
      await handleConflict(event, sanitizedPayload);
      return false;
    }

    await applyToNationalSpine(event, sanitizedPayload);

    await storage.updateSyncEventStatus(event.id, "SYNCED");
    processedCount++;

    setImmediate(async () => {
      try {
        await eventBus.emitAndPersist({
          eventType: EventTypes.SYNC_COMPLETED,
          entityType: "local_sync_event",
          entityId: event.id,
          payload: {
            eventUuid: event.eventUuid,
            eventType: event.eventType,
            facilityCode: event.facilityCode,
            advisoryOriginFlag: event.advisoryOriginFlag,
            sourceType: event.sourceType,
            syncedAt: new Date().toISOString(),
          },
          emittedBy: null,
        });
      } catch (_err) {}
    });

    return true;
  } catch (err: any) {
    await handleSyncFailure(event, err?.message || "Unknown sync error");
    return false;
  }
}

async function detectConflict(event: LocalSyncEvent, payload: any): Promise<boolean> {
  const entityType = payload.entityType || event.eventType;

  if (entityType === "result" || entityType === "test_result" ||
      event.eventType === "result.verified" || event.eventType === "result.entered") {
    if (payload.resultStatus === "verified" || payload.status === "verified" ||
        payload.existingVerified === true) {
      return true;
    }
  }

  if (payload.nationalVersion && payload.localVersion) {
    return true;
  }

  if (payload.conflictFlag === true) {
    return true;
  }

  return false;
}

async function handleConflict(event: LocalSyncEvent, payload: any): Promise<void> {
  const entityType = payload.entityType || event.eventType;

  const policy = await storage.getSyncConflictPolicyByEntity(entityType);
  const mergeStrategy = policy?.mergeStrategy || "LAST_WRITE_WINS";

  await storage.createConflictAuditLog({
    syncEventId: event.id,
    entityType,
    entityId: payload.entityId || null,
    facilityCode: event.facilityCode,
    localVersion: payload.localVersion || payload,
    remoteVersion: payload.nationalVersion || null,
    resolutionStatus: "REVIEW_REQUIRED",
    mergeStrategyApplied: mergeStrategy,
    metadata: {
      eventUuid: event.eventUuid,
      priorityOrder: policy?.priorityOrder || "LOCAL_LAB,DIRECTORATE,NATIONAL",
      detectedAt: new Date().toISOString(),
    },
  });

  await storage.updateSyncEventStatus(event.id, "CONFLICTED", `Conflict detected: ${mergeStrategy} applied — review required`);
  conflictCount++;

  setImmediate(async () => {
    try {
      await eventBus.emitAndPersist({
        eventType: EventTypes.SYNC_CONFLICT_DETECTED,
        entityType: "local_sync_event",
        entityId: event.id,
        payload: {
          eventUuid: event.eventUuid,
          entityType,
          facilityCode: event.facilityCode,
          mergeStrategy,
        },
        emittedBy: null,
      });
    } catch (_err) {}
  });
}

async function applyToNationalSpine(event: LocalSyncEvent, payload: any): Promise<void> {
  const eventType = event.eventType;

  if (eventType === "result.entered" || eventType === "result.verified") {
    await storage.createEvent({
      eventType,
      entityType: payload.entityType || "test_result",
      entityId: payload.entityId || null,
      payload: {
        ...payload,
        syncSource: "OFFLINE_SYNC",
        originalFacilityCode: event.facilityCode,
        originalEventUuid: event.eventUuid,
        advisoryOriginFlag: event.advisoryOriginFlag,
        sourceType: event.sourceType,
      },
      emittedBy: null,
      facilityId: null,
      labId: null,
      executionContext: "OFFLINE_SYNC",
      processedStatus: "pending",
    });
  } else if (eventType === "sample.created" || eventType === "patient.registered") {
    await storage.createEvent({
      eventType,
      entityType: payload.entityType || eventType.split(".")[0],
      entityId: payload.entityId || null,
      payload: {
        ...payload,
        syncSource: "OFFLINE_SYNC",
        originalFacilityCode: event.facilityCode,
        originalEventUuid: event.eventUuid,
      },
      emittedBy: null,
      facilityId: null,
      labId: null,
      executionContext: "OFFLINE_SYNC",
      processedStatus: "pending",
    });
  }
}

async function handleSyncFailure(event: LocalSyncEvent, errorMessage: string): Promise<void> {
  try {
    const updated = await storage.incrementSyncEventRetry(event.id);
    const retryCount = updated?.retryCount || (event.retryCount || 0) + 1;

    if (retryCount >= MAX_RETRIES) {
      await storage.updateSyncEventStatus(event.id, "FAILED", errorMessage);
      eventBackoffUntil.delete(event.id);
      failedCount++;

      setImmediate(async () => {
        try {
          await eventBus.emitAndPersist({
            eventType: EventTypes.SYNC_FAILED,
            entityType: "local_sync_event",
            entityId: event.id,
            payload: { eventUuid: event.eventUuid, retryCount, errorMessage, facilityCode: event.facilityCode },
            emittedBy: null,
          });
        } catch (_err) {}
      });
    } else {
      setEventBackoff(event.id, retryCount);
      await storage.updateSyncEventStatus(event.id, "PENDING", `Retry ${retryCount}/${MAX_RETRIES}: ${errorMessage}`);
    }
  } catch (_innerErr) {
    failedCount++;
  }
}

async function updateFacilityStatus(facilityCode: string, success: boolean, latencyMs: number, eventCount: number): Promise<void> {
  try {
    const pendingStats = await storage.getSyncEventStats();
    await storage.upsertFacilityConnectivityStatus({
      facilityCode,
      lastSyncAt: new Date(),
      onlineStatus: success ? "ONLINE" : "DEGRADED",
      syncLatencyMs: latencyMs,
      pendingEventCount: pendingStats.pending,
    });
  } catch (_err) {}
}

function deriveExecutionContext(req?: any): string {
  if (!req) return "SYSTEM_INTERNAL";
  if (req.user?.role === "admin") return "ADMIN_SESSION";
  if (req.user?.role === "pathologist") return "PATHOLOGIST_SESSION";
  if (req.user?.role === "technician") return "TECHNICIAN_SESSION";
  if (req.user?.role === "receptionist") return "RECEPTIONIST_SESSION";
  if (req.user) return "USER_SESSION";
  return "ANONYMOUS_REQUEST";
}

export function createOfflineSyncEvent(
  eventType: string,
  facilityCode: string,
  payload: any,
  req?: any,
  advisoryOriginFlag?: boolean,
  sourceType?: string,
): void {
  const executionContext = deriveExecutionContext(req);

  setImmediate(async () => {
    try {
      const sanitized = sanitizePayload(payload);

      if (sanitized.facilityCode && sanitized.facilityCode !== facilityCode) {
        return;
      }

      await storage.createLocalSyncEvent({
        eventUuid: randomUUID().replace(/-/g, "").substring(0, 64),
        eventType,
        facilityCode,
        payload: sanitized,
        executionContext,
        syncStatus: "PENDING",
        retryCount: 0,
        advisoryOriginFlag: advisoryOriginFlag || false,
        sourceType: sourceType || null,
      });
    } catch (_err) {}
  });
}
