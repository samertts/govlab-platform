import { storage } from "./storage";
import type { Event } from "@shared/schema";

const DEFAULT_NOTIFICATION_MAP: Record<string, {
  type: string;
  buildMessage: (payload: any, eventType: string) => string;
  targetResolver: (event: Event) => Promise<number[]>;
}> = {
  "result.verified": {
    type: "INFO",
    buildMessage: (payload) =>
      `Test result verified for sample ${payload?.sampleId || "unknown"}`,
    targetResolver: async (event) => {
      const payload = event.payload as Record<string, any> | null;
      const targets: number[] = [];
      if (payload?.enteredBy) targets.push(payload.enteredBy);
      if (event.emittedBy) targets.push(event.emittedBy);
      return Array.from(new Set(targets));
    },
  },
  "qc.flagged": {
    type: "WARN",
    buildMessage: (payload) =>
      `QC flag raised: ${payload?.qcFlag || "unknown"} for test ${payload?.testCode || "unknown"}`,
    targetResolver: async (event) => {
      const targets: number[] = [];
      if (event.emittedBy) targets.push(event.emittedBy);
      return targets;
    },
  },
  "governance.evaluated": {
    type: "WARN",
    buildMessage: (payload) => {
      if (!payload) return "Governance evaluation completed";
      const outcome = payload.overallOutcome || "ALLOW";
      if (outcome === "ALLOW") return "";
      return `Governance ${outcome}: ${payload.testCode || "test"} — ${payload.reason || "policy triggered"}`;
    },
    targetResolver: async (event) => {
      const targets: number[] = [];
      if (event.emittedBy) targets.push(event.emittedBy);
      return targets;
    },
  },
  "clinical.pathway.evaluated": {
    type: "INFO",
    buildMessage: (payload) => {
      if (!payload || (payload.suggestionCount || 0) === 0) return "";
      return `Pathway advisory: ${payload.suggestionCount} suggestion(s) for ${payload.triggerTestCode || "test"}`;
    },
    targetResolver: async (event) => {
      const targets: number[] = [];
      if (event.emittedBy) targets.push(event.emittedBy);
      return targets;
    },
  },
  "identity.verified": {
    type: "INFO",
    buildMessage: (payload) =>
      `Identity verification completed for patient ${payload?.patientId || "unknown"}`,
    targetResolver: async (event) => {
      const targets: number[] = [];
      if (event.emittedBy) targets.push(event.emittedBy);
      return targets;
    },
  },
  "security.anomaly": {
    type: "CRITICAL",
    buildMessage: (payload) =>
      `Security alert: ${payload?.eventType || "anomaly detected"} — ${payload?.details || ""}`,
    targetResolver: async (event) => {
      const targets: number[] = [];
      if (event.emittedBy) targets.push(event.emittedBy);
      return targets;
    },
  },
  "intelligence.alert.generated": {
    type: "INFO",
    buildMessage: (payload) => {
      if (!payload) return "";
      return `[Intelligence Advisory] ${payload.alertType || "ALERT"}: ${payload.title || "New insight available"}`;
    },
    targetResolver: async (_event) => {
      return [];
    },
  },
};

export async function processNotification(event: Event): Promise<void> {
  const handler = DEFAULT_NOTIFICATION_MAP[event.eventType];
  if (!handler) return;

  try {
    const templates = await storage.getNotificationTemplates(event.eventType);

    const payload = event.payload as Record<string, any> | null;
    const message = handler.buildMessage(payload, event.eventType);
    if (!message) return;

    const targetUserIds = await handler.targetResolver(event);
    if (targetUserIds.length === 0) return;

    const notificationType = resolveNotificationType(handler.type, payload);

    if (templates.length > 0) {
      const template = templates[0];
      const resolvedTitle = interpolateTemplate(template.titleTemplate, payload);
      const resolvedBody = interpolateTemplate(template.bodyTemplate, payload);

      const notificationEvent = await storage.createNotificationEvent({
        eventId: event.id,
        templateId: template.id,
        resolvedTitle,
        resolvedBody,
        targetUserId: targetUserIds[0],
        notificationType: template.notificationType,
        deliveryStatus: "pending",
      });

      await storage.createDeliveryLog({
        notificationEventId: notificationEvent.id,
        channel: "in_app",
        status: "delivered",
        attemptCount: 1,
      });
    }

    for (const userId of targetUserIds) {
      await storage.createNotification({
        userId,
        message,
        notificationType,
        entityRef: event.entityId ? `${event.entityType}:${event.entityId}` : null,
      });
    }
  } catch (_err) {
  }
}

function resolveNotificationType(defaultType: string, payload: any): string {
  if (payload?.overallOutcome === "BLOCK" || payload?.overallOutcome === "CRITICAL") return "CRITICAL";
  if (payload?.overallOutcome === "REQUIRE_APPROVAL") return "WARN";
  return defaultType;
}

function interpolateTemplate(template: string, payload: any): string {
  if (!payload) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return payload[key] !== undefined ? String(payload[key]) : `{{${key}}}`;
  });
}
