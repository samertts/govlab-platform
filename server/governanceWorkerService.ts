import { storage } from "./storage";
import { evaluateGovernance } from "./governanceEngine";
import { evaluatePathways } from "./clinicalPathwaysEngine";
import { eventBus, EventTypes } from "./eventBus";
import type { GovernanceJob, Event } from "@shared/schema";

const POLL_INTERVAL_MS = 7_000;
const BATCH_SIZE = 30;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000;

const SENSITIVE_PAYLOAD_KEYS = [
  "nationalIdEncrypted", "national_id_encrypted", "nationalIdHash",
  "national_id_hash", "password", "token", "secret", "tokenHash",
];

const labRateTracker = new Map<number, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60_000;
const MAX_JOBS_PER_LAB_PER_WINDOW = 100;

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let processedCount = 0;
let failedCount = 0;
let lastCycleAt: Date | null = null;

export function startGovernanceWorker(): void {
  if (workerRunning) return;
  workerRunning = true;

  workerInterval = setInterval(async () => {
    await processBatch();
  }, POLL_INTERVAL_MS);

  setImmediate(async () => {
    await processBatch();
  });
}

export function stopGovernanceWorker(): void {
  workerRunning = false;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function getGovernanceWorkerStatus(): {
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
    const pendingJobs = await storage.getPendingGovernanceJobs(BATCH_SIZE);
    if (pendingJobs.length === 0) return;

    for (const job of pendingJobs) {
      if (isJobInBackoff(job.id)) continue;
      if (!checkLabRateLimit(job.labId)) continue;

      await processJob(job);
    }

    lastCycleAt = new Date();
  } catch (_err) {
  }
}

function checkLabRateLimit(labId: number | null): boolean {
  if (!labId) return true;
  const now = Date.now();
  let tracker = labRateTracker.get(labId);

  if (!tracker || (now - tracker.windowStart > RATE_WINDOW_MS)) {
    tracker = { count: 0, windowStart: now };
    labRateTracker.set(labId, tracker);
  }

  if (tracker.count >= MAX_JOBS_PER_LAB_PER_WINDOW) {
    return false;
  }

  tracker.count++;
  return true;
}

