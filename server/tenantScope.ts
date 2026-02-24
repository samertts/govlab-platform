import type { Request, Response, NextFunction } from "express";
import type { Staff, ApiToken } from "@shared/schema";

export type ExecutionContextSource = "user_session" | "analyzer_token" | "federation_source";

export interface TenantScope {
  labId: number | null;
  bypass: boolean;
  source: ExecutionContextSource;
  sourceId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      tenantScope?: TenantScope;
    }
  }
}

export function attachTenantScope(req: any, _res: Response, next: NextFunction): void {
  const staffMember: Staff | undefined = req.staffMember;
  if (!staffMember) {
    req.tenantScope = { labId: null, bypass: false, source: "user_session", sourceId: null };
    return next();
  }

  if (staffMember.role === "ministry_auditor" || staffMember.role === "national_clinical_supervisor") {
    req.tenantScope = { labId: null, bypass: true, source: "user_session", sourceId: staffMember.id };
  } else {
    req.tenantScope = { labId: staffMember.labId ?? null, bypass: false, source: "user_session", sourceId: staffMember.id };
  }
  next();
}

export function attachTokenTenantScope(req: any, _res: Response, next: NextFunction): void {
  const token: ApiToken | undefined = req.apiToken;
  if (!token) {
    req.tenantScope = { labId: null, bypass: false, source: "analyzer_token", sourceId: null };
    return next();
  }

  req.tenantScope = {
    labId: token.labId ?? null,
    bypass: false,
    source: "analyzer_token",
    sourceId: token.id,
  };
  next();
}

export function attachFederationTenantScope(labId: number | null, federationSourceId: number | null): TenantScope {
  return {
    labId,
    bypass: false,
    source: "federation_source",
    sourceId: federationSourceId,
  };
}

export function getTenantLabFilter(scope: TenantScope): number | undefined {
  if (scope.bypass) return undefined;
  if (scope.labId === null) return -1;
  return scope.labId;
}

export function enforceTenantOwnership(scope: TenantScope, resourceLabId: number | null): boolean {
  if (scope.bypass) return true;
  if (scope.labId === null) {
    return resourceLabId === null;
  }
  if (!resourceLabId) {
    if (scope.source === "analyzer_token" || scope.source === "federation_source") {
      return false;
    }
    return true;
  }
  return scope.labId === resourceLabId;
}

export function stampTenantLabId<T extends Record<string, any>>(scope: TenantScope, input: T): T {
  if (scope.bypass) return input;
  if (scope.labId) {
    return { ...input, labId: scope.labId };
  }
  return input;
}
