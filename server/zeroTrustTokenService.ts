import { storage } from "./storage";
import { createHash, randomBytes, createHmac } from "crypto";
import { eventBus, EventTypes } from "./eventBus";

const TOKEN_TTL_MS = 30 * 60 * 1000;
const ROTATION_GRACE_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function deriveSigningKey(identityUuid: string): string {
  const serverKey = process.env.SESSION_SECRET;
  if (!serverKey) {
    throw new Error("SESSION_SECRET environment variable is required for token signing");
  }
  return createHmac("sha256", serverKey).update(identityUuid).digest("hex");
}

export async function issueIdentityToken(
  identityType: "USER" | "ANALYZER" | "LOCAL_NODE",
  entityRef: number,
  facilityScope: string,
  roleScope: string,
): Promise<{ identityUuid: string; rawToken: string; expiresAt: Date }> {
  const identityUuid = randomBytes(32).toString("hex").substring(0, 64);
  const rawToken = randomBytes(48).toString("hex");
  const signedTokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await storage.createZeroTrustIdentity({
    identityUuid,
    identityType,
    entityRef,
    signedTokenHash,
    facilityScope,
    roleScope,
    tokenStatus: "ACTIVE",
    expiresAt,
    rotatedFrom: null,
  });

  setImmediate(async () => {
    try {
      await eventBus.emitAndPersist({
        eventType: EventTypes.IDENTITY_TOKEN_ISSUED,
        entityType: "zero_trust_identity",
        payload: {
          identityUuid,
          identityType,
          facilityScope,
          roleScope,
          expiresAt: expiresAt.toISOString(),
        },
        emittedBy: null,
      });
    } catch (_err) {}
  });

  return { identityUuid, rawToken, expiresAt };
}

export async function rotateIdentityToken(
  currentIdentityUuid: string,
): Promise<{ identityUuid: string; rawToken: string; expiresAt: Date } | null> {
  const current = await storage.getZeroTrustIdentityByUuid(currentIdentityUuid);
  if (!current) return null;
  if (current.tokenStatus !== "ACTIVE") return null;

  const rotatedGraceExpiresAt = new Date(Date.now() + ROTATION_GRACE_MS);
  await storage.updateZeroTrustIdentityStatus(current.id, "ROTATED", rotatedGraceExpiresAt);

  const newIdentityUuid = randomBytes(32).toString("hex").substring(0, 64);
  const rawToken = randomBytes(48).toString("hex");
  const signedTokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await storage.createZeroTrustIdentity({
    identityUuid: newIdentityUuid,
    identityType: current.identityType,
    entityRef: current.entityRef,
    signedTokenHash,
    facilityScope: current.facilityScope,
    roleScope: current.roleScope,
    tokenStatus: "ACTIVE",
    expiresAt,
    rotatedFrom: currentIdentityUuid,
  });

  setImmediate(async () => {
    try {
      await eventBus.emitAndPersist({
        eventType: EventTypes.IDENTITY_TOKEN_ROTATED,
        entityType: "zero_trust_identity",
        payload: {
          newIdentityUuid,
          previousIdentityUuid: currentIdentityUuid,
          identityType: current.identityType,
        },
        emittedBy: null,
      });
    } catch (_err) {}
  });

  return { identityUuid: newIdentityUuid, rawToken, expiresAt };
}

export async function validateIdentityToken(
  identityUuid: string,
  rawToken: string,
): Promise<{
  valid: boolean;
  identity?: any;
  reason?: string;
  localOnly?: boolean;
}> {
  const identity = await storage.getZeroTrustIdentityByUuid(identityUuid);
  if (!identity) {
    return { valid: false, reason: "IDENTITY_NOT_FOUND" };
  }

  const providedHash = hashToken(rawToken);
  if (providedHash !== identity.signedTokenHash) {
    return { valid: false, reason: "INVALID_TOKEN_SIGNATURE" };
  }

  if (identity.tokenStatus === "REVOKED") {
    return { valid: false, reason: "TOKEN_REVOKED" };
  }

  if (identity.tokenStatus === "ROTATED") {
    const rotationGraceExpiresAt = identity.expiresAt?.getTime() || 0;
    if (rotationGraceExpiresAt > Date.now()) {
      return { valid: true, identity, localOnly: true };
    }
    return { valid: false, reason: "TOKEN_ROTATED_AND_EXPIRED" };
  }

  const now = new Date();
  if (identity.expiresAt && identity.expiresAt < now) {
    await storage.updateZeroTrustIdentityStatus(identity.id, "EXPIRED");
    return { valid: false, reason: "TOKEN_EXPIRED", localOnly: true };
  }

  await storage.updateZeroTrustIdentityLastUsed(identity.id);

  return { valid: true, identity };
}

export async function revokeIdentity(identityUuid: string): Promise<boolean> {
  const identity = await storage.getZeroTrustIdentityByUuid(identityUuid);
  if (!identity) return false;

  await storage.updateZeroTrustIdentityStatus(identity.id, "REVOKED");

  setImmediate(async () => {
    try {
      await eventBus.emitAndPersist({
        eventType: EventTypes.IDENTITY_TOKEN_REVOKED,
        entityType: "zero_trust_identity",
        payload: { identityUuid, identityType: identity.identityType },
        emittedBy: null,
      });
    } catch (_err) {}
  });

  return true;
}

export function isTokenExpiredButLocalAllowed(validationResult: {
  valid: boolean;
  reason?: string;
  localOnly?: boolean;
}): boolean {
  if (validationResult.valid) return false;
  if (validationResult.reason === "TOKEN_EXPIRED" && validationResult.localOnly) return true;
  return false;
}

export function getSigningKey(identityUuid: string): string {
  return deriveSigningKey(identityUuid);
}

export function startTokenCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(async () => {
    try {
      const revoked = await storage.revokeExpiredIdentities();
      if (revoked > 0) {
        await eventBus.emitAndPersist({
          eventType: EventTypes.SECURITY_ALERT,
          entityType: "zero_trust_identity",
          payload: { action: "EXPIRED_TOKENS_REVOKED", count: revoked },
          emittedBy: null,
        });
      }
    } catch (_err) {}
  }, CLEANUP_INTERVAL_MS);
}

export function stopTokenCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
