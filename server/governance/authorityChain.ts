  export type AuthorityChain = {
    sampleId: string;
    orderingUserId: string;
    clinicalApproverId?: string;
    policyId?: string;
    overrideReason?: string;
    approvalTimestamp?: Date;
  };

  export function canOverride(role: string) {
    return role === "PATHOLOGIST";
  }

  export function blockAdminResultEdit(role: string) {
    if (role === "LAB_ADMIN" || role === "MINISTRY_AUDITOR") {
      throw new Error("Administrative roles cannot modify clinical results");
    }
  }