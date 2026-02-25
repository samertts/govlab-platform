import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import { TestPolicy } from "@shared/schema";
import { ExecutionContext } from "./tenantScope";
import { canOverride, blockAdminResultEdit } from "./governance/authorityChain";
export type GovernanceOutcome =
  "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK";

export interface GovernanceEvaluation {
  policyId: number;
  ruleType: string;
  riskClass: string;
  outcome: GovernanceOutcome;
  reason: string;
  advisory: boolean;
}

export interface GovernanceResult {
  testCode: string;
  sector: string;
  evaluatedAt: string;
  executionContext: ExecutionContext;
  overallOutcome: GovernanceOutcome;
  evaluations: GovernanceEvaluation[];
  advisoryOnly: boolean;
  pendingAdvisoryCount: number;
}

function resolveOutcome(policy: TestPolicy, hasDuplicate: boolean): GovernanceOutcome {
  switch (policy.ruleType) {
    case "DUPLICATE_TEST_INTERVAL":
      if (hasDuplicate) {
        return policy.riskClass === "HIGH_RISK_BLOCK" ? "BLOCK" : "WARN";
      }
      return "ALLOW";

    case "APPROVAL_REQUIRED":
      if (policy.requiresApproval) {
        return policy.riskClass === "HIGH_RISK_BLOCK" ? "REQUIRE_APPROVAL" : "WARN";
      }
      return "ALLOW";

    case "VISIBILITY_CONTROL":
      return policy.riskClass === "HIGH_RISK_BLOCK" ? "BLOCK" : "WARN";

    default:
      return policy.riskClass === "HIGH_RISK_BLOCK" ? "WARN" : "ALLOW";
  }
}

function computeOverallOutcome(evaluations: GovernanceEvaluation[]): GovernanceOutcome {
  if (evaluations.some(e => e.outcome === "BLOCK")) return "BLOCK";
  if (evaluations.some(e => e.outcome === "REQUIRE_APPROVAL")) return "REQUIRE_APPROVAL";
  if (evaluations.some(e => e.outcome === "WARN")) return "WARN";
  return "ALLOW";
}

async function evaluateSinglePolicy(
  policy: TestPolicy,
  testCode: string,
  sector: string,
  patientId: number,
): Promise<GovernanceEvaluation> {
  let hasDuplicate = false;

  if (policy.ruleType === "DUPLICATE_TEST_INTERVAL" && policy.minIntervalDays) {
    const recentResults = await storage.getRecentTestResultsByCode(
      testCode,
      patientId,
      policy.minIntervalDays,
    );
    hasDuplicate = recentResults.length > 0;
  }

  const outcome = resolveOutcome(policy, hasDuplicate);

  const isAdvisory =
    policy.riskClass === "ADVISORY" ||
    sector === "PRIVATE";

  return {
    policyId: policy.id,
    ruleType: policy.ruleType,
    riskClass: policy.riskClass,
    outcome,
    reason: buildReason(policy, outcome, hasDuplicate),
    advisory: isAdvisory,
  };
}

