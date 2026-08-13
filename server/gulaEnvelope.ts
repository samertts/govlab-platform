import { createHash } from "node:crypto";

export type GulaOperationalEvent = "platform.diagnostic.reported";

export interface GulaOperationalEnvelope {
  event_id: string;
  event_type: GulaOperationalEvent;
  schema_version: number;
  source_service: "govlab-platform";
  tenant_id: string;
  occurred_at: string;
  actor_id: string;
  entity_id: string;
  correlation_id: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
}

export function createGulaDiagnosticEnvelope(input: {
  diagnosticId: string;
  tenantId: string;
  actorId: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}): GulaOperationalEnvelope {
  if (!input.diagnosticId.trim() || !input.tenantId.trim() || !input.actorId.trim()) {
    throw new Error("diagnosticId, tenantId, and actorId are required");
  }
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error("occurredAt must be an ISO timestamp");
  const idempotencyKey = createHash("sha256")
    .update(`${input.tenantId}:${input.diagnosticId}`)
    .digest("hex");
  return {
    event_id: input.diagnosticId,
    event_type: "platform.diagnostic.reported",
    schema_version: 1,
    source_service: "govlab-platform",
    tenant_id: input.tenantId,
    occurred_at: occurredAt,
    actor_id: input.actorId,
    entity_id: input.diagnosticId,
    correlation_id: input.diagnosticId,
    idempotency_key: idempotencyKey,
    payload: { ...input.payload },
  };
}
