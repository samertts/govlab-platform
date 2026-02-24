import { EventEmitter } from "events";
import { storage } from "./storage";
import type { InsertEvent } from "@shared/schema";

class UnifiedEventBus extends EventEmitter {
  override emit(eventType: string, ...args: any[]): boolean {
    return super.emit(eventType, ...args);
  }

  async emitAndPersist(event: InsertEvent): Promise<void> {
    await storage.createEvent(event);
    super.emit(event.eventType, event);
    super.emit("*", event);
  }
}

export const eventBus = new UnifiedEventBus();

export const EventTypes = {
  SAMPLE_CREATED: "sample.created",
  RESULT_ENTERED: "result.entered",
  RESULT_VERIFIED: "result.verified",
  PATIENT_REGISTERED: "patient.registered",
  ANALYZER_INGEST: "analyzer.ingest",
  OFFLINE_SYNC: "offline.sync",
  INVOICE_GENERATED: "invoice.generated",
  TOKEN_ISSUED: "token.issued",
  ORG_CREATED: "org.created",
  FACILITY_CREATED: "facility.created",
  IDENTITY_VERIFICATION_REQUEST: "identity.verification.request",
  IDENTITY_VERIFICATION_COMPLETED: "identity.verification.completed",
  GOVERNANCE_EVALUATED: "governance.evaluated",
  GOVERNANCE_POLICY_CREATED: "governance.policy.created",
  GOVERNANCE_POLICY_UPDATED: "governance.policy.updated",
} as const;
