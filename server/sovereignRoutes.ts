import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { isAuthenticated } from "./replit_integrations/auth";
import type { Staff } from "@shared/schema";
import { attachTenantScope, attachTokenTenantScope, getTenantLabFilter, enforceTenantOwnership, resolveExecutionContext } from "./tenantScope";
import { encryptNationalId, decryptNationalId, hashNationalId } from "./nationalIdEncryption";
import { processIdentityVerification, setupIdentityVerificationListener } from "./identityVerificationGateway";
import { evaluateGovernance, evaluateGovernanceAsync } from "./governanceEngine";
import { evaluatePathways, evaluatePathwaysPostCommit } from "./clinicalPathwaysEngine";
import { startEventWorker, getWorkerStatus } from "./eventWorkerService";
import { startGovernanceWorker, getGovernanceWorkerStatus, setupGovernanceEventSubscriptions } from "./governanceWorkerService";
import { startArchiveWorker, getArchiveWorkerStatus, setupArchiveEventSubscription } from "./archiveWorkerService";
import { authenticateAnalyzer, validateFacilityCode, ingestMessage, getGatewayStatus } from "./instrumentGateway";
import { startAnalyzerWorker, getAnalyzerWorkerStatus } from "./analyzerWorkerService";
import { sessionAnomalyDetector } from "./securityGuardrails";
import { startOfflineSyncWorker, getOfflineSyncWorkerStatus, createOfflineSyncEvent } from "./offlineSyncWorker";
import { globalEventBudget } from "./globalEventBudget";
import { issueIdentityToken, rotateIdentityToken, revokeIdentity, validateIdentityToken, startTokenCleanup } from "./zeroTrustTokenService";
import { blockClientProvidedContext, enforceFacilityIsolation, requireRoleScope, deriveServerExecutionContext, sanitizePatientForRole } from "./zeroTrustAccessControl";
import { startIntelligenceWorker, getIntelligenceWorkerStatus } from "./intelligenceWorker";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const requireAuth = (req: any, res: any, next: any) => {
  isAuthenticated(req, res, async (err?: any) => {
    if (err) return next(err);
    const claims = req.user?.claims;
    if (!claims?.sub) return res.status(401).json({ message: "Unauthorized" });
    const name = [claims.first_name, claims.last_name].filter(Boolean).join(" ") || claims.email || "User";
    req.staffMember = await storage.findOrCreateStaffByReplitUser(claims.sub, name);
    attachTenantScope(req, res, next);
  });
};

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.staffMember?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};

const requireTokenAuth = async (req: any, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Bearer token required" });
  }
  const raw = authHeader.slice(7);
  const tokenHash = hashToken(raw);
  const token = await storage.getApiTokenByHash(tokenHash);
  if (!token) return res.status(401).json({ message: "Invalid or expired token" });
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    return res.status(401).json({ message: "Token expired" });
  }
  await storage.updateTokenLastUsed(token.id);
  req.apiToken = token;
  attachTokenTenantScope(req, res, next);
};

