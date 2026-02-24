import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import { decryptNationalId } from "./nationalIdEncryption";

const ROLE_PERMISSIONS: Record<string, {
  labScoped: boolean;
  canVerify: boolean;
  facilityConfig: boolean;
  nationalVisibility: boolean;
  auditScope: boolean;
  writeAccess: boolean;
}> = {
  TECHNICIAN: {
    labScoped: true,
    canVerify: false,
    facilityConfig: false,
    nationalVisibility: false,
    auditScope: false,
    writeAccess: true,
  },
  PATHOLOGIST: {
    labScoped: true,
    canVerify: true,
    facilityConfig: false,
    nationalVisibility: false,
    auditScope: false,
    writeAccess: true,
  },
  LAB_ADMIN: {
    labScoped: true,
    canVerify: false,
    facilityConfig: true,
    nationalVisibility: false,
    auditScope: false,
    writeAccess: true,
  },
  NATIONAL_CLINICAL_SUPERVISOR: {
    labScoped: false,
    canVerify: false,
    facilityConfig: false,
    nationalVisibility: true,
    auditScope: false,
    writeAccess: false,
  },
  MINISTRY_AUDITOR: {
    labScoped: false,
    canVerify: false,
    facilityConfig: false,
    nationalVisibility: true,
    auditScope: true,
    writeAccess: false,
  },
};

function normalizeRole(role: string): string {
  const mapped: Record<string, string> = {
    technician: "TECHNICIAN",
    pathologist: "PATHOLOGIST",
    admin: "LAB_ADMIN",
    lab_admin: "LAB_ADMIN",
    national_clinical_supervisor: "NATIONAL_CLINICAL_SUPERVISOR",
    ministry_auditor: "MINISTRY_AUDITOR",
    receptionist: "TECHNICIAN",
  };
  return mapped[role?.toLowerCase()] || "TECHNICIAN";
}

export function getRolePermissions(role: string) {
  const normalized = normalizeRole(role);
  return ROLE_PERMISSIONS[normalized] || ROLE_PERMISSIONS.TECHNICIAN;
}

export function requireRoleScope(...allowedRoles: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    const staffMember = req.staffMember || req.user;
    if (!staffMember) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const normalized = normalizeRole(staffMember.role);
    if (!allowedRoles.includes(normalized)) {
      logAccessDenied(staffMember, req.path, "INSUFFICIENT_ROLE_SCOPE");
      return res.status(403).json({ message: "Insufficient role scope" });
    }

    next();
  };
}

export function enforceFacilityIsolation(req: any, res: Response, next: NextFunction): void {
  const staffMember = req.staffMember || req.user;
  if (!staffMember) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const normalized = normalizeRole(staffMember.role);
  const permissions = ROLE_PERMISSIONS[normalized];

  if (permissions?.nationalVisibility) {
    const reasonCode = req.headers["x-access-reason-code"] || req.query.reasonCode;
    const accessOrigin = req.headers["x-access-origin"] || req.query.accessOrigin;

    if (!reasonCode) {
      logAccessDenied(staffMember, req.path, "MISSING_REASON_CODE_FOR_NATIONAL_ACCESS");
      res.status(403).json({ message: "access_reason_code required for cross-facility access" });
      return;
    }

    setImmediate(async () => {
      try {
        await storage.createNationalAuditEntry({
          identityUuid: staffMember.identityUuid || `staff:${staffMember.id}`,
          actionType: "CROSS_FACILITY_READ",
          entityRef: req.path,
          facilityScope: staffMember.facilityCode || "NATIONAL",
          reasonCode: reasonCode as string,
          accessOrigin: (accessOrigin as string) || req.ip,
          reviewFlag: true,
          metadata: {
            method: req.method,
            query: req.query,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (_err) {}
    });

    next();
    return;
  }

  if (permissions?.labScoped) {
    const requestedFacility = req.params.facilityCode || req.query.facilityCode;
    const staffFacility = staffMember.facilityCode || staffMember.facilityId;

    if (requestedFacility && requestedFacility !== String(staffFacility)) {
      logAccessDenied(staffMember, req.path, "CROSS_FACILITY_ACCESS_BLOCKED");
      res.status(403).json({ message: "Cross-facility access blocked. Your role is limited to your assigned facility." });
      return;
    }
  }

  next();
}

export function fieldLevelEncryptionGuard(role: string): boolean {
  const normalized = normalizeRole(role);
  const decryptAllowed = ["PATHOLOGIST", "LAB_ADMIN", "NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"];
  return decryptAllowed.includes(normalized);
}

export function decryptPatientIdentifier(encryptedValue: string, staffRole: string): string {
  if (!fieldLevelEncryptionGuard(staffRole)) {
    return "[REDACTED]";
  }

  try {
    return decryptNationalId(encryptedValue);
  } catch (_err) {
    return "[DECRYPTION_ERROR]";
  }
}

export function sanitizePatientForRole(patient: any, staffRole: string): any {
  if (!patient) return patient;

  const sanitized = { ...patient };

  if (!fieldLevelEncryptionGuard(staffRole)) {
    if (sanitized.nationalIdEncrypted) sanitized.nationalIdEncrypted = "[REDACTED]";
    if (sanitized.nationalIdHash) sanitized.nationalIdHash = "[REDACTED]";
    if (sanitized.identityToken) sanitized.identityToken = "[REDACTED]";
  }

  return sanitized;
}

export function deriveServerExecutionContext(req: any): string {
  if (!req) return "SYSTEM_INTERNAL";

  const staffMember = req.staffMember || req.user;
  if (!staffMember) {
    if (req.apiToken) return "API_TOKEN_SESSION";
    if (req.analyzerIdentity) return "ANALYZER_SOURCE";
    return "ANONYMOUS_REQUEST";
  }

  const normalized = normalizeRole(staffMember.role);
  switch (normalized) {
    case "TECHNICIAN": return "TECHNICIAN_SESSION";
    case "PATHOLOGIST": return "PATHOLOGIST_SESSION";
    case "LAB_ADMIN": return "LAB_ADMIN_SESSION";
    case "NATIONAL_CLINICAL_SUPERVISOR": return "NATIONAL_SUPERVISOR_SESSION";
    case "MINISTRY_AUDITOR": return "MINISTRY_AUDITOR_SESSION";
    default: return "USER_SESSION";
  }
}

export function blockClientProvidedContext(req: any, _res: Response, next: NextFunction): void {
  if (req.body) {
    delete req.body.executionContext;
    delete req.body.roleScope;
    delete req.body.facilityScope;
  }

  if (req.headers["x-execution-context"]) {
    delete req.headers["x-execution-context"];
  }
  if (req.headers["x-role-scope"]) {
    delete req.headers["x-role-scope"];
  }
  if (req.headers["x-facility-scope"]) {
    delete req.headers["x-facility-scope"];
  }

  next();
}

function logAccessDenied(staffMember: any, path: string, reason: string): void {
  setImmediate(async () => {
    try {
      await storage.createSecurityEvent({
        userId: staffMember?.id || null,
        eventType: "ACCESS_DENIED",
        severity: "MEDIUM",
        details: {
          reason,
          path,
          role: staffMember?.role,
          facilityId: staffMember?.facilityId,
        },
        actionTaken: "BLOCKED",
        sessionId: null,
      });
    } catch (_err) {}
  });
}