async function persistGovernanceEventsPostCommit(
  evaluations: GovernanceEvaluation[],
  specimenId: number | null,
  testCode: string,
  sector: string,
  executionContext: ExecutionContext,
  emittedBy: number | null,
  overallOutcome: GovernanceOutcome,
  advisoryOnly: boolean,
  totalPolicyCount: number,
): Promise<void> {
  for (const evaluation of evaluations) {
    if (evaluation.outcome !== "ALLOW") {
      try {
        await storage.createGovernanceEvent({
          specimenId,
          testCode,
          policyId: evaluation.policyId,
          evaluationResult: evaluation.outcome,
          executionContext,
          metadata: {
            ruleType: evaluation.ruleType,
            riskClass: evaluation.riskClass,
            reason: evaluation.reason,
            advisory: evaluation.advisory,
          },
        });
        if (
  overallOutcome === "REQUIRE_APPROVAL" &&
  executionContext?.actorRole === "PATHOLOGIST"
) {
  try {
    await storage.createAuthorityChain({
      sampleId: specimenId,
      orderingUserId: emittedBy,
      clinicalApproverId: emittedBy,
      policyId: evaluation.policyId,
      overrideReason: "PATHOLOGIST_OVERRIDE",
      approvalTimestamp: new Date(),
    });
  } catch (_err) {}
        }
      } catch (_err) {
      }
    }
  }

  try {
    await eventBus.emitAndPersist({
      eventType: EventTypes.GOVERNANCE_EVALUATED,
      entityType: "specimen",
      entityId: specimenId,
      payload: {
        testCode,
        sector,
        overallOutcome,
        advisoryOnly,
        policyCount: totalPolicyCount,
        executionContext,
      },
      emittedBy,
    });
  } catch (_err) {
  }
}

  export async function evaluateGovernance(
    testCode: string,
    sector: string,
    patientId: number,
    specimenId: number | null,
    executionContext: ExecutionContext,
    emittedBy: number | null,
  ): Promise<GovernanceResult> {
// === Administrative Authority Gate ===
if ((executionContext as any)?.actorRole) {
  blockAdminResultEdit((executionContext as any).actorRole);
}
    const matchingPolicies = await storage.evaluateTestPolicies(testCode, sector);

  const highRiskPolicies = matchingPolicies.filter(p => p.riskClass === "HIGH_RISK_BLOCK");
  const advisoryPolicies = matchingPolicies.filter(p => p.riskClass !== "HIGH_RISK_BLOCK");

  const syncEvaluations: GovernanceEvaluation[] = [];
  for (const policy of highRiskPolicies) {
    syncEvaluations.push(await evaluateSinglePolicy(policy, testCode, sector, patientId));
  }

  const overallOutcome = computeOverallOutcome(syncEvaluations);
    // === Pathologist Override Gate ===
if (overallOutcome === "REQUIRE_APPROVAL") {
  if (executionContext?.actorRole && !canOverride(executionContext.actorRole)) {
    throw new Error("Only PATHOLOGIST role can override clinical governance");
  }
}
    // === Clinical Sovereign Lock ===
if (overallOutcome === "REQUIRE_APPROVAL") {
  const role = (executionContext as any)?.actorRole;

  if (role && !canOverride(role)) {
    throw new Error(
      "Clinical approval required — only PATHOLOGIST can override"
    );
  }
}
  const hasBlockingResults = syncEvaluations.some(
    e => e.outcome === "BLOCK" || e.outcome === "REQUIRE_APPROVAL" || e.outcome === "WARN"
  );
  const advisoryOnly = syncEvaluations.length === 0 || !hasBlockingResults;

  const result: GovernanceResult = {
    testCode,
    sector,
    evaluatedAt: new Date().toISOString(),
    executionContext,
    overallOutcome,
    evaluations: syncEvaluations,
    advisoryOnly,
    pendingAdvisoryCount: advisoryPolicies.length,
  };

  setImmediate(async () => {
    try {
      const asyncEvaluations: GovernanceEvaluation[] = [];
      for (const policy of advisoryPolicies) {
        asyncEvaluations.push(await evaluateSinglePolicy(policy, testCode, sector, patientId));
      }

      const allEvaluations = [...syncEvaluations, ...asyncEvaluations];
      const finalOutcome = computeOverallOutcome(allEvaluations);
      const finalAdvisoryOnly = allEvaluations.every(e => e.advisory);
// === Pathologist Override Gate ===
// === Pathologist Override Gate ===
if (finalOutcome === "REQUIRE_APPROVAL") {
  if (executionContext?.actorRole &&
      !canOverride(executionContext.actorRole)) {
    throw new Error(
      "Only PATHOLOGIST role can override clinical governance"
    );
  }
}
      await persistGovernanceEventsPostCommit(
        allEvaluations, specimenId, testCode, sector,
        executionContext, emittedBy,
        finalOutcome, finalAdvisoryOnly,
        matchingPolicies.length,
      );
    } catch (_err) {
    }
  });

  return result;
}

function buildReason(policy: TestPolicy, outcome: GovernanceOutcome, hasDuplicate: boolean): string {
  if (outcome === "ALLOW") return "Policy conditions not triggered";

  switch (policy.ruleType) {
    case "DUPLICATE_TEST_INTERVAL":
      return hasDuplicate
        ? `Duplicate test detected within ${policy.minIntervalDays}-day interval`
        : "No duplicate found";
    case "APPROVAL_REQUIRED":
      return "This test requires supervisory approval before processing";
    case "VISIBILITY_CONTROL":
      return "Visibility restriction applies to this test in the current sector";
    default:
      return policy.description || "Policy rule triggered";
  }
}

export async function evaluateGovernanceAsync(
  testCode: string,
  sector: string,
  patientId: number,
  specimenId: number | null,
  executionContext: ExecutionContext,
  emittedBy: number | null,
): Promise<void> {
  setImmediate(async () => {
    try {
      await evaluateGovernance(testCode, sector, patientId, specimenId, executionContext, emittedBy);
    } catch (_err) {
    }
  });
}