export function registerSovereignRoutes(app: Express): void {

  app.use("/api/sovereign", blockClientProvidedContext);

  // === ORGANIZATION HIERARCHY ===

  app.get("/api/sovereign/organizations", requireAuth, async (req, res) => {
    const orgs = await storage.getOrganizations();
    res.json(orgs);
  });

  app.get("/api/sovereign/organizations/:id", requireAuth, async (req, res) => {
    const org = await storage.getOrganization(Number(req.params.id));
    if (!org) return res.status(404).json({ message: "Organization not found" });
    res.json(org);
  });

  app.post("/api/sovereign/organizations", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        name: z.string().min(1),
        code: z.string().min(1),
        type: z.string().optional(),
        contactEmail: z.string().email().optional().nullable(),
        contactPhone: z.string().optional().nullable(),
        address: z.string().optional().nullable(),
      }).parse(req.body);
      const org = await storage.createOrganization(input);
      await eventBus.emitAndPersist({
        eventType: EventTypes.ORG_CREATED,
        entityType: "organization",
        entityId: org.id,
        payload: { name: org.name, code: org.code },
        emittedBy: req.staffMember.id,
      });
      res.status(201).json(org);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/sovereign/directorates", requireAuth, async (req, res) => {
    const orgId = req.query.organizationId ? Number(req.query.organizationId) : undefined;
    const dirs = await storage.getDirectorates(orgId);
    res.json(dirs);
  });

  app.post("/api/sovereign/directorates", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        organizationId: z.number(),
        name: z.string().min(1),
        code: z.string().min(1),
        headName: z.string().optional().nullable(),
      }).parse(req.body);
      const dir = await storage.createDirectorate(input);
      res.status(201).json(dir);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/sovereign/facilities", requireAuth, async (req, res) => {
    const directorateId = req.query.directorateId ? Number(req.query.directorateId) : undefined;
    const facs = await storage.getFacilities(directorateId);
    res.json(facs);
  });

  app.post("/api/sovereign/facilities", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        directorateId: z.number(),
        name: z.string().min(1),
        code: z.string().min(1),
        type: z.string().optional(),
        address: z.string().optional().nullable(),
        contactPhone: z.string().optional().nullable(),
      }).parse(req.body);
      const fac = await storage.createFacility(input);
      await eventBus.emitAndPersist({
        eventType: EventTypes.FACILITY_CREATED,
        entityType: "facility",
        entityId: fac.id,
        payload: { name: fac.name, code: fac.code },
        emittedBy: req.staffMember.id,
      });
      res.status(201).json(fac);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === IDENTITY TOKENS ===

  app.post("/api/sovereign/tokens", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        name: z.string().min(1),
        scope: z.enum(["analyzer", "readonly", "full"]).optional(),
        facilityId: z.number().optional().nullable(),
        labId: z.number().optional().nullable(),
        expiresAt: z.string().datetime().optional().nullable(),
      }).parse(req.body);

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);

      const token = await storage.createApiToken({
        name: input.name,
        tokenHash,
        scope: input.scope || "analyzer",
        facilityId: input.facilityId || null,
        labId: input.labId || null,
        issuedBy: req.staffMember.id,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      });

      await eventBus.emitAndPersist({
        eventType: EventTypes.TOKEN_ISSUED,
        entityType: "api_token",
        entityId: token.id,
        payload: { name: token.name, scope: token.scope },
        emittedBy: req.staffMember.id,
      });

      res.status(201).json({ ...token, rawToken });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.delete("/api/sovereign/tokens/:id", requireAuth, requireAdmin, async (req, res) => {
    await storage.deactivateApiToken(Number(req.params.id));
    res.json({ message: "Token deactivated" });
  });

  // === ANALYZER INTEGRATION GATEWAY ===

  app.post("/api/analyzers/ingest", requireTokenAuth, async (req: any, res) => {
    try {
      const input = z.object({
        sampleBarcode: z.string().optional(),
        sampleId: z.number().optional(),
        externalSampleId: z.string().optional(),
        results: z.array(z.object({
          testCode: z.string(),
          value: z.string(),
          units: z.string().optional(),
          notes: z.string().optional(),
          analyzerId: z.number().optional(),
        })),
      }).parse(req.body);

      let sample;
      if (input.sampleId) {
        sample = await storage.getSample(input.sampleId);
      } else if (input.sampleBarcode) {
        const allSamples = await storage.getSamples();
        sample = allSamples.find(s => s.barcode === input.sampleBarcode);
      }

      if (!sample) {
        return res.status(404).json({ message: "Sample not found" });
      }

      if (!enforceTenantOwnership(req.tenantScope, sample.labId)) {
        return res.status(403).json({ message: "Token not authorized for this lab's samples" });
      }

      const processedResults = [];
      for (const r of input.results) {
        const existingResult = sample.results.find(
          sr => sr.testType.code === r.testCode && sr.status === "pending"
        );
        if (existingResult) {
          const updated = await storage.updateTestResult(existingResult.id, r.value, r.notes);
          if (updated) processedResults.push(updated);
        }
      }

      await eventBus.emitAndPersist({
        eventType: EventTypes.ANALYZER_INGEST,
        entityType: "sample",
        entityId: sample.id,
        payload: {
          tokenId: req.apiToken.id,
          resultsCount: processedResults.length,
          externalSampleId: input.externalSampleId,
        },
        facilityId: req.apiToken.facilityId,
      });

      res.json({
        sampleId: sample.id,
        processedCount: processedResults.length,
        results: processedResults,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === ANALYZER-CONTEXT GOVERNANCE EVALUATION ===

  app.post("/api/analyzers/governance/evaluate", requireTokenAuth, async (req: any, res) => {
    try {
      const input = z.object({
        testCode: z.string().min(1),
        sector: z.enum(["GOVERNMENT", "PRIVATE"]),
        patientId: z.number().int().positive(),
        specimenId: z.number().int().positive().optional().nullable(),
      }).parse(req.body);

      const executionContext = resolveExecutionContext(req.tenantScope);

      const result = await evaluateGovernance(
        input.testCode,
        input.sector,
        input.patientId,
        input.specimenId ?? null,
        executionContext,
        null,
      );

      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === UNIFIED EVENT BUS (SSE + REST) ===

  app.get("/api/sovereign/events", requireAuth, async (req, res) => {
    const entityType = req.query.entityType as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const evts = await storage.getEvents(entityType, limit);
    res.json(evts);
  });

  app.get("/api/sovereign/events/stream", requireAuth, (req: any, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const onEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on("*", onEvent);
    req.on("close", () => {
      eventBus.off("*", onEvent);
    });
  });

  // === OFFLINE CLINICAL MODE ===

  app.post("/api/sovereign/offline/enqueue", requireAuth, async (req: any, res) => {
    try {
      const input = z.object({
        operations: z.array(z.object({
          operationType: z.string(),
          endpoint: z.string(),
          method: z.string(),
          payload: z.any().optional(),
        })),
      }).parse(req.body);

      const enqueued = [];
      for (const op of input.operations) {
        const item = await storage.enqueueOfflineOp({
          operationType: op.operationType,
          endpoint: op.endpoint,
          method: op.method,
          payload: op.payload || null,
          staffId: req.staffMember.id,
          facilityId: req.staffMember.facilityId || null,
          status: "pending",
        });
        enqueued.push(item);
      }

      res.status(201).json({ enqueued: enqueued.length, items: enqueued });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/sovereign/offline/pending", requireAuth, async (req: any, res) => {
    const items = await storage.getPendingOfflineOps(req.staffMember.id);
    res.json(items);
  });

  app.post("/api/sovereign/offline/sync", requireAuth, async (req: any, res) => {
    const pending = await storage.getPendingOfflineOps(req.staffMember.id);
    const results: { id: number; status: string; error?: string }[] = [];

    for (const item of pending) {
      try {
        await storage.markOfflineOpProcessed(item.id);
        results.push({ id: item.id, status: "processed" });
      } catch (err: any) {
        await storage.markOfflineOpFailed(item.id, err.message || "Unknown error");
        results.push({ id: item.id, status: "failed", error: err.message });
      }
    }

    await eventBus.emitAndPersist({
      eventType: EventTypes.OFFLINE_SYNC,
      entityType: "offline_queue",
      payload: { processedCount: results.filter(r => r.status === "processed").length },
      emittedBy: req.staffMember.id,
    });

    res.json({ synced: results.length, results });
  });

  // === PRICING ENGINE ===

  app.post("/api/sovereign/invoices/generate", requireAuth, async (req: any, res) => {
    try {
      const input = z.object({
        sampleId: z.number(),
        patientId: z.number(),
        facilityId: z.number().optional().nullable(),
      }).parse(req.body);

      const invoice = await storage.generateInvoiceForSample(
        input.sampleId,
        input.patientId,
        input.facilityId
      );

      await eventBus.emitAndPersist({
        eventType: EventTypes.INVOICE_GENERATED,
        entityType: "invoice",
        entityId: invoice.id,
        payload: { invoiceNumber: invoice.invoiceNumber, netAmount: invoice.netAmount },
        emittedBy: req.staffMember.id,
      });

      res.status(201).json(invoice);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/sovereign/invoices/:id", requireAuth, async (req, res) => {
    const invoice = await storage.getInvoice(Number(req.params.id));
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    res.json(invoice);
  });

  app.get("/api/sovereign/invoices", requireAuth, async (req, res) => {
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    if (!patientId) return res.status(400).json({ message: "patientId required" });
    const invs = await storage.getInvoicesByPatient(patientId);
    res.json(invs);
  });

  // === LABS (multi-tenant entities) ===

  app.get("/api/sovereign/labs", requireAuth, async (req, res) => {
    const orgId = req.query.organizationId ? Number(req.query.organizationId) : undefined;
    const allLabs = await storage.getLabs(orgId);
    res.json(allLabs);
  });

  app.get("/api/sovereign/labs/:id", requireAuth, async (req, res) => {
    const lab = await storage.getLab(Number(req.params.id));
    if (!lab) return res.status(404).json({ message: "Lab not found" });
    res.json(lab);
  });

  app.post("/api/sovereign/labs", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        organizationId: z.number(),
        labName: z.string().min(1),
        facilityCode: z.string().min(1),
        address: z.string().optional().nullable(),
        contactPhone: z.string().optional().nullable(),
      }).parse(req.body);
      const lab = await storage.createLab(input);
      await eventBus.emitAndPersist({
        eventType: EventTypes.FACILITY_CREATED,
        entityType: "lab",
        entityId: lab.id,
        payload: { labName: lab.labName, facilityCode: lab.facilityCode },
        emittedBy: req.staffMember.id,
      });
      res.status(201).json(lab);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.patch("/api/sovereign/staff/:id/lab", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({ labId: z.number().nullable() }).parse(req.body);
      const updated = await storage.updateStaffLab(Number(req.params.id), input.labId);
      if (!updated) return res.status(404).json({ message: "Staff not found" });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === TECHNICIAN BENCH DATA ===

  app.get("/api/sovereign/bench/queue", requireAuth, async (req: any, res) => {
    const analyzerType = req.query.analyzerType as string | undefined;
    const labFilter = getTenantLabFilter(req.tenantScope);
    const allSamples = await storage.getSamples(undefined, undefined, labFilter);
    const pending = allSamples.filter(s => {
      const hasPendingResults = s.results.some(r => r.status === "pending" || r.status === "entered");
      const matchesAnalyzer = !analyzerType || s.analyzerType === analyzerType;
      return hasPendingResults && matchesAnalyzer;
    });

    const queue = pending.map(s => ({
      sampleId: s.id,
      barcode: s.barcode,
      accessionNumber: s.accessionNumber,
      patientName: `${s.patient.lastName}, ${s.patient.firstName}`,
      patientMrn: s.patient.mrn,
      analyzerType: s.analyzerType,
      priority: s.priority,
      collectionDate: s.collectionDate,
      pendingTests: s.results.filter(r => r.status === "pending").map(r => ({
        resultId: r.id,
        testCode: r.testType.code,
        testName: r.testType.name,
        units: r.testType.units,
        referenceRange: r.testType.referenceRange,
      })),
      enteredTests: s.results.filter(r => r.status === "entered").map(r => ({
        resultId: r.id,
        testCode: r.testType.code,
        testName: r.testType.name,
        value: r.resultValue,
        qcFlag: r.qcFlag,
        units: r.testType.units,
      })),
    }));

    res.json(queue);
  });

  // === NATIONAL CONTROL LAYER: REPORTS ===

  const requireMinistryAuditor = (req: any, res: any, next: any) => {
    if (req.staffMember?.role !== "ministry_auditor" && req.staffMember?.role !== "admin") {
      return res.status(403).json({ message: "Ministry auditor or admin access required" });
    }
    next();
  };

  app.get("/api/sovereign/national-reports", requireAuth, requireMinistryAuditor, async (req: any, res) => {
    const reportType = req.query.reportType as string | undefined;
    const labId = req.query.labId ? Number(req.query.labId) : undefined;
    const reports = await storage.getNationalReports(reportType, labId);
    res.json(reports);
  });

  const requireNationalOversight = (req: any, res: any, next: any) => {
    const role = req.staffMember?.role;
    if (role !== "ministry_auditor" && role !== "admin" && role !== "national_clinical_supervisor") {
      return res.status(403).json({ message: "National oversight access required" });
    }
    next();
  };

  app.post("/api/sovereign/national-reports/generate", requireAuth, requireMinistryAuditor, async (req: any, res) => {
    const report = await storage.generateNationalSnapshot(req.staffMember.id);
    await eventBus.emitAndPersist({
      eventType: "NATIONAL_REPORT_GENERATED",
      entityType: "national_report",
      entityId: report.id,
      payload: { reportType: report.reportType },
      emittedBy: req.staffMember.id,
    });
    res.status(201).json(report);
  });

  // === NATIONAL CLINICAL OVERSIGHT: PATIENT HISTORY WITH REASON_CODE ===

  app.get("/api/sovereign/oversight/patient/:id/history", requireAuth, requireNationalOversight, async (req: any, res) => {
    try {
      const patientId = Number(req.params.id);
      const reasonCode = req.query.reason_code as string;

      if (!reasonCode) {
        return res.status(400).json({ message: "reason_code query parameter is required for cross-lab patient history access" });
      }

      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ message: "Patient not found" });

      await storage.logNationalAccess({
        userId: req.staffMember.id,
        roleCode: req.staffMember.role,
        patientId,
        labId: patient.labId,
        reasonCode,
        accessScope: "patient_history",
        executionContext: resolveExecutionContext(req.tenantScope),
      });

      const allSamples = await storage.getSamples(undefined, patientId, undefined);

      res.json({
        patient,
        samples: allSamples,
        accessMeta: {
          reasonCode,
          sessionScoped: true,
          accessedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      throw err;
    }
  });

  // === NATIONAL CLINICAL OVERSIGHT: POLICY ENGINE ===

  app.get("/api/sovereign/oversight/policies", requireAuth, requireNationalOversight, async (req: any, res) => {
    const sector = req.query.sector as string | undefined;
    const activeOnly = req.query.active === "true";
    const policies = await storage.getPolicies(sector, activeOnly);
    res.json(policies);
  });

  app.post("/api/sovereign/oversight/policies", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        testCode: z.string().optional().nullable(),
        sector: z.enum(["GOVERNMENT", "PRIVATE"]),
        restrictionType: z.string().min(1),
        ruleDurationDays: z.number().optional().nullable(),
        approvalRequired: z.boolean().optional(),
        description: z.string().optional().nullable(),
      }).parse(req.body);

      const policy = await storage.createPolicy(input);
      await eventBus.emitAndPersist({
        eventType: "POLICY_CREATED",
        entityType: "policy",
        entityId: policy.id,
        payload: { restrictionType: policy.restrictionType, sector: policy.sector },
        emittedBy: req.staffMember.id,
      });
      res.status(201).json(policy);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.patch("/api/sovereign/oversight/policies/:id/active", requireAuth, requireAdmin, async (req: any, res) => {
    const input = z.object({ activeFlag: z.boolean() }).parse(req.body);
    const updated = await storage.updatePolicyActive(Number(req.params.id), input.activeFlag);
    if (!updated) return res.status(404).json({ message: "Policy not found" });
    res.json(updated);
  });

  app.post("/api/sovereign/oversight/policies/evaluate", requireAuth, requireNationalOversight, async (req: any, res) => {
    try {
      const input = z.object({
        testCode: z.string(),
        sector: z.enum(["GOVERNMENT", "PRIVATE"]),
      }).parse(req.body);

      const matchingPolicies = await storage.evaluatePolicies(input.testCode, input.sector);

      const results = matchingPolicies.map(p => ({
        policyId: p.id,
        restrictionType: p.restrictionType,
        ruleDurationDays: p.ruleDurationDays,
        approvalRequired: p.approvalRequired,
        mode: input.sector === "GOVERNMENT" ? "ENFORCED" : "ADVISORY",
        blocking: p.restrictionType === "HIGH_RISK_BLOCK",
      }));

      res.json({
        testCode: input.testCode,
        sector: input.sector,
        evaluatedAt: new Date().toISOString(),
        policies: results,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === NATIONAL CLINICAL OVERSIGHT: ACCESS AUDIT LOG ===

  app.get("/api/sovereign/oversight/access-audit", requireAuth, requireNationalOversight, async (req: any, res) => {
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    const logs = await storage.getNationalAccessAuditLog(userId, patientId);
    res.json(logs);
  });

  // === CLINICAL GOVERNANCE ENGINE: TEST POLICIES ===

  app.get("/api/sovereign/governance/policies", requireAuth, requireNationalOversight, async (req: any, res) => {
    const sector = req.query.sector as string | undefined;
    const activeOnly = req.query.active === "true";
    const policies = await storage.getTestPolicies(sector, activeOnly);
    res.json(policies);
  });

  app.post("/api/sovereign/governance/policies", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        testCode: z.string().optional().nullable(),
        sector: z.enum(["GOVERNMENT", "PRIVATE"]),
        ruleType: z.enum(["DUPLICATE_TEST_INTERVAL", "APPROVAL_REQUIRED", "VISIBILITY_CONTROL"]),
        minIntervalDays: z.number().optional().nullable(),
        requiresApproval: z.boolean().optional(),
        riskClass: z.enum(["ADVISORY", "HIGH_RISK_BLOCK"]),
        description: z.string().optional().nullable(),
      }).parse(req.body);

      const policy = await storage.createTestPolicy(input);

      await eventBus.emitAndPersist({
        eventType: EventTypes.GOVERNANCE_POLICY_CREATED,
        entityType: "test_policy",
        entityId: policy.id,
        payload: { ruleType: policy.ruleType, sector: policy.sector, riskClass: policy.riskClass },
        emittedBy: req.staffMember.id,
      });

      res.status(201).json(policy);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/sovereign/governance/policies/:id", requireAuth, requireNationalOversight, async (req: any, res) => {
    const policy = await storage.getTestPolicy(Number(req.params.id));
    if (!policy) return res.status(404).json({ message: "Test policy not found" });
    res.json(policy);
  });

  app.patch("/api/sovereign/governance/policies/:id/active", requireAuth, requireAdmin, async (req: any, res) => {
    const input = z.object({ activeFlag: z.boolean() }).parse(req.body);
    const updated = await storage.updateTestPolicyActive(Number(req.params.id), input.activeFlag);
    if (!updated) return res.status(404).json({ message: "Test policy not found" });

    await eventBus.emitAndPersist({
      eventType: EventTypes.GOVERNANCE_POLICY_UPDATED,
      entityType: "test_policy",
      entityId: updated.id,
      payload: { activeFlag: updated.activeFlag },
      emittedBy: req.staffMember.id,
    });

    res.json(updated);
  });

  // === CLINICAL GOVERNANCE ENGINE: EVALUATE ===

  app.post("/api/sovereign/governance/evaluate", requireAuth, async (req: any, res) => {
    try {
      const input = z.object({
        testCode: z.string().min(1),
        sector: z.enum(["GOVERNMENT", "PRIVATE"]),
        patientId: z.number().int().positive(),
        specimenId: z.number().int().positive().optional().nullable(),
      }).parse(req.body);

      const executionContext = resolveExecutionContext(req.tenantScope);

      const result = await evaluateGovernance(
        input.testCode,
        input.sector,
        input.patientId,
        input.specimenId ?? null,
        executionContext,
        req.staffMember?.id || null,
      );

      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === CLINICAL GOVERNANCE ENGINE: GOVERNANCE EVENTS (read-only) ===

  app.get("/api/sovereign/governance/events", requireAuth, requireNationalOversight, async (req: any, res) => {
    const specimenId = req.query.specimenId ? Number(req.query.specimenId) : undefined;
    const testCode = req.query.testCode as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const events = await storage.getGovernanceEvents(specimenId, testCode, limit);
    res.json(events);
  });

  // === CLINICAL PATHWAYS ENGINE: PATHWAY DEFINITIONS ===

  app.get("/api/sovereign/pathways", requireAuth, requireNationalOversight, async (req: any, res) => {
    const sector = req.query.sector as string | undefined;
    const activeOnly = req.query.active === "true";
    const pathways = await storage.getClinicalPathways(sector, activeOnly);
    res.json(pathways);
  });

  app.post("/api/sovereign/pathways", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        pathwayName: z.string().min(1),
        triggerTest: z.string().min(1),
        nextRecommendedTest: z.string().min(1),
        sector: z.enum(["GOVERNMENT", "PRIVATE", "NATIONAL"]),
        conditionType: z.enum(["SCREENING", "FOLLOW_UP", "MONITORING", "DIAGNOSTIC_SEQUENCE"]),
      }).parse(req.body);

      const pathway = await storage.createClinicalPathway(input);

      await eventBus.emitAndPersist({
        eventType: EventTypes.CLINICAL_PATHWAY_CREATED,
        entityType: "clinical_pathway",
        entityId: pathway.id,
        payload: { pathwayName: pathway.pathwayName, triggerTest: pathway.triggerTest, sector: pathway.sector },
        emittedBy: req.staffMember.id,
      });

      res.status(201).json(pathway);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/sovereign/pathways/:id", requireAuth, requireNationalOversight, async (req: any, res) => {
    const pathway = await storage.getClinicalPathway(Number(req.params.id));
    if (!pathway) return res.status(404).json({ message: "Clinical pathway not found" });
    res.json(pathway);
  });

  app.patch("/api/sovereign/pathways/:id/active", requireAuth, requireAdmin, async (req: any, res) => {
    const input = z.object({ activeFlag: z.boolean() }).parse(req.body);
    const updated = await storage.updateClinicalPathwayActive(Number(req.params.id), input.activeFlag);
    if (!updated) return res.status(404).json({ message: "Clinical pathway not found" });

    await eventBus.emitAndPersist({
      eventType: EventTypes.CLINICAL_PATHWAY_UPDATED,
      entityType: "clinical_pathway",
      entityId: updated.id,
      payload: { activeFlag: updated.activeFlag },
      emittedBy: req.staffMember.id,
    });

    res.json(updated);
  });

  // === CLINICAL PATHWAYS ENGINE: PATHWAY RULES ===

  app.get("/api/sovereign/pathway-rules", requireAuth, requireNationalOversight, async (req: any, res) => {
    const activeOnly = req.query.active === "true";
    const rules = await storage.getPathwayRules(activeOnly);
    res.json(rules);
  });

  app.post("/api/sovereign/pathway-rules", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        testCode: z.string().min(1),
        requiresPreviousTest: z.string().optional().nullable(),
        timeWindowDays: z.number().int().positive().optional().nullable(),
        suggestionLevel: z.enum(["INFO", "WARN", "REQUIRE_APPROVAL"]),
        riskClass: z.enum(["ADVISORY", "HIGH_RISK"]),
      }).parse(req.body);

      const rule = await storage.createPathwayRule(input);

      await eventBus.emitAndPersist({
        eventType: EventTypes.PATHWAY_RULE_CREATED,
        entityType: "pathway_rule",
        entityId: rule.id,
        payload: { testCode: rule.testCode, suggestionLevel: rule.suggestionLevel, riskClass: rule.riskClass },
        emittedBy: req.staffMember.id,
      });

      res.status(201).json(rule);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/sovereign/pathway-rules/:id", requireAuth, requireNationalOversight, async (req: any, res) => {
    const rule = await storage.getPathwayRule(Number(req.params.id));
    if (!rule) return res.status(404).json({ message: "Pathway rule not found" });
    res.json(rule);
  });

  app.patch("/api/sovereign/pathway-rules/:id/active", requireAuth, requireAdmin, async (req: any, res) => {
    const input = z.object({ activeFlag: z.boolean() }).parse(req.body);
    const updated = await storage.updatePathwayRuleActive(Number(req.params.id), input.activeFlag);
    if (!updated) return res.status(404).json({ message: "Pathway rule not found" });

    await eventBus.emitAndPersist({
      eventType: EventTypes.PATHWAY_RULE_UPDATED,
      entityType: "pathway_rule",
      entityId: updated.id,
      payload: { activeFlag: updated.activeFlag },
      emittedBy: req.staffMember.id,
    });

    res.json(updated);
  });

  // === CLINICAL PATHWAYS ENGINE: EVALUATE (USER_SESSION) ===

  app.post("/api/sovereign/pathways/evaluate", requireAuth, async (req: any, res) => {
    try {
      const input = z.object({
        testCode: z.string().min(1),
        sector: z.enum(["GOVERNMENT", "PRIVATE", "NATIONAL"]),
        patientId: z.number().int().positive(),
        specimenId: z.number().int().positive().optional().nullable(),
      }).parse(req.body);

      const executionContext = resolveExecutionContext(req.tenantScope);

      const result = await evaluatePathways(
        input.testCode,
        input.sector,
        input.patientId,
        input.specimenId ?? null,
        executionContext,
        req.staffMember?.id || null,
      );

      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.json({
        specimenId: null, triggerTestCode: req.body?.testCode || "", sector: req.body?.sector || "",
        evaluatedAt: new Date().toISOString(), executionContext: "USER_SESSION",
        suggestions: [], totalPathwaysEvaluated: 0, totalRulesEvaluated: 0,
        engineError: true,
      });
    }
  });

  // === CLINICAL PATHWAYS ENGINE: EVALUATE (ANALYZER_SOURCE) ===

  app.post("/api/analyzers/pathways/evaluate", requireTokenAuth, async (req: any, res) => {
    try {
      const input = z.object({
        testCode: z.string().min(1),
        sector: z.enum(["GOVERNMENT", "PRIVATE", "NATIONAL"]),
        patientId: z.number().int().positive(),
        specimenId: z.number().int().positive().optional().nullable(),
      }).parse(req.body);

      const executionContext = resolveExecutionContext(req.tenantScope);

      const result = await evaluatePathways(
        input.testCode,
        input.sector,
        input.patientId,
        input.specimenId ?? null,
        executionContext,
        null,
      );

      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.json({
        specimenId: null, triggerTestCode: req.body?.testCode || "", sector: req.body?.sector || "",
        evaluatedAt: new Date().toISOString(), executionContext: "ANALYZER_SOURCE",
        suggestions: [], totalPathwaysEvaluated: 0, totalRulesEvaluated: 0,
        engineError: true,
      });
    }
  });

  // === CLINICAL PATHWAYS ENGINE: PATHWAY EVENTS (read-only) ===

  app.get("/api/sovereign/pathways/events", requireAuth, requireNationalOversight, async (req: any, res) => {
    const specimenId = req.query.specimenId ? Number(req.query.specimenId) : undefined;
    const pathwayId = req.query.pathwayId ? Number(req.query.pathwayId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const events = await storage.getClinicalPathwayEvents(specimenId, pathwayId, limit);
    res.json(events);
  });

  // === SOVEREIGN IDENTITY: VERIFICATION WORKFLOW ===

  setupIdentityVerificationListener();

  app.post("/api/sovereign/identity/set-national-id/:patientId", requireAuth, async (req: any, res) => {
    try {
      const patientId = Number(req.params.patientId);
      const input = z.object({
        nationalIdNumber: z.string().min(1),
      }).parse(req.body);

      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ message: "Patient not found" });

      if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const encrypted = encryptNationalId(input.nationalIdNumber);
      await storage.updatePatient(patientId, { nationalIdEncrypted: encrypted } as any);

      const executionContext = resolveExecutionContext(req.tenantScope);
      const nationalIdHash = hashNationalId(input.nationalIdNumber);

      await eventBus.emitAndPersist({
        eventType: EventTypes.IDENTITY_VERIFICATION_REQUEST,
        entityType: "patient",
        entityId: patientId,
        payload: {
          patientId,
          nationalIdHash,
          executionContext,
          emittedBy: req.staffMember?.id,
        },
        emittedBy: req.staffMember?.id || null,
        facilityId: patient.facilityId || null,
      });

      await processIdentityVerification(
        patientId,
        input.nationalIdNumber,
        executionContext,
        req.staffMember?.id
      );

      res.json({
        patientId,
        nationalIdStored: true,
        verificationStatus: "PENDING",
        executionContext,
        message: "National ID stored. Verification initiated asynchronously.",
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/sovereign/identity/verify/:patientId", requireAuth, async (req: any, res) => {
    try {
      const patientId = Number(req.params.patientId);

      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ message: "Patient not found" });

      if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!patient.nationalIdEncrypted) {
        return res.status(400).json({ message: "No national ID stored for this patient" });
      }

      const nationalId = decryptNationalId(patient.nationalIdEncrypted);
      const executionContext = resolveExecutionContext(req.tenantScope);

      await processIdentityVerification(
        patientId,
        nationalId,
        executionContext,
        req.staffMember?.id
      );

      const latest = await storage.getLatestVerificationByPatient(patientId);
      res.json({
        patientId,
        verification: latest
          ? {
              id: latest.id,
              status: latest.verificationStatus,
              source: latest.verificationSource,
              executionContext: latest.executionContext,
              verifiedAt: latest.verifiedAt,
              createdAt: latest.createdAt,
            }
          : null,
      });
    } catch (err) {
      throw err;
    }
  });

  app.get("/api/sovereign/identity/status/:patientId", requireAuth, async (req: any, res) => {
    const patientId = Number(req.params.patientId);

    const patient = await storage.getPatient(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const latest = await storage.getLatestVerificationByPatient(patientId);
    res.json({
      patientId,
      hasNationalId: !!patient.nationalIdEncrypted,
      latestVerification: latest
        ? {
            id: latest.id,
            status: latest.verificationStatus,
            source: latest.verificationSource,
            executionContext: latest.executionContext,
            verifiedAt: latest.verifiedAt,
            createdAt: latest.createdAt,
          }
        : null,
    });
  });

  // === ANALYZER-TOKEN IDENTITY ROUTES (ANALYZER_SOURCE context) ===

  app.post("/api/analyzers/identity/set-national-id/:patientId", requireTokenAuth, async (req: any, res) => {
    try {
      const patientId = Number(req.params.patientId);
      const input = z.object({
        nationalIdNumber: z.string().min(1),
      }).parse(req.body);

      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ message: "Patient not found" });

      if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
        return res.status(403).json({ message: "Access denied: token lab scope mismatch" });
      }

      const executionContext = resolveExecutionContext(req.tenantScope);

      const encrypted = encryptNationalId(input.nationalIdNumber);
      await storage.updatePatient(patientId, { nationalIdEncrypted: encrypted } as any);

      const nationalIdHash = hashNationalId(input.nationalIdNumber);

      await eventBus.emitAndPersist({
        eventType: EventTypes.IDENTITY_VERIFICATION_REQUEST,
        entityType: "patient",
        entityId: patientId,
        payload: {
          patientId,
          nationalIdHash,
          executionContext,
        },
        emittedBy: null,
        facilityId: patient.facilityId || null,
      });

      await processIdentityVerification(
        patientId,
        input.nationalIdNumber,
        executionContext
      );

      res.json({
        patientId,
        nationalIdStored: true,
        verificationStatus: "PENDING",
        executionContext,
        message: "National ID stored via analyzer. Verification initiated.",
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/analyzers/identity/verify/:patientId", requireTokenAuth, async (req: any, res) => {
    try {
      const patientId = Number(req.params.patientId);

      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ message: "Patient not found" });

      if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
        return res.status(403).json({ message: "Access denied: token lab scope mismatch" });
      }

      if (!patient.nationalIdEncrypted) {
        return res.status(400).json({ message: "No national ID stored for this patient" });
      }

      const executionContext = resolveExecutionContext(req.tenantScope);
      const nationalId = decryptNationalId(patient.nationalIdEncrypted);

      await processIdentityVerification(
        patientId,
        nationalId,
        executionContext
      );

      const latest = await storage.getLatestVerificationByPatient(patientId);
      res.json({
        patientId,
        executionContext,
        verification: latest
          ? {
              id: latest.id,
              status: latest.verificationStatus,
              source: latest.verificationSource,
              executionContext: latest.executionContext,
              verifiedAt: latest.verifiedAt,
              createdAt: latest.createdAt,
            }
          : null,
      });
    } catch (err) {
      throw err;
    }
  });

  // === FEDERATION GATEWAY IDENTITY ROUTES (FEDERATION_GATEWAY context) ===

  const requireFederationAuth = (req: any, res: any, next: any) => {
    isAuthenticated(req, res, async (err?: any) => {
      if (err) return next(err);
      const claims = req.user?.claims;
      if (!claims?.sub) return res.status(401).json({ message: "Unauthorized" });
      const name = [claims.first_name, claims.last_name].filter(Boolean).join(" ") || claims.email || "User";
      req.staffMember = await storage.findOrCreateStaffByReplitUser(claims.sub, name);

      const labId = req.body?.labId || req.query?.labId ? Number(req.body?.labId || req.query?.labId) : null;
      const { attachFederationTenantScope } = await import("./tenantScope");
      req.tenantScope = attachFederationTenantScope(labId, req.staffMember.id);
      next();
    });
  };

  app.post("/api/federation/identity/set-national-id/:patientId", requireFederationAuth, async (req: any, res) => {
    try {
      const patientId = Number(req.params.patientId);
      const input = z.object({
        nationalIdNumber: z.string().min(1),
        labId: z.number().optional(),
      }).parse(req.body);

      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ message: "Patient not found" });

      if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
        return res.status(403).json({ message: "Access denied: federation scope mismatch" });
      }

      const executionContext = resolveExecutionContext(req.tenantScope);

      const encrypted = encryptNationalId(input.nationalIdNumber);
      await storage.updatePatient(patientId, { nationalIdEncrypted: encrypted } as any);

      const nationalIdHash = hashNationalId(input.nationalIdNumber);

      await eventBus.emitAndPersist({
        eventType: EventTypes.IDENTITY_VERIFICATION_REQUEST,
        entityType: "patient",
        entityId: patientId,
        payload: {
          patientId,
          nationalIdHash,
          executionContext,
        },
        emittedBy: req.staffMember?.id || null,
        facilityId: patient.facilityId || null,
      });

      await processIdentityVerification(
        patientId,
        input.nationalIdNumber,
        executionContext,
        req.staffMember?.id
      );

      res.json({
        patientId,
        nationalIdStored: true,
        verificationStatus: "PENDING",
        executionContext,
        message: "National ID stored via federation gateway. Verification initiated.",
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/federation/identity/verify/:patientId", requireFederationAuth, async (req: any, res) => {
    try {
      const patientId = Number(req.params.patientId);

      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ message: "Patient not found" });

      if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
        return res.status(403).json({ message: "Access denied: federation scope mismatch" });
      }

      if (!patient.nationalIdEncrypted) {
        return res.status(400).json({ message: "No national ID stored for this patient" });
      }

      const executionContext = resolveExecutionContext(req.tenantScope);
      const nationalId = decryptNationalId(patient.nationalIdEncrypted);

      await processIdentityVerification(
        patientId,
        nationalId,
        executionContext,
        req.staffMember?.id
      );

      const latest = await storage.getLatestVerificationByPatient(patientId);
      res.json({
        patientId,
        executionContext,
        verification: latest
          ? {
              id: latest.id,
              status: latest.verificationStatus,
              source: latest.verificationSource,
              executionContext: latest.executionContext,
              verifiedAt: latest.verifiedAt,
              createdAt: latest.createdAt,
            }
          : null,
      });
    } catch (err) {
      throw err;
    }
  });

  // === USER SESSION IDENTITY HISTORY (read-only) ===

  app.get("/api/sovereign/identity/history/:patientId", requireAuth, async (req: any, res) => {
    const patientId = Number(req.params.patientId);

    const patient = await storage.getPatient(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const verifications = await storage.getIdentityVerificationsByPatient(patientId);
    res.json({
      patientId,
      verifications: verifications.map(v => ({
        id: v.id,
        status: v.verificationStatus,
        source: v.verificationSource,
        executionContext: v.executionContext,
        verifiedAt: v.verifiedAt,
        createdAt: v.createdAt,
      })),
    });
  });

  // === EVENT-DRIVEN PROCESSING: WORKER STATUS ===

  app.get("/api/sovereign/worker/status", requireAuth, requireAdmin, async (_req, res) => {
    res.json(getWorkerStatus());
  });

  // === EVENT-DRIVEN PROCESSING: READ MODELS ===

  app.get("/api/sovereign/read-models/worklist", requireAuth, async (req: any, res) => {
    const labFilter = getTenantLabFilter(req.tenantScope);
    const data = await storage.getWorklistView(labFilter);
    res.json(data);
  });

  app.get("/api/sovereign/read-models/metrics", requireAuth, requireNationalOversight, async (req: any, res) => {
    const labId = req.query.labId ? Number(req.query.labId) : undefined;
    const data = await storage.getNationalMetricsView(labId);
    res.json(data);
  });

  app.get("/api/sovereign/read-models/suggestions", requireAuth, async (req: any, res) => {
    const labFilter = getTenantLabFilter(req.tenantScope);
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const data = await storage.getSuggestionStreamView(labFilter, limit);
    res.json(data);
  });

  // === UNIFIED SUGGESTION ORCHESTRATOR ===

  app.get("/api/sovereign/suggestions/unified", requireAuth, async (req: any, res) => {
    const labFilter = getTenantLabFilter(req.tenantScope);
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const suggestions = await storage.getUnifiedSuggestions(labFilter, patientId, limit);
    res.json(suggestions);
  });

  // === NOTIFICATIONS ===

  app.get("/api/notifications", requireAuth, async (req: any, res) => {
    const unreadOnly = req.query.unread === "true";
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const notifs = await storage.getNotifications(req.staffMember.id, unreadOnly, limit);
    res.json(notifs);
  });

  app.get("/api/notifications/count", requireAuth, async (req: any, res) => {
    const count = await storage.getUnreadNotificationCount(req.staffMember.id);
    res.json({ unreadCount: count });
  });

  app.patch("/api/notifications/:id/read", requireAuth, async (req: any, res) => {
    const updated = await storage.markNotificationRead(Number(req.params.id), req.staffMember.id);
    if (!updated) return res.status(404).json({ message: "Notification not found" });
    res.json(updated);
  });

  app.post("/api/notifications/read-all", requireAuth, async (req: any, res) => {
    await storage.markAllNotificationsRead(req.staffMember.id);
    res.json({ message: "All notifications marked as read" });
  });

  // === NOTIFICATION TEMPLATES (admin) ===

  app.get("/api/sovereign/notification-templates", requireAuth, requireAdmin, async (req: any, res) => {
    const eventType = req.query.eventType as string | undefined;
    const templates = await storage.getNotificationTemplates(eventType);
    res.json(templates);
  });

  app.post("/api/sovereign/notification-templates", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        templateCode: z.string().min(1),
        eventType: z.string().min(1),
        titleTemplate: z.string().min(1),
        bodyTemplate: z.string().min(1),
        notificationType: z.enum(["INFO", "WARN", "CRITICAL"]).optional(),
      }).parse(req.body);
      const template = await storage.createNotificationTemplate(input);
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === SECURITY EVENTS (admin/oversight) ===

  app.get("/api/sovereign/security-events", requireAuth, requireNationalOversight, async (req: any, res) => {
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const events = await storage.getSecurityEvents(userId, limit);
    res.json(events);
  });

  // === GOVERNANCE JOBS: STATUS & STATS ===

  app.get("/api/sovereign/governance/worker/status", requireAuth, requireAdmin, async (_req, res) => {
    res.json(getGovernanceWorkerStatus());
  });

  app.get("/api/sovereign/governance/jobs/stats", requireAuth, requireAdmin, async (_req, res) => {
    const stats = await storage.getGovernanceJobStats();
    res.json(stats);
  });

  app.get("/api/sovereign/governance/jobs", requireAuth, requireAdmin, async (req: any, res) => {
    const eventId = req.query.eventId ? Number(req.query.eventId) : undefined;
    if (eventId) {
      const jobs = await storage.getGovernanceJobsByEventId(eventId);
      return res.json(jobs);
    }
    const pending = await storage.getPendingGovernanceJobs(100);
    res.json(pending);
  });

  // === HOT VS COLD DATA ARCHITECTURE: ARCHIVE ROUTES ===

  app.get("/api/sovereign/archive/worker/status", requireAuth, requireAdmin, async (req: any, res) => {
    res.json(getArchiveWorkerStatus());
  });

  app.get("/api/sovereign/archive/stats", requireAuth, requireAdmin, async (req: any, res) => {
    const stats = await storage.getArchiveWorkerStats();
    res.json(stats);
  });

  app.get("/api/sovereign/archive/results", requireAuth, async (req: any, res) => {
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    const labFilter = getTenantLabFilter(req);
    const results = await storage.getResultsArchive(patientId, labFilter ?? undefined, 200);
    res.json(results);
  });

  app.get("/api/sovereign/patient-history/:patientId", requireAuth, async (req: any, res) => {
    const patientId = Number(req.params.patientId);
    if (isNaN(patientId)) return res.status(400).json({ error: "Invalid patient ID" });
    const labFilter = getTenantLabFilter(req);
    const summary = await storage.getPatientHistorySummary(patientId, labFilter ?? undefined);
    if (!summary) return res.status(404).json({ error: "No history summary found" });
    res.json(summary);
  });

  app.get("/api/sovereign/patient-history", requireAuth, async (req: any, res) => {
    const labFilter = getTenantLabFilter(req);
    const summaries = await storage.getPatientHistorySummaries(labFilter ?? undefined);
    res.json(summaries);
  });

  // === INSTRUMENT STREAMING GATEWAY ===

  app.post("/api/gateway/analyzer-ingest", async (req: any, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Bearer token required" });
      }
      const bearerToken = authHeader.slice(7);
      const analyzer = await authenticateAnalyzer(bearerToken);
      if (!analyzer) {
        return res.status(401).json({ message: "Invalid or inactive analyzer token" });
      }

      const facilityValid = await validateFacilityCode(analyzer.facilityCode);
      if (!facilityValid) {
        return res.status(403).json({ message: "Unknown facility code" });
      }

      const messageFormat = (req.body.format || "JSON").toUpperCase() as "HL7" | "ASTM" | "JSON";
      const rawPayload = req.body.message || req.body.payload || req.body;

      if (!rawPayload) {
        return res.status(400).json({ message: "Missing message payload" });
      }

      const result = await ingestMessage(analyzer, messageFormat, rawPayload);
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }

      res.status(202).json({
        accepted: true,
        eventId: result.eventId,
        messageHash: result.messageHash,
        duplicate: result.duplicate || false,
        budgetExceeded: result.budgetExceeded || false,
      });
    } catch (err) {
      res.status(500).json({ message: "Gateway ingestion failed" });
    }
  });

  app.get("/api/gateway/status", requireAuth, requireAdmin, async (_req, res) => {
    res.json(getGatewayStatus());
  });

  // === ANALYZER MANAGEMENT ===

  app.post("/api/sovereign/analyzers", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        analyzerId: z.string().min(1),
        facilityCode: z.string().min(1),
        analyzerType: z.string().min(1),
      }).parse(req.body);

      const facilityValid = await validateFacilityCode(input.facilityCode);
      if (!facilityValid) {
        return res.status(400).json({ message: "Unknown facility code — register the lab first" });
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);

      const analyzer = await storage.createAnalyzer({
        analyzerId: input.analyzerId,
        facilityCode: input.facilityCode,
        analyzerType: input.analyzerType,
        analyzerTokenHash: tokenHash,
      });

      res.status(201).json({
        ...analyzer,
        analyzerToken: rawToken,
        analyzerTokenHash: undefined,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/sovereign/analyzers", requireAuth, requireAdmin, async (req: any, res) => {
    const facilityCode = req.query.facilityCode as string | undefined;
    const list = await storage.getAnalyzers(facilityCode);
    const safe = list.map(a => ({ ...a, analyzerTokenHash: undefined }));
    res.json(safe);
  });

  app.post("/api/sovereign/analyzers/:id/rotate-token", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid analyzer ID" });

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const updated = await storage.updateAnalyzerToken(id, tokenHash);
      if (!updated) return res.status(404).json({ message: "Analyzer not found" });

      res.json({ analyzerToken: rawToken, message: "Token rotated successfully" });
    } catch (err) {
      throw err;
    }
  });

  app.delete("/api/sovereign/analyzers/:id", requireAuth, requireAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid analyzer ID" });
    await storage.deactivateAnalyzer(id);
    res.json({ message: "Analyzer deactivated" });
  });

  // === ANALYZER WORKER STATUS ===

  app.get("/api/sovereign/analyzer-worker/status", requireAuth, requireAdmin, async (_req, res) => {
    res.json(getAnalyzerWorkerStatus());
  });

  app.get("/api/sovereign/analyzer-worker/queue-stats", requireAuth, requireAdmin, async (_req, res) => {
    const stats = await storage.getAnalyzerEventQueueStats();
    res.json(stats);
  });

  // === OFFLINE SYNC WORKER STATUS ===

  app.get("/api/sovereign/offline-sync/status", requireAuth, requireAdmin, async (_req, res) => {
    res.json(getOfflineSyncWorkerStatus());
  });

  app.get("/api/sovereign/offline-sync/stats", requireAuth, requireAdmin, async (_req, res) => {
    const stats = await storage.getSyncEventStats();
    res.json(stats);
  });

  app.get("/api/sovereign/offline-sync/events", requireAuth, requireAdmin, async (req: any, res) => {
    const facilityCode = req.query.facilityCode as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    if (facilityCode) {
      const events = await storage.getSyncEventsByFacility(facilityCode, limit);
      return res.json(events);
    }
    const events = await storage.getPendingSyncEvents(limit);
    res.json(events);
  });

  app.post("/api/sovereign/offline-sync/events", requireAuth, async (req: any, res) => {
    const { eventType, facilityCode, payload, advisoryOriginFlag, sourceType } = req.body;
    if (!eventType || typeof eventType !== "string") {
      return res.status(400).json({ message: "eventType string is required" });
    }
    if (!facilityCode || typeof facilityCode !== "string") {
      return res.status(400).json({ message: "facilityCode string is required" });
    }
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ message: "payload object is required" });
    }
    createOfflineSyncEvent(eventType, facilityCode, payload, req, advisoryOriginFlag, sourceType);
    res.status(202).json({ message: "Sync event queued" });
  });

  // === GLOBAL EVENT BUDGET ===

  app.get("/api/sovereign/event-budget/status", requireAuth, requireAdmin, async (_req, res) => {
    res.json(globalEventBudget.getStatus());
  });

  // === SYNC CONFLICT POLICIES ===

  app.get("/api/sovereign/conflict-policies", requireAuth, requireAdmin, async (_req, res) => {
    const policies = await storage.getSyncConflictPolicies(true);
    res.json(policies);
  });

  app.post("/api/sovereign/conflict-policies", requireAuth, requireAdmin, async (req: any, res) => {
    const { entityType, priorityOrder, mergeStrategy, retentionDays } = req.body;
    if (!entityType || !priorityOrder || !mergeStrategy) {
      return res.status(400).json({ message: "entityType, priorityOrder, and mergeStrategy are required" });
    }
    const policy = await storage.createSyncConflictPolicy({
      entityType,
      priorityOrder,
      mergeStrategy,
      retentionDays: retentionDays || 365,
      activeFlag: true,
    });
    res.status(201).json(policy);
  });

  app.patch("/api/sovereign/conflict-policies/:id", requireAuth, requireAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid policy ID" });
    const { activeFlag } = req.body;
    if (typeof activeFlag !== "boolean") return res.status(400).json({ message: "activeFlag boolean required" });
    const updated = await storage.updateSyncConflictPolicyActive(id, activeFlag);
    if (!updated) return res.status(404).json({ message: "Policy not found" });
    res.json(updated);
  });

  // === CONFLICT AUDIT LOG ===

  app.get("/api/sovereign/conflict-audit", requireAuth, requireAdmin, async (req: any, res) => {
    const facilityCode = req.query.facilityCode as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await storage.getConflictAuditLogs(facilityCode, limit);
    res.json(logs);
  });

  app.patch("/api/sovereign/conflict-audit/:id/resolve", requireAuth, requireAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid audit log ID" });
    const userId = req.user?.id || null;
    const resolved = await storage.updateConflictResolution(id, userId);
    if (!resolved) return res.status(404).json({ message: "Conflict audit entry not found" });
    res.json(resolved);
  });

  // === FACILITY CONNECTIVITY STATUS ===

  app.get("/api/sovereign/facility-connectivity", requireAuth, requireAdmin, async (_req, res) => {
    const statuses = await storage.getAllFacilityConnectivityStatuses();
    res.json(statuses);
  });

  app.get("/api/sovereign/facility-connectivity/:facilityCode", requireAuth, async (req: any, res) => {
    const status = await storage.getFacilityConnectivityStatus(req.params.facilityCode);
    if (!status) return res.status(404).json({ message: "Facility not found" });
    res.json(status);
  });

  app.post("/api/sovereign/facility-connectivity/:facilityCode/heartbeat", requireAuth, async (req: any, res) => {
    const facilityCode = req.params.facilityCode;
    const updated = await storage.upsertFacilityConnectivityStatus({
      facilityCode,
      lastSyncAt: new Date(),
      onlineStatus: "ONLINE",
      syncLatencyMs: 0,
      pendingEventCount: 0,
    });
    res.json(updated);
  });

  // === ZERO-TRUST IDENTITY MANAGEMENT ===

  app.post("/api/sovereign/zero-trust/identities", requireAuth, requireAdmin, blockClientProvidedContext, async (req: any, res) => {
    const { identityType, entityRef, facilityScope, roleScope } = req.body;
    if (!identityType || !["USER", "ANALYZER", "LOCAL_NODE"].includes(identityType)) {
      return res.status(400).json({ message: "identityType must be USER, ANALYZER, or LOCAL_NODE" });
    }
    if (!entityRef || typeof entityRef !== "number") {
      return res.status(400).json({ message: "entityRef (numeric) is required" });
    }
    if (!facilityScope || !roleScope) {
      return res.status(400).json({ message: "facilityScope and roleScope are required" });
    }
    const result = await issueIdentityToken(identityType, entityRef, facilityScope, roleScope);
    res.status(201).json({
      identityUuid: result.identityUuid,
      token: result.rawToken,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  app.post("/api/sovereign/zero-trust/identities/:identityUuid/rotate", requireAuth, requireAdmin, async (req: any, res) => {
    const result = await rotateIdentityToken(req.params.identityUuid);
    if (!result) return res.status(404).json({ message: "Identity not found or not active" });
    res.json({
      identityUuid: result.identityUuid,
      token: result.rawToken,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  app.post("/api/sovereign/zero-trust/identities/:identityUuid/revoke", requireAuth, requireAdmin, async (req: any, res) => {
    const revoked = await revokeIdentity(req.params.identityUuid);
    if (!revoked) return res.status(404).json({ message: "Identity not found" });
    res.json({ message: "Identity revoked" });
  });

  app.post("/api/sovereign/zero-trust/identities/validate", requireAuth, async (req: any, res) => {
    const { identityUuid, token } = req.body;
    if (!identityUuid || !token) {
      return res.status(400).json({ message: "identityUuid and token are required" });
    }
    const result = await validateIdentityToken(identityUuid, token);
    res.json({
      valid: result.valid,
      reason: result.reason,
      localOnly: result.localOnly || false,
      identityType: result.identity?.identityType,
      facilityScope: result.identity?.facilityScope,
      roleScope: result.identity?.roleScope,
    });
  });

  app.get("/api/sovereign/zero-trust/identities", requireAuth, requireAdmin, async (req: any, res) => {
    const identityType = req.query.identityType as string | undefined;
    const identities = await storage.getActiveIdentities(identityType);
    res.json(identities.map(i => ({
      ...i,
      signedTokenHash: "[REDACTED]",
    })));
  });

  // === SECURITY QUARANTINE QUEUE ===

  app.get("/api/sovereign/zero-trust/quarantine", requireAuth, requireAdmin, async (req: any, res) => {
    const reviewStatus = req.query.reviewStatus as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entries = await storage.getQuarantineEntries(reviewStatus, limit);
    res.json(entries);
  });

  app.patch("/api/sovereign/zero-trust/quarantine/:id/review", requireAuth, requireAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid quarantine entry ID" });
    const { reviewStatus } = req.body;
    if (!reviewStatus || !["APPROVED", "REJECTED", "ESCALATED"].includes(reviewStatus)) {
      return res.status(400).json({ message: "reviewStatus must be APPROVED, REJECTED, or ESCALATED" });
    }
    const userId = req.user?.id || req.staffMember?.id;
    const updated = await storage.updateQuarantineReview(id, reviewStatus, userId);
    if (!updated) return res.status(404).json({ message: "Quarantine entry not found" });
    res.json(updated);
  });

  // === NATIONAL AUDIT TRAIL ===

  app.get("/api/sovereign/zero-trust/audit-trail", requireAuth, requireRoleScope("LAB_ADMIN", "NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"), enforceFacilityIsolation, async (req: any, res) => {
    const facilityScope = req.query.facilityScope as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const trail = await storage.getNationalAuditTrail(facilityScope, limit);
    res.json(trail);
  });

  app.get("/api/sovereign/zero-trust/audit-trail/identity/:identityUuid", requireAuth, requireRoleScope("LAB_ADMIN", "NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"), enforceFacilityIsolation, async (req: any, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const trail = await storage.getNationalAuditByIdentity(req.params.identityUuid, limit);
    res.json(trail);
  });

  // === CROSS-FACILITY ACCESS REQUESTS ===

  app.post("/api/sovereign/zero-trust/cross-facility-access", requireAuth, requireRoleScope("NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"), async (req: any, res) => {
    const { targetFacilityCode, reasonCode, accessOrigin, entityRef } = req.body;
    if (!targetFacilityCode || !reasonCode) {
      return res.status(400).json({ message: "targetFacilityCode and reasonCode are required" });
    }

    const staffMember = req.staffMember || req.user;
    await storage.createNationalAuditEntry({
      identityUuid: `staff:${staffMember.id}`,
      actionType: "CROSS_FACILITY_ACCESS_REQUEST",
      entityRef: entityRef || targetFacilityCode,
      facilityScope: targetFacilityCode,
      reasonCode,
      accessOrigin: accessOrigin || req.ip,
      reviewFlag: true,
      metadata: {
        requestedBy: staffMember.username,
        role: staffMember.role,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(201).json({ message: "Cross-facility access request logged", reviewFlag: true });
  });

  // === CLINICAL INTELLIGENCE LAYER ===

  app.get("/api/sovereign/intelligence/metrics", requireAuth, requireRoleScope("LAB_ADMIN", "NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"), async (req: any, res) => {
    const { facilityCode, testCode, limit } = req.query;
    const maxResults = Math.min(parseInt(limit as string) || 100, 500);
    if (facilityCode) {
      const metrics = await storage.getAnonymizedMetricsByFacility(facilityCode as string, maxResults);
      return res.json(metrics);
    }
    if (testCode) {
      const metrics = await storage.getAnonymizedMetricsByTestCode(testCode as string, maxResults);
      return res.json(metrics);
    }
    const metrics = await storage.getRecentAnonymizedMetrics(maxResults);
    res.json(metrics);
  });

  app.get("/api/sovereign/intelligence/alerts", requireAuth, requireRoleScope("LAB_ADMIN", "NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"), async (req: any, res) => {
    const { alertType, limit } = req.query;
    const maxResults = Math.min(parseInt(limit as string) || 100, 500);
    const alerts = await storage.getIntelligenceAlerts(alertType as string | undefined, maxResults);
    res.json(alerts);
  });

  app.post("/api/sovereign/intelligence/alerts/:id/acknowledge", requireAuth, requireRoleScope("LAB_ADMIN", "NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"), async (req: any, res) => {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return res.status(400).json({ message: "Invalid alert ID" });
    const staffMember = req.staffMember || req.user;
    const updated = await storage.acknowledgeIntelligenceAlert(alertId, staffMember.id);
    if (!updated) return res.status(404).json({ message: "Alert not found" });
    res.json(updated);
  });

  app.get("/api/sovereign/intelligence/events/stats", requireAuth, requireRoleScope("LAB_ADMIN", "NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"), async (_req: any, res) => {
    const stats = await storage.getIntelligenceEventStats();
    res.json(stats);
  });

  app.get("/api/sovereign/intelligence/worker-status", requireAuth, requireRoleScope("LAB_ADMIN", "NATIONAL_CLINICAL_SUPERVISOR", "MINISTRY_AUDITOR"), async (_req: any, res) => {
    const status = getIntelligenceWorkerStatus();
    res.json(status);
  });

  // === START WORKERS & EVENT SUBSCRIPTIONS ===

  startEventWorker();
  setupGovernanceEventSubscriptions();
  startGovernanceWorker();
  setupArchiveEventSubscription();
  startArchiveWorker();
  startAnalyzerWorker();
  startOfflineSyncWorker();
  startTokenCleanup();
  startIntelligenceWorker();
}
