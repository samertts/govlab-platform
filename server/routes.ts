import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { type Staff } from "@shared/schema";
import { registerSovereignRoutes } from "./sovereignRoutes";
import { attachTenantScope, getTenantLabFilter, enforceTenantOwnership, stampTenantLabId } from "./tenantScope";
import { blockWriteForOversightRoles } from "./oversightGuard";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // === REPLIT AUTH SETUP ===
  await setupAuth(app);
  registerAuthRoutes(app);

  // === SOVEREIGN PILOT ROUTES ===
  registerSovereignRoutes(app);

  // Middleware: use Replit Auth token refresh, then resolve to staff record + tenant scope
  const requireAuth = (req: any, res: any, next: any) => {
    isAuthenticated(req, res, async (err?: any) => {
      if (err) return next(err);

      const claims = req.user?.claims;
      if (!claims?.sub) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const name = [claims.first_name, claims.last_name].filter(Boolean).join(" ") || claims.email || "User";
      const staffMember = await storage.findOrCreateStaffByReplitUser(claims.sub, name);
      req.staffMember = staffMember;
      attachTenantScope(req, res, next);
    });
  };

  // Patients
  app.get(api.patients.list.path, requireAuth, async (req: any, res) => {
    const labFilter = getTenantLabFilter(req.tenantScope);
    const patients = await storage.getPatients(req.query.search as string, labFilter);
    res.json(patients);
  });

  app.get(api.patients.get.path, requireAuth, async (req: any, res) => {
    const patient = await storage.getPatient(Number(req.params.id));
    if (!patient) return res.status(404).json({ message: "Patient not found" });
    if (!enforceTenantOwnership(req.tenantScope, patient.labId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    res.json(patient);
  });

  app.post(api.patients.create.path, requireAuth, blockWriteForOversightRoles, async (req: any, res) => {
    try {
      const input = stampTenantLabId(req.tenantScope, api.patients.create.input.parse(req.body));
      const patient = await storage.createPatient(input);
      res.status(201).json(patient);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.patients.update.path, requireAuth, blockWriteForOversightRoles, async (req, res) => {
    try {
      const input = api.patients.update.input.parse(req.body);
      const patient = await storage.updatePatient(Number(req.params.id), input);
      if (!patient) return res.status(404).json({ message: "Patient not found" });
      res.json(patient);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Test Types
  app.get(api.testTypes.list.path, requireAuth, async (req, res) => {
    const tests = await storage.getTestTypes();
    res.json(tests);
  });

  app.post(api.testTypes.create.path, requireAuth, blockWriteForOversightRoles, async (req, res) => {
    try {
      const input = api.testTypes.create.input.parse(req.body);
      const test = await storage.createTestType(input);
      res.status(201).json(test);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Samples
  app.get(api.samples.list.path, requireAuth, async (req: any, res) => {
    const status = req.query.status as string;
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    const labFilter = getTenantLabFilter(req.tenantScope);
    const samples = await storage.getSamples(status, patientId, labFilter);
    res.json(samples);
  });

  app.get(api.samples.get.path, requireAuth, async (req: any, res) => {
    const sample = await storage.getSample(Number(req.params.id));
    if (!sample) return res.status(404).json({ message: "Sample not found" });
    if (!enforceTenantOwnership(req.tenantScope, sample.labId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    res.json(sample);
  });

  app.post(api.samples.create.path, requireAuth, blockWriteForOversightRoles, async (req: any, res) => {
    try {
      const input = stampTenantLabId(req.tenantScope, api.samples.create.input.parse(req.body));
      const sample = await storage.createSample(input);
      
      for (const testTypeId of input.testTypeIds) {
        await storage.createTestResult({
          sampleId: sample.id,
          testTypeId,
          status: "pending"
        });
      }

      res.status(201).json(sample);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch(api.samples.updateStatus.path, requireAuth, blockWriteForOversightRoles, async (req, res) => {
    const sample = await storage.updateSampleStatus(Number(req.params.id), req.body.status);
    if (!sample) return res.status(404).json({ message: "Sample not found" });
    res.json(sample);
  });

  // Results
  app.get(api.results.listAuditLogs.path, requireAuth, async (req, res) => {
    const logs = await storage.getAuditLogsByResult(Number(req.params.id));
    res.json(logs);
  });

  app.patch(api.results.update.path, requireAuth, blockWriteForOversightRoles, async (req: any, res) => {
    try {
      const input = api.results.update.input.parse(req.body);
      const staffMember: Staff = req.staffMember;
      const oldResult = await storage.getTestResult(Number(req.params.id));
      const result = await storage.updateTestResult(Number(req.params.id), input.resultValue, input.notes);
      
      if (result && staffMember) {
        await storage.createAuditLog({
          userId: staffMember.id,
          testResultId: result.id,
          oldValue: oldResult?.resultValue || null,
          newValue: result.resultValue,
          action: "edit"
        });

        const sample = await storage.getSample(result.sampleId);
        if (sample && sample.status === "collected") {
          await storage.updateSampleStatus(result.sampleId, "processing");
        }
      }

      if (!result) return res.status(404).json({ message: "Result not found" });
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post(api.results.verify.path, requireAuth, blockWriteForOversightRoles, async (req: any, res) => {
    const staffMember: Staff = req.staffMember;
    if (!staffMember) return res.sendStatus(401);
    
    const oldResult = await storage.getTestResult(Number(req.params.id));
    const result = await storage.verifyTestResult(Number(req.params.id), staffMember.id);
    
    if (result) {
      await storage.createAuditLog({
        userId: staffMember.id,
        testResultId: result.id,
        oldValue: oldResult?.status || null,
        newValue: result.status,
        action: "verify"
      });
    }

    if (!result) return res.status(404).json({ message: "Result not found" });
    res.json(result);
  });

  // Staff info endpoint
  app.get("/api/staff/me", requireAuth, async (req: any, res) => {
    res.json(req.staffMember);
  });

  // Seed Data
  async function seed() {
    const existingStaff = await storage.getStaffByUsername("admin");
    if (!existingStaff) {
      await storage.createStaffMember({
        username: "admin",
        role: "admin",
        name: "Admin User"
      });
      await storage.createStaffMember({
        username: "tech",
        role: "technician",
        name: "Lab Tech"
      });
      await storage.createStaffMember({
        username: "doc",
        role: "pathologist",
        name: "Dr. Smith"
      });

      await storage.createTestType({ code: "CBC", name: "Complete Blood Count", price: 1500, units: "various", turnaroundTime: 24 });
      await storage.createTestType({ code: "BMP", name: "Basic Metabolic Panel", price: 1200, units: "various", turnaroundTime: 24 });
      await storage.createTestType({ code: "GLU", name: "Glucose", price: 500, units: "mg/dL", turnaroundTime: 2, referenceRange: "70-99" });
      await storage.createTestType({ code: "TSH", name: "Thyroid Stimulating Hormone", price: 2500, units: "mIU/L", turnaroundTime: 48, referenceRange: "0.4-4.0" });

      const patient = await storage.createPatient({
        mrn: "P10001",
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: new Date("1980-01-01"),
        gender: "Male",
        contactNumber: "555-0123",
        address: "123 Main St"
      });

      const sample = await storage.createSample({
        patientId: patient.id,
        status: "collected",
        priority: "routine",
        notes: "Routine checkup"
      });
      
      const tests = await storage.getTestTypes();
      const cbc = tests.find(t => t.code === "CBC");
      if (cbc) {
        await storage.createTestResult({
            sampleId: sample.id,
            testTypeId: cbc.id,
            status: "pending"
        });
      }
    }
  }

  seed();

  return httpServer;
}
