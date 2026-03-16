import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import type { ClinicalPathway, PathwayRule } from "@shared/schema";
import type { ExecutionContext } from "./tenantScope";

export type SuggestionLevel = "INFO" | "WARN" | "REQUIRE_APPROVAL";

export interface PathwaySuggestion {
  pathwayId: number;
  pathwayName: string;
  triggerTest: string;
  nextRecommendedTest: string;
  conditionType: string;
  suggestionLevel: SuggestionLevel;
  reason: string;
  advisory: true;
}

export interface PathwayEvaluationResult {
  specimenId: number | null;
  triggerTestCode: string;
  sector: string;
  evaluatedAt: string;
  executionContext: ExecutionContext;
  suggestions: PathwaySuggestion[];
  totalPathwaysEvaluated: number;
  totalRulesEvaluated: number;
}

function resolveHighestSuggestionLevel(suggestions: PathwaySuggestion[]): SuggestionLevel {
  if (suggestions.some(s => s.suggestionLevel === "REQUIRE_APPROVAL")) return "REQUIRE_APPROVAL";
  if (suggestions.some(s => s.suggestionLevel === "WARN")) return "WARN";
  return "INFO";
}

async function evaluateRulesForTest(
  testCode: string,
  patientId: number,
): Promise<{ ruleMatched: boolean; highestLevel: SuggestionLevel; matchedRules: PathwayRule[] }> {
  const rules = await storage.getPathwayRulesByTestCode(testCode);
  const matchedRules: PathwayRule[] = [];

  for (const rule of rules) {
    if (rule.requiresPreviousTest) {
      const hasPrevious = await storage.hasPatientCompletedTest(
        patientId,
        rule.requiresPreviousTest,
        rule.timeWindowDays ?? undefined,
      );
      if (!hasPrevious) {
        matchedRules.push(rule);
      }
    } else {
      matchedRules.push(rule);
    }
  }

  const highestLevel = matchedRules.length > 0
    ? resolveHighestSuggestionLevel(matchedRules.map(r => ({
        suggestionLevel: r.suggestionLevel as SuggestionLevel,
        pathwayId: 0, pathwayName: "", triggerTest: "", nextRecommendedTest: "",
        conditionType: "", reason: "", advisory: true as const,
      })))
    : "INFO";

  return { ruleMatched: matchedRules.length > 0, highestLevel, matchedRules };
}

export async function evaluatePathways(
  triggerTestCode: string,
  sector: string,
  patientId: number,
  specimenId: number | null,
  executionContext: ExecutionContext,
  emittedBy: number | null,
): Promise<PathwayEvaluationResult> {
  const pathways = await storage.getPathwaysByTriggerTest(triggerTestCode, sector);

  const suggestions: PathwaySuggestion[] = [];
  let totalRulesEvaluated = 0;

  for (const pathway of pathways) {
    const { ruleMatched, highestLevel, matchedRules } = await evaluateRulesForTest(
      pathway.nextRecommendedTest,
      patientId,
    );
    totalRulesEvaluated += matchedRules.length;

    const hasCompletedNext = await storage.hasPatientCompletedTest(
      patientId,
      pathway.nextRecommendedTest,
    );

    if (!hasCompletedNext) {
      const level: SuggestionLevel = sector === "PRIVATE"
        ? "INFO"
        : ruleMatched ? highestLevel : determineSuggestionLevel(pathway, sector);

      suggestions.push({
        pathwayId: pathway.id,
        pathwayName: pathway.pathwayName,
        triggerTest: pathway.triggerTest,
        nextRecommendedTest: pathway.nextRecommendedTest,
        conditionType: pathway.conditionType,
        suggestionLevel: level,
        reason: buildPathwayReason(pathway, level),
        advisory: true,
      });
    }
  }

  const result: PathwayEvaluationResult = {
    specimenId,
    triggerTestCode,
    sector,
    evaluatedAt: new Date().toISOString(),
    executionContext,
    suggestions,
    totalPathwaysEvaluated: pathways.length,
    totalRulesEvaluated,
  };

  setImmediate(async () => {
    try {
      await persistPathwayEventsPostCommit(
        suggestions, specimenId, executionContext, emittedBy,
        triggerTestCode, sector, pathways.length,
      );
    } catch (_err) {
    }
  });

  return result;
}

async function persistPathwayEventsPostCommit(
  suggestions: PathwaySuggestion[],
  specimenId: number | null,
  executionContext: ExecutionContext,
  emittedBy: number | null,
  triggerTestCode: string,
  sector: string,
  totalPathways: number,
): Promise<void> {
  for (const suggestion of suggestions) {
    try {
      await storage.createClinicalPathwayEvent({
        specimenId,
        pathwayId: suggestion.pathwayId,
        suggestionLevel: suggestion.suggestionLevel,
        executionContext: executionContext.source,
        metadata: {
          pathwayName: suggestion.pathwayName,
          triggerTest: suggestion.triggerTest,
          nextRecommendedTest: suggestion.nextRecommendedTest,
          conditionType: suggestion.conditionType,
          reason: suggestion.reason,
        },
      });
    } catch (_err) {
    }
  }

  try {
    await eventBus.emitAndPersist({
      eventType: EventTypes.CLINICAL_PATHWAY_EVALUATED,
      entityType: "specimen",
      entityId: specimenId,
      payload: {
        triggerTestCode,
        sector,
        suggestionCount: suggestions.length,
        highestLevel: suggestions.length > 0
          ? resolveHighestSuggestionLevel(suggestions)
          : "INFO",
        totalPathways,
        executionContext,
      },
      emittedBy,
    });
  } catch (_err) {
  }
}

export function evaluatePathwaysPostCommit(
  triggerTestCode: string,
  sector: string,
  patientId: number,
  specimenId: number | null,
  executionContext: ExecutionContext,
  emittedBy: number | null,
): void {
  setImmediate(async () => {
    try {
      await evaluatePathways(
        triggerTestCode, sector, patientId, specimenId,
        executionContext, emittedBy,
      );
    } catch (_err) {
    }
  });
}

function determineSuggestionLevel(pathway: ClinicalPathway, sector: string): SuggestionLevel {
  if (sector === "PRIVATE") return "INFO";

  switch (pathway.conditionType) {
    case "DIAGNOSTIC_SEQUENCE":
      return "WARN";
    case "FOLLOW_UP":
      return "WARN";
    case "MONITORING":
      return "INFO";
    case "SCREENING":
      return "INFO";
    default:
      return "INFO";
  }
}

function buildPathwayReason(pathway: ClinicalPathway, level: SuggestionLevel): string {
  const prefix = level === "REQUIRE_APPROVAL"
    ? "Approval recommended"
    : level === "WARN"
      ? "Clinical pathway suggests"
      : "For information";

  return `${prefix}: ${pathway.pathwayName} — consider ${pathway.nextRecommendedTest} as follow-up to ${pathway.triggerTest} (${pathway.conditionType.toLowerCase().replace(/_/g, " ")})`;
}
