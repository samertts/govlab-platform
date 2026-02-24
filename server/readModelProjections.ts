import { storage } from "./storage";
import type { Event } from "@shared/schema";

export async function projectWorklistView(event: Event): Promise<void> {
  const payload = event.payload as Record<string, any> | null;
  if (!payload) return;

  const sampleId = payload.sampleId || event.entityId;
  if (!sampleId) return;

  try {
    const sample = await storage.getSample(sampleId);
    if (!sample) return;

    const pendingTestCount = sample.results.filter(r => r.status === "pending").length;
    const enteredTestCount = sample.results.filter(r => r.status === "entered").length;
    const verifiedTestCount = sample.results.filter(r => r.status === "verified").length;

    await storage.upsertWorklistView({
      labId: sample.labId,
      sampleId: sample.id,
      patientId: sample.patientId,
      sampleStatus: sample.status,
      pendingTestCount,
      enteredTestCount,
      verifiedTestCount,
      priority: sample.priority,
      lastEventType: event.eventType,
      lastEventAt: event.createdAt,
    });
  } catch (_err) {
  }
}

export async function projectNationalMetrics(event: Event): Promise<void> {
  const labId = event.labId;

  try {
    switch (event.eventType) {
      case "sample.created": {
        await storage.upsertNationalMetrics({
          labId,
          metricType: "total_samples",
          metricValue: 1,
          periodStart: startOfDay(),
          periodEnd: endOfDay(),
        });
        break;
      }
      case "result.verified": {
        await storage.upsertNationalMetrics({
          labId,
          metricType: "total_verified",
          metricValue: 1,
          periodStart: startOfDay(),
          periodEnd: endOfDay(),
        });
        break;
      }
      case "qc.flagged": {
        await storage.upsertNationalMetrics({
          labId,
          metricType: "qc_flags",
          metricValue: 1,
          periodStart: startOfDay(),
          periodEnd: endOfDay(),
        });
        break;
      }
    }
  } catch (_err) {
  }
}

export async function projectSuggestionStream(event: Event): Promise<void> {
  const payload = event.payload as Record<string, any> | null;
  if (!payload) return;

  const isGovernance = event.eventType === "governance.evaluated";
  const isPathway = event.eventType === "clinical.pathway.evaluated";

  if (!isGovernance && !isPathway) return;

  try {
    await storage.createSuggestionStreamEntry({
      labId: event.labId,
      sourceEngine: isGovernance ? "GOVERNANCE" : "PATHWAYS",
      sourceEventId: event.id,
      suggestionLevel: payload.highestLevel || payload.overallOutcome || "INFO",
      testCode: payload.testCode,
      patientId: payload.patientId,
      specimenId: payload.specimenId || event.entityId,
      summary: isGovernance
        ? `Governance: ${payload.overallOutcome} for ${payload.testCode}`
        : `Pathway: ${payload.suggestionCount || 0} suggestion(s) for ${payload.triggerTestCode}`,
      metadata: payload,
    });
  } catch (_err) {
  }
}

export async function processEventProjections(event: Event): Promise<void> {
  const sampleEvents = ["sample.created", "result.entered", "result.verified", "qc.flagged"];
  const metricsEvents = ["sample.created", "result.verified", "qc.flagged"];
  const suggestionEvents = ["governance.evaluated", "clinical.pathway.evaluated"];

  if (sampleEvents.includes(event.eventType)) {
    await projectWorklistView(event);
  }
  if (metricsEvents.includes(event.eventType)) {
    await projectNationalMetrics(event);
  }
  if (suggestionEvents.includes(event.eventType)) {
    await projectSuggestionStream(event);
  }
}

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
