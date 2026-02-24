import { storage } from "./storage";
import type { Request, Response, NextFunction } from "express";

interface SessionTracker {
  userId: number;
  requestCount: number;
  windowStart: number;
  lastRequestAt: number;
  distinctEndpoints: Set<string>;
}

const sessionTrackers = new Map<string, SessionTracker>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 200;
const ANOMALY_ENDPOINT_THRESHOLD = 30;

function getSessionKey(req: any): string {
  const staffId = req.staffMember?.id;
  if (staffId) return `staff:${staffId}`;
  const tokenId = req.apiToken?.id;
  if (tokenId) return `token:${tokenId}`;
  return `unknown:${req.ip}`;
}

export function sessionAnomalyDetector(req: any, _res: Response, next: NextFunction): void {
  try {
    const key = getSessionKey(req);
    const now = Date.now();
    let tracker = sessionTrackers.get(key);

    if (!tracker || (now - tracker.windowStart > WINDOW_MS)) {
      tracker = {
        userId: req.staffMember?.id || 0,
        requestCount: 0,
        windowStart: now,
        lastRequestAt: now,
        distinctEndpoints: new Set(),
      };
      sessionTrackers.set(key, tracker);
    }

    tracker.requestCount++;
    tracker.lastRequestAt = now;
    tracker.distinctEndpoints.add(req.path);

    if (tracker.requestCount > MAX_REQUESTS_PER_WINDOW) {
      logSecurityEvent(tracker.userId, "RATE_LIMIT_EXCEEDED", "MEDIUM", {
        requestCount: tracker.requestCount,
        window: WINDOW_MS,
        path: req.path,
      }, key);
    }

    if (tracker.distinctEndpoints.size > ANOMALY_ENDPOINT_THRESHOLD) {
      logSecurityEvent(tracker.userId, "ENDPOINT_SCAN_DETECTED", "HIGH", {
        distinctEndpoints: tracker.distinctEndpoints.size,
        window: WINDOW_MS,
      }, key);
    }
  } catch (_err) {
  }

  next();
}

export function validateEventOrigin(event: any): boolean {
  if (!event || !event.eventType) return false;
  if (!event.entityType) return false;
  if (event.executionContext && !["USER_SESSION", "ANALYZER_SOURCE", "FEDERATION_GATEWAY", "OFFLINE_SYNC", "WORKER"].includes(event.executionContext)) {
    return false;
  }
  return true;
}

export function excludeEncryptedIdentity(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  const sanitized: Record<string, any> = {};
  const sensitiveKeys = [
    "nationalIdEncrypted", "national_id_encrypted",
    "nationalIdHash", "national_id_hash",
    "encryptedData", "encrypted_data",
  ];
  for (const [key, value] of Object.entries(payload)) {
    if (sensitiveKeys.includes(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function logSecurityEvent(
  userId: number,
  eventType: string,
  severity: string,
  details: any,
  sessionId: string,
): void {
  setImmediate(async () => {
    try {
      await storage.createSecurityEvent({
        userId: userId || null,
        eventType,
        severity,
        details,
        actionTaken: severity === "HIGH" ? "PRIVILEGE_DOWNGRADE_FLAGGED" : "LOGGED",
        sessionId,
      });
    } catch (_err) {
    }
  });
}

export function cleanupStaleSessions(): void {
  const now = Date.now();
  const entries = Array.from(sessionTrackers.entries());
  for (const [key, tracker] of entries) {
    if (now - tracker.lastRequestAt > WINDOW_MS * 5) {
      sessionTrackers.delete(key);
    }
  }
}
