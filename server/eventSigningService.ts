import { createHmac } from "crypto";
import { storage } from "./storage";

function getSigningSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required for event signing");
  }
  return secret;
}

function deriveEventSigningKey(issuerIdentity: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(`event-signing:${issuerIdentity}`)
    .digest("hex");
}

function computeSignatureHash(
  eventType: string,
  payload: any,
  issuerIdentity: string,
  issuedAt: string,
  signingKey: string,
): string {
  const message = JSON.stringify({
    eventType,
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    issuerIdentity,
    issuedAt,
  });
  return createHmac("sha256", signingKey).update(message).digest("hex");
}

export function signEvent(event: {
  eventType: string;
  payload?: any;
  issuerIdentity?: string;
}): {
  signatureHash: string;
  issuerIdentity: string;
  issuedAt: string;
} {
  const issuerIdentity = event.issuerIdentity || "SYSTEM_INTERNAL";
  const issuedAt = new Date().toISOString();
  const signingKey = deriveEventSigningKey(issuerIdentity);
  const signatureHash = computeSignatureHash(
    event.eventType,
    event.payload,
    issuerIdentity,
    issuedAt,
    signingKey,
  );

  return { signatureHash, issuerIdentity, issuedAt };
}

function stripSignatureFields(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  const { signatureHash, issuerIdentity, issuedAt, ...rest } = payload;
  return rest;
}

export function verifyEventSignature(event: {
  eventType: string;
  payload?: any;
  signatureHash?: string;
  issuerIdentity?: string;
  issuedAt?: string;
}): { valid: boolean; reason?: string } {
  if (!event.signatureHash) {
    return { valid: false, reason: "MISSING_SIGNATURE" };
  }

  if (!event.issuerIdentity) {
    return { valid: false, reason: "MISSING_ISSUER_IDENTITY" };
  }

  if (!event.issuedAt) {
    return { valid: false, reason: "MISSING_ISSUED_AT" };
  }

  const signingKey = deriveEventSigningKey(event.issuerIdentity);
  const payloadWithoutSig = stripSignatureFields(event.payload);
  const expectedHash = computeSignatureHash(
    event.eventType,
    payloadWithoutSig,
    event.issuerIdentity,
    event.issuedAt,
    signingKey,
  );

  if (expectedHash !== event.signatureHash) {
    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  }

  return { valid: true };
}

export async function quarantineEvent(
  event: any,
  reason: string,
  severity: string = "HIGH",
): Promise<void> {
  try {
    await storage.createQuarantineEntry({
      originalEventId: event.id || null,
      eventType: event.eventType || "UNKNOWN",
      payload: event.payload || event,
      quarantineReason: reason,
      signatureHash: event.signatureHash || null,
      issuerIdentity: event.issuerIdentity || null,
      severity,
      reviewStatus: "PENDING",
    });

    await storage.createSecurityEvent({
      userId: null,
      eventType: "SECURITY_ALERT",
      severity,
      details: {
        alertType: "EVENT_QUARANTINED",
        reason,
        originalEventType: event.eventType,
        originalEventId: event.id,
        issuerIdentity: event.issuerIdentity,
      },
      actionTaken: "QUARANTINED",
      sessionId: null,
    });
  } catch (_err) {}
}

export function signEventPayload(payload: any, issuerIdentity: string): any {
  const signing = signEvent({
    eventType: payload.eventType || "unknown",
    payload,
    issuerIdentity,
  });

  return {
    ...payload,
    signatureHash: signing.signatureHash,
    issuerIdentity: signing.issuerIdentity,
    issuedAt: signing.issuedAt,
  };
}
