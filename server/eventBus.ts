import { EventEmitter } from "events";
import { storage } from "./storage";
import type { InsertEvent } from "@shared/schema";
import { signEvent } from "./eventSigningService";

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

class UnifiedEventBus extends EventEmitter {
  override emit(eventType: string, ...args: any[]): boolean {
    return super.emit(eventType, ...args);
  }

  async emitAndPersist(event: InsertEvent): Promise<void> {
    const sanitizedPayload = sanitizePayload(event.payload);

    const signing = signEvent({
      eventType: event.eventType,
      payload: sanitizedPayload,
      issuerIdentity: (event as any).issuerIdentity,
    });

    const signedPayload = {
      ...(typeof sanitizedPayload === "object" && sanitizedPayload !== null ? sanitizedPayload : { data: sanitizedPayload }),
      signatureHash: signing.signatureHash,
      issuerIdentity: signing.issuerIdentity,
      issuedAt: signing.issuedAt,
    };

    const sanitizedEvent = {
      ...event,
      payload: signedPayload,
    };

    await storage.createEvent(sanitizedEvent);
    super.emit(sanitizedEvent.eventType, sanitizedEvent);
    super.emit("*", sanitizedEvent);
  }
}

export const eventBus = new UnifiedEventBus();

export const EventTypes = {
  SAMPLE_CREATED: "sample.created",
  RESULT_ENTERED: "result.entered",
  RESULT_VERIFIED: "result.verified",
  PATIENT_REGISTERED: "patient.registered",
  QC_FLAGGED: "qc.flagged",
  ANALYZER_INGEST: "analyzer.ingest",
  OFFLINE_SYNC: "offline.sync",
  INVOICE_GENERATED: "invoice.generated",
  TOKEN_ISSUED: "token.issued",
  ORG_CREATED: "org.created",
  FACILITY_CREATED: "facility.created",
  IDENTITY_VERIFICATION_REQUEST: "identity.verification.request",
  IDENTITY_VERIFICATION_COMPLETED: "identity.verification.completed",
  IDENTITY_VERIFIED: "identity.verified",
  GOVERNANCE_EVALUATED: "governance.evaluated",
  GOVERNANCE_POLICY_CREATED: "governance.policy.created",
  GOVERNANCE_POLICY_UPDATED: "governance.policy.updated",
  CLINICAL_PATHWAY_EVALUATED: "clinical.pathway.evaluated",
  CLINICAL_PATHWAY_CREATED: "clinical.pathway.created",
  CLINICAL_PATHWAY_UPDATED: "clinical.pathway.updated",
  PATHWAY_RULE_CREATED: "pathway.rule.created",
  PATHWAY_RULE_UPDATED: "pathway.rule.updated",
  PATHWAY_EVALUATED: "pathway.evaluated",
  NOTIFICATION_CREATED: "notification.created",
  SECURITY_ANOMALY: "security.anomaly",
  WORKER_CYCLE_COMPLETE: "worker.cycle.complete",
  TEST_ORDERED: "test.ordered",
  GOVERNANCE_JOB_CREATED: "governance.job.created",
  GOVERNANCE_JOB_COMPLETED: "governance.job.completed",
  GOVERNANCE_JOB_FAILED: "governance.job.failed",
  DATA_ARCHIVED: "data.archived",
  DATA_ARCHIVE_FAILED: "data.archive.failed",
  PATIENT_HISTORY_UPDATED: "patient.history.updated",
  ANALYZER_RESULT_RECEIVED: "analyzer.result.received",
  ANALYZER_RESULT_PROCESSED: "analyzer.result.processed",
  ANALYZER_RESULT_FAILED: "analyzer.result.failed",
  SYNC_EVENT_CREATED: "sync.event.created",
  SYNC_COMPLETED: "sync.completed",
  SYNC_CONFLICT_DETECTED: "sync.conflict.detected",
  SYNC_FAILED: "sync.failed",
  GLOBAL_BUDGET_WARNING: "global.budget.warning",
  FACILITY_CONNECTIVITY_CHANGED: "facility.connectivity.changed",
  IDENTITY_TOKEN_ISSUED: "identity.token.issued",
  IDENTITY_TOKEN_ROTATED: "identity.token.rotated",
  IDENTITY_TOKEN_REVOKED: "identity.token.revoked",
  IDENTITY_TOKEN_EXPIRED: "identity.token.expired",
  SECURITY_ALERT: "security.alert",
  EVENT_QUARANTINED: "event.quarantined",
  CROSS_FACILITY_ACCESS: "cross.facility.access",
  NATIONAL_AUDIT_LOGGED: "national.audit.logged",
} as const;
