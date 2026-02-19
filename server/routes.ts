import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { testTypes, patients, users, type User } from "@shared/schema";
import createMemoryStore from "memorystore";

const scryptAsync = promisify(scrypt);
const MemoryStore = createMemoryStore(session);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // === AUTH SETUP ===
  app.use(session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 },
    store: new MemoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    }),
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      const user = await storage.getUserByUsername(username);
      if (!user) return done(null, false);

      const [salt, key] = user.password.split(":");
      const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;

      if (timingSafeEqual(Buffer.from(key, "hex"), derivedKey)) {
        return done(null, user);
      }
      return done(null, false);
    } catch (err) {
      return done(err);
    }
  }));

  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  // Helper to hash passwords
  async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString("hex")}`;
  }

  // === ROUTES ===

  // Auth Routes
  app.post(api.auth.login.path, passport.authenticate("local"), (req, res) => {
    res.json(req.user);
  });

  app.post(api.auth.logout.path, (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (req.isAuthenticated()) {
      res.json(req.user);
    } else {
      res.json(null);
    }
  });

  // Middleware to check auth
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: "Unauthorized" });
  };

  // Patients
  app.get(api.patients.list.path, requireAuth, async (req, res) => {
    const patients = await storage.getPatients(req.query.search as string);
    res.json(patients);
  });

  app.get(api.patients.get.path, requireAuth, async (req, res) => {
    const patient = await storage.getPatient(Number(req.params.id));
    if (!patient) return res.status(404).json({ message: "Patient not found" });
    res.json(patient);
  });

  app.post(api.patients.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.patients.create.input.parse(req.body);
      const patient = await storage.createPatient(input);
      res.status(201).json(patient);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.patients.update.path, requireAuth, async (req, res) => {
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

  app.post(api.testTypes.create.path, requireAuth, async (req, res) => {
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
  app.get(api.samples.list.path, requireAuth, async (req, res) => {
    const status = req.query.status as string;
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    const samples = await storage.getSamples(status, patientId);
    res.json(samples);
  });

  app.get(api.samples.get.path, requireAuth, async (req, res) => {
    const sample = await storage.getSample(Number(req.params.id));
    if (!sample) return res.status(404).json({ message: "Sample not found" });
    res.json(sample);
  });

  app.post(api.samples.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.samples.create.input.parse(req.body);
      
      // 1. Create Sample
      const sample = await storage.createSample(input);
      
      // 2. Create Test Results (placeholders)
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

  app.patch(api.samples.updateStatus.path, requireAuth, async (req, res) => {
    const sample = await storage.updateSampleStatus(Number(req.params.id), req.body.status);
    if (!sample) return res.status(404).json({ message: "Sample not found" });
    res.json(sample);
  });

  // Results
  app.get(api.results.listAuditLogs.path, requireAuth, async (req, res) => {
    const logs = await storage.getAuditLogsByResult(Number(req.params.id));
    res.json(logs);
  });

  app.patch(api.results.update.path, requireAuth, async (req, res) => {
    try {
      const input = api.results.update.input.parse(req.body);
      const oldResult = await storage.getTestResult(Number(req.params.id));
      const result = await storage.updateTestResult(Number(req.params.id), input.resultValue, input.notes);
      
      if (result && req.user) {
        await storage.createAuditLog({
          userId: (req.user as User).id,
          testResultId: result.id,
          oldValue: oldResult?.resultValue || null,
          newValue: result.resultValue,
          action: "edit"
        });

        // Auto-update sample status to 'processing' if it was 'collected'
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

  app.post(api.results.verify.path, requireAuth, async (req, res) => {
    // In a real app, check if user is pathologist/admin
    if (!req.user) return res.sendStatus(401);
    
    const oldResult = await storage.getTestResult(Number(req.params.id));
    const result = await storage.verifyTestResult(Number(req.params.id), (req.user as User).id);
    
    if (result) {
      await storage.createAuditLog({
        userId: (req.user as User).id,
        testResultId: result.id,
        oldValue: oldResult?.status || null,
        newValue: result.status,
        action: "verify"
      });
    }

    if (!result) return res.status(404).json({ message: "Result not found" });
    res.json(result);
  });

  // Seed Data
  async function seed() {
    const existingUsers = await storage.getUserByUsername("admin");
    if (!existingUsers) {
      const adminPassword = await hashPassword("admin123");
      const techPassword = await hashPassword("tech123");
      const docPassword = await hashPassword("doc123");

      await storage.createUser({
        username: "admin",
        password: adminPassword,
        role: "admin",
        name: "Admin User"
      });
      await storage.createUser({
        username: "tech",
        password: techPassword,
        role: "technician",
        name: "Lab Tech"
      });
      await storage.createUser({
        username: "doc",
        password: docPassword,
        role: "pathologist",
        name: "Dr. Smith"
      });

      // Seed Tests
      await storage.createTestType({ code: "CBC", name: "Complete Blood Count", price: 1500, units: "various", turnaroundTime: 24 });
      await storage.createTestType({ code: "BMP", name: "Basic Metabolic Panel", price: 1200, units: "various", turnaroundTime: 24 });
      await storage.createTestType({ code: "GLU", name: "Glucose", price: 500, units: "mg/dL", turnaroundTime: 2, referenceRange: "70-99" });
      await storage.createTestType({ code: "TSH", name: "Thyroid Stimulating Hormone", price: 2500, units: "mIU/L", turnaroundTime: 48, referenceRange: "0.4-4.0" });

      // Seed Patient
      const patient = await storage.createPatient({
        mrn: "P10001",
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: new Date("1980-01-01"),
        gender: "Male",
        contactNumber: "555-0123",
        address: "123 Main St"
      });

      // Seed Sample
      const sample = await storage.createSample({
        patientId: patient.id,
        status: "collected",
        priority: "routine",
        notes: "Routine checkup"
      });
      
      // Seed Results
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