function sanitizeJobPayload(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload.map(item => sanitizeJobPayload(item));
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_PAYLOAD_KEYS.includes(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeJobPayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function validateExecutionContext(context: string | null): boolean {
  if (!context) return true;
  return ["USER_SESSION", "ANALYZER_SOURCE", "FEDERATION_GATEWAY", "OFFLINE_SYNC", "WORKER"].includes(context);
}

async function processJob(job: GovernanceJob): Promise<void> {
  try {
    if (!validateExecutionContext(job.executionContext)) {
      await storage.updateGovernanceJobStatus(job.id, "FAILED", null, "Invalid execution context");
      failedCount++;
      return;
    }

    const sanitizedPayload = sanitizeJobPayload(job.payload);

    await storage.updateGovernanceJobStatus(job.id, "PROCESSING");

    let jobResult: any = null;

    switch (job.jobType) {
      case "POLICY_CHECK": {
        jobResult = await executePolicyCheck(job, sanitizedPayload);
        break;
      }
      case "PATHWAY_EVALUATION": {
        jobResult = await executePathwayEvaluation(job, sanitizedPayload);
        break;
      }
      case "NATIONAL_REVIEW": {
        jobResult = await executeNationalReview(job, sanitizedPayload);
        break;
      }
      default: {
        await storage.updateGovernanceJobStatus(job.id, "FAILED", null, `Unknown job type: ${job.jobType}`);
        failedCount++;
        return;
      }
    }

    await storage.updateGovernanceJobStatus(job.id, "COMPLETED", jobResult);

    try {
      await eventBus.emitAndPersist({
        eventType: EventTypes.GOVERNANCE_JOB_COMPLETED,
        entityType: "governance_job",
        entityId: job.id,
        payload: { jobType: job.jobType, labId: job.labId, outcome: jobResult?.outcome || jobResult?.alertType },
        emittedBy: null,
      });
    } catch (_err) {}

    if (jobResult?.alertType) {
      await emitAdvisoryAlert(job, jobResult);
    }

    processedCount++;
  } catch (err: any) {
    await handleJobFailure(job, err?.message || "Unknown error");
  }
}

async function executePolicyCheck(job: GovernanceJob, payload: any): Promise<any> {
  const testCode = job.testCode || payload?.testCode;
  const patientId = job.patientId || payload?.patientId;
  const specimenId = job.specimenId || payload?.specimenId;

  if (!testCode || !patientId) {
    return { outcome: "SKIP", reason: "Missing testCode or patientId" };
  }

  try {
    const result = await evaluateGovernance(
      testCode,
      payload?.sector || "PUBLIC",
      patientId,
      specimenId,
      (job.executionContext as any) || "WORKER",
      null,
    );

    const alertType = resolveAlertType(result.overallOutcome);

    return {
      outcome: result.overallOutcome,
      advisoryOnly: result.advisoryOnly,
      evaluationCount: result.evaluations.length,
      pendingAdvisoryCount: result.pendingAdvisoryCount,
      alertType,
    };
  } catch (_err) {
    return { outcome: "ERROR", reason: "Policy evaluation failed" };
  }
}

async function executePathwayEvaluation(job: GovernanceJob, payload: any): Promise<any> {
  const testCode = job.testCode || payload?.testCode;
  const patientId = job.patientId || payload?.patientId;
  const sampleId = payload?.sampleId;

  if (!testCode) {
    return { outcome: "SKIP", reason: "Missing testCode" };
  }

  try {
    const result = await evaluatePathways(
      testCode,
      payload?.sector || "PUBLIC",
      patientId || 0,
      sampleId || null,
      (job.executionContext as any) || "WORKER",
      null,
    );

    const highestLevel = result.suggestions && result.suggestions.length > 0
      ? result.suggestions.reduce((max, s) => {
          const levels = ["INFO", "WARN", "REQUIRE_APPROVAL"];
          return levels.indexOf(s.suggestionLevel) > levels.indexOf(max) ? s.suggestionLevel : max;
        }, "INFO" as string)
      : "INFO";

    const alertType = result.suggestions && result.suggestions.length > 0
      ? resolvePathwayAlertType(highestLevel)
      : null;

    return {
      suggestionCount: result.suggestions?.length || 0,
      highestLevel,
      alertType,
    };
  } catch (_err) {
    return { outcome: "ERROR", reason: "Pathway evaluation failed" };
  }
}

async function executeNationalReview(job: GovernanceJob, payload: any): Promise<any> {
  const testCode = job.testCode || payload?.testCode;
  const patientId = job.patientId || payload?.patientId;

  const results: any[] = [];

  if (testCode && patientId) {
    try {
      const govResult = await evaluateGovernance(
        testCode,
        payload?.sector || "PUBLIC",
        patientId,
        job.specimenId,
        (job.executionContext as any) || "WORKER",
        null,
      );
      results.push({ engine: "GOVERNANCE", outcome: govResult.overallOutcome });
    } catch (_err) {
      results.push({ engine: "GOVERNANCE", outcome: "ERROR" });
    }

    try {
      const pathResult = await evaluatePathways(
        testCode,
        payload?.sector || "PUBLIC",
        patientId,
        null,
        (job.executionContext as any) || "WORKER",
        null,
      );
      results.push({ engine: "PATHWAYS", suggestionCount: pathResult.suggestions?.length || 0 });
    } catch (_err) {
      results.push({ engine: "PATHWAYS", outcome: "ERROR" });
    }
  }

  const hasFlags = results.some(r => r.outcome && r.outcome !== "ALLOW" && r.outcome !== "ERROR");
  return {
    reviewResults: results,
    alertType: hasFlags ? "NATIONAL_FLAG" : null,
  };
}

function resolveAlertType(outcome: string): string | null {
  switch (outcome) {
    case "BLOCK":
    case "REQUIRE_APPROVAL":
      return "REVIEW_REQUIRED";
    case "WARN":
      return "SOFT_ALERT";
    default:
      return null;
  }
}

function resolvePathwayAlertType(highestLevel: string): string | null {
  if (!highestLevel) return null;
  const upper = highestLevel.toUpperCase();
  if (upper === "CRITICAL" || upper === "REQUIRE_APPROVAL") return "REVIEW_REQUIRED";
  if (upper === "WARN" || upper === "WARNING") return "SOFT_ALERT";
  return null;
}

async function emitAdvisoryAlert(job: GovernanceJob, result: any): Promise<void> {
  try {
    const alertType = result.alertType as string;
    const notificationType = alertType === "NATIONAL_FLAG" ? "CRITICAL"
      : alertType === "REVIEW_REQUIRED" ? "WARN"
      : "INFO";

    const message = buildAlertMessage(alertType, job, result);

    await storage.createNotification({
      userId: 0,
      message,
      notificationType,
      entityRef: job.specimenId ? `specimen:${job.specimenId}` : null,
    });

    try {
      await eventBus.emitAndPersist({
        eventType: EventTypes.NOTIFICATION_CREATED,
        entityType: "governance_job",
        entityId: job.id,
        payload: {
          alertType,
          notificationType,
          jobType: job.jobType,
          jobId: job.id,
          testCode: job.testCode,
          advisory: true,
        },
        emittedBy: null,
      });
    } catch (_err) {
    }
  } catch (_err) {
  }
}

function buildAlertMessage(alertType: string, job: GovernanceJob, result: any): string {
  const testRef = job.testCode || "unknown test";
  switch (alertType) {
    case "SOFT_ALERT":
      return `Advisory: ${job.jobType} flagged ${testRef} — ${result.outcome || "review suggested"}`;
    case "REVIEW_REQUIRED":
      return `Review required: ${job.jobType} evaluation for ${testRef} requires attention`;
    case "NATIONAL_FLAG":
      return `National flag: ${testRef} flagged during national review — supervisory review recommended`;
    default:
      return `Governance advisory for ${testRef}`;
  }
}

const jobBackoffUntil = new Map<number, number>();

async function handleJobFailure(job: GovernanceJob, errorMessage: string): Promise<void> {
  try {
    const updated = await storage.incrementGovernanceJobRetry(job.id);
    const retryCount = updated?.retryCount || (job.retryCount || 0) + 1;

    if (retryCount >= MAX_RETRIES) {
      await storage.updateGovernanceJobStatus(job.id, "FAILED", null, errorMessage);
      jobBackoffUntil.delete(job.id);
      failedCount++;

      try {
        await eventBus.emitAndPersist({
          eventType: EventTypes.GOVERNANCE_JOB_FAILED,
          entityType: "governance_job",
          entityId: job.id,
          payload: { jobType: job.jobType, retryCount, errorMessage, labId: job.labId },
          emittedBy: null,
        });
      } catch (_err) {}
    } else {
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, retryCount - 1);
      jobBackoffUntil.set(job.id, Date.now() + backoffMs);
      await storage.updateGovernanceJobStatus(job.id, "PENDING", null, `Retry ${retryCount}/${MAX_RETRIES} (backoff ${backoffMs}ms): ${errorMessage}`);
    }
  } catch (_innerErr) {
    failedCount++;
  }
}

function isJobInBackoff(jobId: number): boolean {
  const until = jobBackoffUntil.get(jobId);
  if (!until) return false;
  if (Date.now() >= until) {
    jobBackoffUntil.delete(jobId);
    return false;
  }
  return true;
}

export function emitGovernanceJobPostCommit(event: Event): void {
  setImmediate(async () => {
    try {
      const payload = event.payload as Record<string, any> | null;
      if (!payload) return;

      const eventId = event.id;
      const executionContext = event.executionContext || null;
      const labId = event.labId || payload?.labId || null;
      const testCode = payload?.testCode || payload?.triggerTestCode || null;
      const patientId = payload?.patientId || null;
      const specimenId = payload?.specimenId || event.entityId || null;

      const existingPolicy = await storage.findDuplicateGovernanceJob(eventId, "POLICY_CHECK");
      if (!existingPolicy) {
        const policyJob = await storage.createGovernanceJob({
          eventId,
          jobType: "POLICY_CHECK",
          jobSource: "GOVERNANCE_ENGINE",
          status: "PENDING",
          retryCount: 0,
          executionContext,
          labId,
          testCode,
          patientId,
          specimenId,
          payload: { ...payload, sector: payload?.sector || "PUBLIC" },
        });
        try {
          await eventBus.emitAndPersist({
            eventType: EventTypes.GOVERNANCE_JOB_CREATED,
            entityType: "governance_job",
            entityId: policyJob.id,
            payload: { jobType: "POLICY_CHECK", eventId, labId, testCode },
            emittedBy: null,
          });
        } catch (_err) {}
      }

      const existingPathway = await storage.findDuplicateGovernanceJob(eventId, "PATHWAY_EVALUATION");
      if (!existingPathway) {
        const pathwayJob = await storage.createGovernanceJob({
          eventId,
          jobType: "PATHWAY_EVALUATION",
          jobSource: "PATHWAY_ENGINE",
          status: "PENDING",
          retryCount: 0,
          executionContext,
          labId,
          testCode,
          patientId,
          specimenId,
          payload,
        });
        try {
          await eventBus.emitAndPersist({
            eventType: EventTypes.GOVERNANCE_JOB_CREATED,
            entityType: "governance_job",
            entityId: pathwayJob.id,
            payload: { jobType: "PATHWAY_EVALUATION", eventId, labId, testCode },
            emittedBy: null,
          });
        } catch (_err) {}
      }
    } catch (_err) {
    }
  });
}

export function setupGovernanceEventSubscriptions(): void {
  const targetEvents = [
    EventTypes.RESULT_ENTERED,
    EventTypes.RESULT_VERIFIED,
    EventTypes.TEST_ORDERED,
  ];

  for (const eventType of targetEvents) {
    eventBus.on(eventType, (event: Event) => {
      emitGovernanceJobPostCommit(event);
    });
  }
}
