import { verifyEventSignature } from "./eventSigningService";

const PATIENT_IDENTIFIER_FIELDS = [
  "patientId", "patient_id",
  "nationalId", "national_id", "nationalIdNumber", "national_id_number",
  "nationalIdEncrypted", "national_id_encrypted",
  "nationalIdHash", "national_id_hash",
  "patientIdentityToken", "patient_identity_token",
  "firstName", "first_name", "lastName", "last_name",
  "fullName", "full_name", "patientName", "patient_name",
  "dateOfBirth", "date_of_birth", "dob",
  "address", "phone", "phoneNumber", "phone_number",
  "email", "contactEmail", "contact_email",
  "emergencyContact", "emergency_contact",
  "gender", "sex",
  "insuranceNumber", "insurance_number",
  "mrn", "medicalRecordNumber", "medical_record_number",
];

const INTELLIGENCE_SOURCE_EVENTS = [
  "result.verified",
  "qc.flagged",
  "test.ordered",
];

export function isIntelligenceSourceEvent(eventType: string): boolean {
  return INTELLIGENCE_SOURCE_EVENTS.includes(eventType);
}

export function stripPatientIdentifiers(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload.map(item => stripPatientIdentifiers(item));

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (PATIENT_IDENTIFIER_FIELDS.includes(key)) {
      continue;
    }
    if (typeof value === "object" && value !== null) {
      sanitized[key] = stripPatientIdentifiers(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function containsPatientIdentifiers(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray(payload)) return payload.some(item => containsPatientIdentifiers(item));

  for (const key of Object.keys(payload)) {
    if (PATIENT_IDENTIFIER_FIELDS.includes(key) && payload[key] != null && payload[key] !== "[REDACTED]") {
      return true;
    }
    if (typeof payload[key] === "object" && payload[key] !== null) {
      if (containsPatientIdentifiers(payload[key])) return true;
    }
  }
  return false;
}

export function verifyIntelligenceEventSignature(event: any): { valid: boolean; reason?: string } {
  const payload = event.payload;
  if (!payload) return { valid: true, reason: "NO_PAYLOAD" };

  if (payload.signatureHash) {
    return verifyEventSignature({
      eventType: event.eventType || event.sourceEventType,
      payload,
      signatureHash: payload.signatureHash,
      issuerIdentity: payload.issuerIdentity,
      issuedAt: payload.issuedAt,
    });
  }

  return { valid: true };
}

export function buildAnonymizedPayload(eventType: string, payload: any): {
  testCode: string | null;
  facilityCode: string | null;
  sector: string | null;
  anonymizedPayload: Record<string, any>;
} {
  const stripped = stripPatientIdentifiers(payload || {});

  if (containsPatientIdentifiers(stripped)) {
    throw new Error("INTELLIGENCE_GUARDRAIL: Patient identifiers detected after stripping — event rejected");
  }

  const testCode = stripped.testCode || stripped.test_code || stripped.testTypeCode || null;
  const facilityCode = stripped.facilityCode || stripped.facility_code || stripped.labCode || null;
  const sector = stripped.sector || stripped.department || null;

  const { signatureHash, issuerIdentity, issuedAt, ...cleanPayload } = stripped;

  return {
    testCode,
    facilityCode,
    sector,
    anonymizedPayload: {
      eventType,
      ...cleanPayload,
      processedAt: new Date().toISOString(),
    },
  };
}
