import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import { createHash } from "crypto";
import type { Analyzer } from "@shared/schema";

const SENSITIVE_PAYLOAD_KEYS = [
  "nationalIdEncrypted", "national_id_encrypted", "nationalIdHash",
  "national_id_hash", "password", "token", "secret", "tokenHash",
  "analyzerToken", "analyzer_token",
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

const analyzerBudgets = new Map<string, { count: number; windowStart: number }>();
const BUDGET_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_ANALYZER_PER_WINDOW = 120;

function checkIngestionBudget(analyzerId: string): { allowed: boolean; queued: boolean } {
  const now = Date.now();
  const tracker = analyzerBudgets.get(analyzerId);
  if (!tracker || (now - tracker.windowStart) > BUDGET_WINDOW_MS) {
    analyzerBudgets.set(analyzerId, { count: 1, windowStart: now });
    return { allowed: true, queued: false };
  }
  tracker.count++;
  if (tracker.count > MAX_EVENTS_PER_ANALYZER_PER_WINDOW) {
    return { allowed: true, queued: true };
  }
  return { allowed: true, queued: false };
}

function computeMessageHash(payload: any): string {
  const normalized = JSON.stringify(payload, Object.keys(payload || {}).sort());
  return createHash("sha256").update(normalized).digest("hex");
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface NormalizedAnalyzerMessage {
  testCode: string;
  resultValue: string;
  specimenId?: string;
  patientId?: string;
  patientMrn?: string;
  messageType: string;
  rawSegments?: any;
}

function normalizeHL7Message(rawMessage: string): NormalizedAnalyzerMessage {
  const segments = rawMessage.split("\r").filter(Boolean);
  let testCode = "";
  let resultValue = "";
  let specimenId = "";
  let patientId = "";
  let patientMrn = "";
  let messageType = "ORM";

  for (const segment of segments) {
    const fields = segment.split("|");
    const segType = fields[0];

    if (segType === "MSH" && fields.length > 8) {
      messageType = fields[8]?.split("^")[0] || "ORM";
    } else if (segType === "PID" && fields.length > 3) {
      patientId = fields[3]?.split("^")[0] || "";
      patientMrn = fields[3]?.split("^")[0] || "";
    } else if (segType === "OBR" && fields.length > 4) {
      testCode = fields[4]?.split("^")[0] || "";
      specimenId = fields[3]?.split("^")[0] || "";
    } else if (segType === "OBX" && fields.length > 5) {
      testCode = testCode || fields[3]?.split("^")[0] || "";
      resultValue = fields[5] || "";
    }
  }

  return {
    testCode,
    resultValue,
    specimenId,
    patientId,
    patientMrn,
    messageType,
    rawSegments: segments,
  };
}

function normalizeASTMMessage(rawMessage: string): NormalizedAnalyzerMessage {
  const records = rawMessage.split("\r").filter(Boolean);
  let testCode = "";
  let resultValue = "";
  let specimenId = "";
  let patientId = "";
  let patientMrn = "";

  for (const record of records) {
    const fields = record.split("|");
    const recType = fields[0];

    if (recType === "P" && fields.length > 2) {
      patientId = fields[2] || "";
      patientMrn = fields[2] || "";
    } else if (recType === "O" && fields.length > 2) {
      specimenId = fields[2] || "";
    } else if (recType === "R" && fields.length > 3) {
      testCode = fields[2]?.split("^")[0] || "";
      resultValue = fields[3] || "";
    }
  }

  return {
    testCode,
    resultValue,
    specimenId,
    patientId,
    patientMrn,
    messageType: "ASTM",
  };
}

function normalizeJsonPayload(payload: any): NormalizedAnalyzerMessage {
  return {
    testCode: payload.testCode || payload.test_code || "",
    resultValue: String(payload.resultValue ?? payload.result_value ?? ""),
    specimenId: payload.specimenId || payload.specimen_id || "",
    patientId: payload.patientId || payload.patient_id || "",
    patientMrn: payload.patientMrn || payload.patient_mrn || "",
    messageType: "JSON",
  };
}

export interface IngestResult {
  success: boolean;
  eventId?: number;
  messageHash?: string;
  budgetExceeded?: boolean;
  duplicate?: boolean;
  error?: string;
}

export async function authenticateAnalyzer(bearerToken: string): Promise<Analyzer | null> {
  const tokenHash = hashToken(bearerToken);
  const analyzer = await storage.getAnalyzerByTokenHash(tokenHash);
  if (!analyzer) return null;
  if (!analyzer.isActive) return null;
  await storage.updateAnalyzerLastUsed(analyzer.id);
  return analyzer;
}

export async function validateFacilityCode(facilityCode: string): Promise<boolean> {
  const labs = await storage.getLabs();
  return labs.some(lab => lab.facilityCode === facilityCode);
}

export async function ingestMessage(
  analyzer: Analyzer,
  messageFormat: "HL7" | "ASTM" | "JSON",
  rawPayload: string | Record<string, any>,
): Promise<IngestResult> {
  let normalized: NormalizedAnalyzerMessage;
  try {
    if (messageFormat === "HL7" && typeof rawPayload === "string") {
      normalized = normalizeHL7Message(rawPayload);
    } else if (messageFormat === "ASTM" && typeof rawPayload === "string") {
      normalized = normalizeASTMMessage(rawPayload);
    } else if (messageFormat === "JSON" && typeof rawPayload === "object") {
      normalized = normalizeJsonPayload(rawPayload);
    } else {
      return { success: false, error: "Unsupported message format or payload type" };
    }
  } catch (_err) {
    return { success: false, error: "Failed to normalize message" };
  }

  if (!normalized.testCode) {
    return { success: false, error: "Missing test code in normalized message" };
  }

  const sanitizedPayload = sanitizePayload({
    ...normalized,
    analyzerType: analyzer.analyzerType,
    facilityCode: analyzer.facilityCode,
    originType: "ANALYZER",
    advisoryOriginFlag: false,
  });

  const messageHash = computeMessageHash({
    analyzerId: analyzer.analyzerId,
    testCode: normalized.testCode,
    resultValue: normalized.resultValue,
    specimenId: normalized.specimenId,
    patientId: normalized.patientId,
  });

  const duplicate = await storage.findDuplicateAnalyzerEvent(analyzer.analyzerId, messageHash);
  if (duplicate) {
    return { success: true, duplicate: true, messageHash, eventId: duplicate.id };
  }

  const budget = checkIngestionBudget(analyzer.analyzerId);

  const event = await storage.enqueueAnalyzerEvent({
    eventType: "RESULT_RECEIVED",
    analyzerId: analyzer.analyzerId,
    messageHash,
    payload: sanitizedPayload,
    processedStatus: budget.queued ? "queued" : "pending",
    labId: null,
  });

  try {
    await eventBus.emitAndPersist({
      eventType: EventTypes.ANALYZER_INGEST,
      entityType: "analyzer_event",
      entityId: event.id,
      payload: sanitizePayload({
        analyzerId: analyzer.analyzerId,
        messageHash,
        testCode: normalized.testCode,
        budgetExceeded: budget.queued,
        originType: "ANALYZER",
        advisoryOriginFlag: false,
      }),
      emittedBy: null,
    });
  } catch (_eventErr) {}

  return {
    success: true,
    eventId: event.id,
    messageHash,
    budgetExceeded: budget.queued,
  };
}

export function getGatewayStatus(): {
  activeBudgets: number;
  budgetWindowMs: number;
  maxEventsPerWindow: number;
} {
  return {
    activeBudgets: analyzerBudgets.size,
    budgetWindowMs: BUDGET_WINDOW_MS,
    maxEventsPerWindow: MAX_EVENTS_PER_ANALYZER_PER_WINDOW,
  };
}
