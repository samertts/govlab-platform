import type { Response, NextFunction } from "express";

const READONLY_ROLES = ["national_clinical_supervisor"];

export function blockWriteForOversightRoles(req: any, res: Response, next: NextFunction): void {
  const staffMember = req.staffMember;
  if (!staffMember) return next();

  if (READONLY_ROLES.includes(staffMember.role)) {
    return res.status(403).json({
      message: "National oversight roles have read-only access. Modifications are not permitted.",
    }) as any;
  }
  next();
}
