import { db } from "./db";
import {
  users, patients, testTypes, samples, testResults,
  type User, type InsertUser,
  type Patient, type InsertPatient, type UpdatePatientRequest,
  type TestType, type InsertTestType,
  type Sample, type InsertSample, type UpdateSampleRequest,
  type TestResult, type InsertTestResult,
  type SampleWithPatient
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Patients
  getPatients(search?: string): Promise<Patient[]>;
  getPatient(id: number): Promise<Patient | undefined>;
  createPatient(patient: InsertPatient): Promise<Patient>;
  updatePatient(id: number, patient: UpdatePatientRequest): Promise<Patient | undefined>;

  // Test Types
  getTestTypes(): Promise<TestType[]>;
  createTestType(testType: InsertTestType): Promise<TestType>;

  // Samples
  getSamples(status?: string, patientId?: number): Promise<SampleWithPatient[]>;
  getSample(id: number): Promise<SampleWithPatient | undefined>;
  createSample(sample: InsertSample): Promise<Sample>;
  updateSampleStatus(id: number, status: string): Promise<Sample | undefined>;

  // Results
  getTestResultsBySample(sampleId: number): Promise<(TestResult & { testType: TestType })[]>;
  createTestResult(result: InsertTestResult): Promise<TestResult>;
  updateTestResult(id: number, resultValue: string, notes?: string): Promise<TestResult | undefined>;
  verifyTestResult(id: number, verifiedBy: number): Promise<TestResult | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  // Patients
  async getPatients(search?: string): Promise<Patient[]> {
    if (search) {
      const lowerSearch = search.toLowerCase();
      return await db.select().from(patients).where(
        sql`lower(${patients.firstName}) like ${`%${lowerSearch}%`} OR lower(${patients.lastName}) like ${`%${lowerSearch}%`} OR ${patients.mrn} like ${`%${lowerSearch}%`}`
      );
    }
    return await db.select().from(patients).orderBy(desc(patients.createdAt));
  }

  async getPatient(id: number): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.id, id));
    return patient;
  }

  async createPatient(patient: InsertPatient): Promise<Patient> {
    const [newPatient] = await db.insert(patients).values(patient).returning();
    return newPatient;
  }

  async updatePatient(id: number, patient: UpdatePatientRequest): Promise<Patient | undefined> {
    const [updated] = await db.update(patients).set(patient).where(eq(patients.id, id)).returning();
    return updated;
  }

  // Test Types
  async getTestTypes(): Promise<TestType[]> {
    return await db.select().from(testTypes).where(eq(testTypes.isActive, true));
  }

  async createTestType(testType: InsertTestType): Promise<TestType> {
    const [newTestType] = await db.insert(testTypes).values(testType).returning();
    return newTestType;
  }

  // Samples
  async getSamples(status?: string, patientId?: number): Promise<SampleWithPatient[]> {
    let query = db.select({
      sample: samples,
      patient: patients
    })
    .from(samples)
    .innerJoin(patients, eq(samples.patientId, patients.id));

    if (status) {
      query = query.where(eq(samples.status, status));
    }
    
    if (patientId) {
      query = query.where(eq(samples.patientId, patientId));
    }

    const rows = await query.orderBy(desc(samples.createdAt));
    
    // Fetch results for each sample to populate the full response
    const result = await Promise.all(rows.map(async (row) => {
      const results = await this.getTestResultsBySample(row.sample.id);
      return {
        ...row.sample,
        patient: row.patient,
        results
      };
    }));

    return result;
  }

  async getSample(id: number): Promise<SampleWithPatient | undefined> {
    const [row] = await db.select({
      sample: samples,
      patient: patients
    })
    .from(samples)
    .innerJoin(patients, eq(samples.patientId, patients.id))
    .where(eq(samples.id, id));

    if (!row) return undefined;

    const results = await this.getTestResultsBySample(id);
    return {
      ...row.sample,
      patient: row.patient,
      results
    };
  }

  async createSample(sample: InsertSample): Promise<Sample> {
    // Generate Accession Number: YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    // Simple random suffix for demo purposes, robust systems use sequences
    const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const accessionNumber = `${dateStr}-${randomSuffix}`;
    
    const [newSample] = await db.insert(samples).values({ ...sample, accessionNumber }).returning();
    return newSample;
  }

  async updateSampleStatus(id: number, status: string): Promise<Sample | undefined> {
    const [updated] = await db.update(samples).set({ status }).where(eq(samples.id, id)).returning();
    return updated;
  }

  // Results
  async getTestResultsBySample(sampleId: number): Promise<(TestResult & { testType: TestType })[]> {
    const rows = await db.select({
      result: testResults,
      testType: testTypes
    })
    .from(testResults)
    .innerJoin(testTypes, eq(testResults.testTypeId, testTypes.id))
    .where(eq(testResults.sampleId, sampleId));

    return rows.map(r => ({ ...r.result, testType: r.testType }));
  }

  async createTestResult(result: InsertTestResult): Promise<TestResult> {
    const [newResult] = await db.insert(testResults).values(result).returning();
    return newResult;
  }

  async updateTestResult(id: number, resultValue: string, notes?: string): Promise<TestResult | undefined> {
    const [updated] = await db.update(testResults)
      .set({ resultValue, notes, status: "entered", performedAt: new Date() })
      .where(eq(testResults.id, id))
      .returning();
    return updated;
  }

  async verifyTestResult(id: number, verifiedBy: number): Promise<TestResult | undefined> {
    const [updated] = await db.update(testResults)
      .set({ status: "verified", verifiedBy, verifiedAt: new Date() })
      .where(eq(testResults.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
