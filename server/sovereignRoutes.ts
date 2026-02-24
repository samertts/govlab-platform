import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { eventBus, EventTypes } from "./eventBus";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { isAuthenticated } from "./replit_integrations/auth";
import type { Staff } from "@shared/schema";

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
    next();
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
  next();
};

export function registerSovereignRoutes(app: Express): void {

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
        expiresAt: z.string().datetime().optional().nullable(),
      }).parse(req.body);

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);

      const token = await storage.createApiToken({
        name: input.name,
        tokenHash,
        scope: input.scope || "analyzer",
        facilityId: input.facilityId || null,
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
    const labId = req.staffMember?.role === "ministry_auditor" ? undefined : (req.staffMember?.labId ?? undefined);
    const allSamples = await storage.getSamples(undefined, undefined, labId);
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
}
