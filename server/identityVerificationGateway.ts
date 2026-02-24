import { storage } from "./storage";
import { hashNationalId } from "./nationalIdEncryption";
import { eventBus, EventTypes } from "./eventBus";

export type VerificationResult = {
  status: "VERIFIED" | "NOT_VERIFIED" | "PENDING";
  source: string;
};

async function callMockVerificationService(nationalIdHash: string): Promise<VerificationResult> {
  return new Promise((resolve) => {
    const delay = 500 + Math.random() * 1500;
    setTimeout(() => {
      const rand = Math.random();
      if (rand < 0.7) {
        resolve({ status: "VERIFIED", source: "MOCK_GATEWAY" });
      } else if (rand < 0.9) {
        resolve({ status: "NOT_VERIFIED", source: "MOCK_GATEWAY" });
      } else {
        resolve({ status: "PENDING", source: "MOCK_GATEWAY" });
      }
    }, delay);
  });
}

export async function processIdentityVerification(
  patientId: number,
  nationalId: string,
  executionContext: string,
  emittedBy?: number
): Promise<void> {
  const nationalIdHash = hashNationalId(nationalId);

  const verification = await storage.createIdentityVerification({
    patientId,
    nationalIdHash,
    verificationStatus: "PENDING",
    verificationSource: "MOCK_GATEWAY",
    executionContext,
  });

  try {
    const result = await callMockVerificationService(nationalIdHash);

    await storage.updateIdentityVerificationStatus(
      verification.id,
      result.status,
      result.status === "VERIFIED" ? new Date() : undefined
    );

    await eventBus.emitAndPersist({
      eventType: EventTypes.IDENTITY_VERIFICATION_COMPLETED,
      entityType: "identity_verification",
      entityId: verification.id,
      payload: {
        patientId,
        verificationStatus: result.status,
        verificationSource: result.source,
        executionContext,
      },
      emittedBy: emittedBy || null,
      facilityId: null,
    });
  } catch (err) {
    await storage.updateIdentityVerificationStatus(verification.id, "PENDING");

    const CONTEXT_TO_RETRY_PATH: Record<string, string> = {
      USER_SESSION: `/api/sovereign/identity/verify/${patientId}`,
      ANALYZER_SOURCE: `/api/analyzers/identity/verify/${patientId}`,
      FEDERATION_GATEWAY: `/api/federation/identity/verify/${patientId}`,
    };
    const retryEndpoint = CONTEXT_TO_RETRY_PATH[executionContext] || `/api/sovereign/identity/verify/${patientId}`;

    await storage.enqueueOfflineOp({
      operationType: "identity_verification_retry",
      endpoint: retryEndpoint,
      method: "POST",
      payload: { patientId, executionContext, verificationId: verification.id },
      staffId: emittedBy || null,
      facilityId: null,
      status: "pending",
    });
  }
}

export function setupIdentityVerificationListener(): void {
  eventBus.on(EventTypes.IDENTITY_VERIFICATION_REQUEST, async (event: any) => {
    const { patientId, executionContext, emittedBy } = event.payload || {};
    if (!patientId) return;

    const patient = await storage.getPatient(patientId);
    if (!patient?.nationalIdEncrypted) return;

    const { decryptNationalId } = await import("./nationalIdEncryption");
    const nationalId = decryptNationalId(patient.nationalIdEncrypted);

    await processIdentityVerification(
      patientId,
      nationalId,
      executionContext || "USER_SESSION",
      emittedBy
    );
  });
}
