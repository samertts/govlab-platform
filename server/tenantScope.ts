import type { Request, Response, NextFunction } from "express";
import type { Staff } from "@shared/schema";

export interface TenantScope {
  labId: number | null;
  bypass: boolean;
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
    req.tenantScope = { labId: null, bypass: false };
    return next();
  }

  if (staffMember.role === "ministry_auditor") {
    req.tenantScope = { labId: null, bypass: true };
  } else {
    req.tenantScope = { labId: staffMember.labId ?? null, bypass: false };
  }
  next();
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
  if (!resourceLabId) return true;
  return scope.labId === resourceLabId;
}

export function stampTenantLabId<T extends Record<string, any>>(scope: TenantScope, input: T): T {
  if (scope.bypass) return input;
  if (scope.labId) {
    return { ...input, labId: scope.labId };
  }
  return input;
}
