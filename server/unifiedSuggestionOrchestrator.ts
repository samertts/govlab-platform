import { storage } from "./storage";
import type { Event } from "@shared/schema";

export type PriorityTier =
  | "DOCTOR_AUTHORITY"
  | "GOVERNANCE_POLICY"
  | "CLINICAL_PATHWAYS"
  | "KNOWLEDGE_INTELLIGENCE";

export type NormalizedSuggestionLevel = "INFO" | "WARN" | "REQUIRE_APPROVAL" | "CRITICAL";

const PRIORITY_ORDER: Record<PriorityTier, number> = {
  DOCTOR_AUTHORITY: 1,
  GOVERNANCE_POLICY: 2,
  CLINICAL_PATHWAYS: 3,
  KNOWLEDGE_INTELLIGENCE: 4,
};

function normalizeSuggestionLevel(raw: string): NormalizedSuggestionLevel {
  const upper = raw.toUpperCase();
  if (upper === "CRITICAL" || upper === "BLOCK") return "CRITICAL";
  if (upper === "REQUIRE_APPROVAL") return "REQUIRE_APPROVAL";
  if (upper === "WARN" || upper === "WARNING") return "WARN";
  return "INFO";
}

function resolveSourceEngine(eventType: string): { engine: string; tier: PriorityTier } {
  if (eventType.includes("governance")) {
    return { engine: "GOVERNANCE", tier: "GOVERNANCE_POLICY" };
  }
  if (eventType.includes("pathway") || eventType.includes("clinical.pathway")) {
    return { engine: "PATHWAYS", tier: "CLINICAL_PATHWAYS" };
  }
  return { engine: "UNKNOWN", tier: "KNOWLEDGE_INTELLIGENCE" };
}

function buildDeduplicationKey(
  sourceEngine: string,
  testCode: string | null,
  patientId: number | null,
  specimenId: number | null,
  suggestionLevel: string,
): string {
  return `${sourceEngine}:${testCode || ""}:${patientId || ""}:${specimenId || ""}:${suggestionLevel}`;
}

export async function orchestrateSuggestion(event: Event): Promise<void> {
  const payload = event.payload as Record<string, any> | null;
  if (!payload) return;

  const isGovernance = event.eventType === "governance.evaluated";
  const isPathway = event.eventType === "clinical.pathway.evaluated";
  if (!isGovernance && !isPathway) return;

  try {
    const { engine, tier } = resolveSourceEngine(event.eventType);
    const rawLevel = isGovernance
      ? (payload.overallOutcome || "INFO")
      : (payload.highestLevel || "INFO");
    const normalizedLevel = normalizeSuggestionLevel(rawLevel);

    if (normalizedLevel === "INFO" && !isGovernance) return;

    const testCode = payload.testCode || payload.triggerTestCode || null;
    const patientId = payload.patientId || null;
    const specimenId = payload.specimenId || event.entityId || null;

    const deduplicationKey = buildDeduplicationKey(
      engine, testCode, patientId, specimenId, normalizedLevel,
    );

    const existing = await storage.findDuplicateSuggestion(deduplicationKey);
    if (existing) return;

    const summary = isGovernance
      ? `Governance ${payload.overallOutcome}: ${testCode || "unknown test"} — ${payload.policyCount || 0} policies evaluated`
      : `Pathway advisory: ${payload.suggestionCount || 0} suggestion(s) for ${testCode || "unknown test"}`;

    await storage.createUnifiedSuggestion({
      labId: event.labId,
      sourceEngine: engine,
      sourceEventId: event.id,
      priorityTier: tier,
      suggestionLevel: normalizedLevel,
      testCode,
      patientId,
      specimenId,
      summary,
      deduplicationKey,
      executionContext: event.executionContext || payload.executionContext,
      metadata: {
        eventType: event.eventType,
        rawLevel,
        advisoryOnly: payload.advisoryOnly,
        sector: payload.sector,
      },
    });
  } catch (_err) {
  }
}
