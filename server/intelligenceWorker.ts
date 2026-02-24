import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import {
  isIntelligenceSourceEvent,
  buildAnonymizedPayload,
  verifyIntelligenceEventSignature,
  containsPatientIdentifiers,
} from "./intelligenceGuardrails";
import { processNotification } from "./notificationEngine";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 25;

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let processedCount = 0;
let failedCount = 0;
let metricsGenerated = 0;
let alertsGenerated = 0;
let lastCycleAt: Date | null = null;

export function startIntelligenceWorker(): void {
  if (workerRunning) return;
  workerRunning = true;

  eventBus.on("*", handlePostCommitEvent);

  workerInterval = setInterval(async () => {
    await processIntelligenceBatch();
  }, POLL_INTERVAL_MS);

  setImmediate(async () => {
    await processIntelligenceBatch();
  });
}

export function stopIntelligenceWorker(): void {
  workerRunning = false;
  eventBus.removeListener("*", handlePostCommitEvent);
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function getIntelligenceWorkerStatus(): {
  running: boolean;
  processedCount: number;
  failedCount: number;
  metricsGenerated: number;
  alertsGenerated: number;
  lastCycleAt: string | null;
} {
  return {
    running: workerRunning,
    processedCount,
    failedCount,
    metricsGenerated,
    alertsGenerated,
    lastCycleAt: lastCycleAt?.toISOString() || null,
  };
}

async function handlePostCommitEvent(event: any): Promise<void> {
  try {
    const eventType = event.eventType || event.event_type;
    if (!eventType || !isIntelligenceSourceEvent(eventType)) return;

    const payload = event.payload || {};

    const sigResult = verifyIntelligenceEventSignature(event);
    if (!sigResult.valid && sigResult.reason !== "NO_PAYLOAD") {
      return;
    }

    const { anonymizedPayload, testCode, facilityCode, sector } = buildAnonymizedPayload(eventType, payload);

    if (containsPatientIdentifiers(anonymizedPayload)) {
      return;
    }

    await storage.createIntelligenceEvent({
      sourceEventId: event.id || null,
      sourceEventType: eventType,
      eventLane: "INTELLIGENCE",
      testCode,
      facilityCode,
      sector,
      anonymizedPayload,
      processingStatus: "PENDING",
    });
  } catch (_err) {
  }
}

async function processIntelligenceBatch(): Promise<void> {
  try {
    const pending = await storage.getPendingIntelligenceEvents(BATCH_SIZE);
    if (pending.length === 0) return;

    for (const event of pending) {
      await processIntelligenceEvent(event);
    }

    lastCycleAt = new Date();

    await evaluateAlertConditions();
  } catch (_err) {
  }
}

async function processIntelligenceEvent(event: any): Promise<void> {
  try {
    const sigResult = verifyIntelligenceEventSignature(event);
    if (!sigResult.valid && sigResult.reason !== "NO_PAYLOAD") {
      await storage.markIntelligenceEventStatus(event.id, "REJECTED");
      failedCount++;
      return;
    }

    const payload = event.anonymizedPayload as Record<string, any> || {};

    if (containsPatientIdentifiers(payload)) {
      await storage.markIntelligenceEventStatus(event.id, "REJECTED");
      failedCount++;
      return;
    }

    await aggregateMetric(event);

    await storage.markIntelligenceEventStatus(event.id, "PROCESSED");
    processedCount++;
  } catch (_err) {
    await storage.markIntelligenceEventStatus(event.id, "FAILED");
    failedCount++;
  }
}

function computeTimestampBucket(date: Date, level: string): Date {
  const bucket = new Date(date);
  bucket.setMinutes(0, 0, 0);
  if (level === "DAILY") {
    bucket.setHours(0);
  }
  return bucket;
}

async function aggregateMetric(event: any): Promise<void> {
  const testCode = event.testCode || "UNKNOWN";
  const facilityCode = event.facilityCode || "UNKNOWN";
  const sector = event.sector || null;
  const bucket = computeTimestampBucket(new Date(event.createdAt || new Date()), "HOURLY");

  const existing = await storage.findAnonymizedMetric(testCode, facilityCode, bucket, "HOURLY");

  if (existing) {
    await storage.incrementAnonymizedMetricCount(existing.metricId);
  } else {
    await storage.createAnonymizedMetric({
      testCode,
      facilityCode,
      sector,
      timestampBucket: bucket,
      count: 1,
      aggregationLevel: "HOURLY",
      metadata: { sourceEventType: event.sourceEventType },
    });
  }

  metricsGenerated++;
}

async function evaluateAlertConditions(): Promise<void> {
  try {
    const recentMetrics = await storage.getRecentAnonymizedMetrics(100);
    if (recentMetrics.length === 0) return;

    const facilityLoad: Record<string, number> = {};
    const testCodeCounts: Record<string, number> = {};

    for (const metric of recentMetrics) {
      const fKey = metric.facilityCode;
      facilityLoad[fKey] = (facilityLoad[fKey] || 0) + metric.count;

      const tKey = metric.testCode;
      testCodeCounts[tKey] = (testCodeCounts[tKey] || 0) + metric.count;
    }

    for (const [facilityCode, totalCount] of Object.entries(facilityLoad)) {
      if (totalCount > 200) {
        const existingAlert = await storage.findRecentIntelligenceAlert(
          "LAB_LOAD_PREDICTION",
          facilityCode,
          24,
        );
        if (!existingAlert) {
          await storage.createIntelligenceAlert({
            alertType: "LAB_LOAD_PREDICTION",
            severity: "ADVISORY",
            facilityCode,
            title: `High lab load detected at facility ${facilityCode}`,
            description: `${totalCount} tests processed in recent window. Consider resource allocation review.`,
            payload: { totalCount, facilityCode },
            classification: "CLINICAL_SUGGESTION",
          });
          alertsGenerated++;

          await publishAlertViaNotification({
            alertType: "LAB_LOAD_PREDICTION",
            title: `High lab load: ${facilityCode}`,
            description: `${totalCount} tests processed recently.`,
          });
        }
      }
    }

    for (const [testCode, totalCount] of Object.entries(testCodeCounts)) {
      if (totalCount > 100) {
        const existingAlert = await storage.findRecentIntelligenceAlert(
          "EPIDEMIOLOGY_ALERT",
          undefined,
          24,
          testCode,
        );
        if (!existingAlert) {
          await storage.createIntelligenceAlert({
            alertType: "EPIDEMIOLOGY_ALERT",
            severity: "ADVISORY",
            testCode,
            title: `Elevated test volume for ${testCode}`,
            description: `${totalCount} orders across facilities in recent window. Possible epidemiological signal.`,
            payload: { testCode, totalCount },
            classification: "CLINICAL_SUGGESTION",
          });
          alertsGenerated++;

          await publishAlertViaNotification({
            alertType: "EPIDEMIOLOGY_ALERT",
            title: `Elevated test volume: ${testCode}`,
            description: `${totalCount} orders detected.`,
          });
        }
      }
    }
  } catch (_err) {
  }
}

async function publishAlertViaNotification(alert: {
  alertType: string;
  title: string;
  description: string;
}): Promise<void> {
  try {
    const syntheticEvent = {
      id: 0,
      eventType: EventTypes.INTELLIGENCE_ALERT_GENERATED,
      payload: {
        alertType: alert.alertType,
        title: alert.title,
        description: alert.description,
        classification: "CLINICAL_SUGGESTION",
      },
      emittedBy: null,
      labId: null,
      createdAt: new Date(),
      processed: false,
      processedAt: null,
    };

    await processNotification(syntheticEvent as any);
  } catch (_err) {
  }
}
