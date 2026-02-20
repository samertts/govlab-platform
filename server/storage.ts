import { db } from "./db";
import {
  staff, patients, testTypes, samples, testResults, auditLogs,
  type Staff, type InsertStaff,
  type Patient, type InsertPatient, type UpdatePatientRequest,
  type TestType, type InsertTestType,
  type Sample, type InsertSample, type UpdateSampleRequest,
  type TestResult, type InsertTestResult,
  type SampleWithPatient, type AuditLog, type InsertAuditLog
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  // Staff
  getStaffMember(id: number): Promise<Staff | undefined>;
  getStaffByUsername(username: string): Promise<Staff | undefined>;
  getStaffByReplitUserId(replitUserId: string): Promise<Staff | undefined>;
  createStaffMember(member: InsertStaff): Promise<Staff>;
  findOrCreateStaffByReplitUser(replitUserId: string, name: string): Promise<Staff>;

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
  getTestResult(id: number): Promise<TestResult | undefined>;
  getTestResultsBySample(sampleId: number): Promise<(TestResult & { testType: TestType })[]>;
  createTestResult(result: InsertTestResult): Promise<TestResult>;
  updateTestResult(id: number, resultValue: string, notes?: string): Promise<TestResult | undefined>;
  verifyTestResult(id: number, verifiedBy: number): Promise<TestResult | undefined>;

  // Audit Logs
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogsByResult(testResultId: number): Promise<(AuditLog & { staffMember: Staff })[]>;
}

export class DatabaseStorage implements IStorage {
  // Staff
  async getStaffMember(id: number): Promise<Staff | undefined> {
    const [member] = await db.select().from(staff).where(eq(staff.id, id));
    return member;
  }

  async getStaffByUsername(username: string): Promise<Staff | undefined> {
    const [member] = await db.select().from(staff).where(eq(staff.username, username));
    return member;
  }

  async getStaffByReplitUserId(replitUserId: string): Promise<Staff | undefined> {
    const [member] = await db.select().from(staff).where(eq(staff.replitUserId, replitUserId));
    return member;
  }

  async createStaffMember(member: InsertStaff): Promise<Staff> {
    const [newMember] = await db.insert(staff).values(member).returning();
    return newMember;
  }

  async findOrCreateStaffByReplitUser(replitUserId: string, name: string): Promise<Staff> {
    const existing = await this.getStaffByReplitUserId(replitUserId);
    if (existing) {
      if (existing.name !== name) {
        const [updated] = await db.update(staff).set({ name }).where(eq(staff.id, existing.id)).returning();
        return updated;
      }
      return existing;
    }

    const username = `replit_${replitUserId.slice(0, 8)}`;
    return this.createStaffMember({
      replitUserId,
      username,
      name,
      role: "technician",
    });
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
    const rows = await db.select({
      sample: samples,
      patient: patients
    })
    .from(samples)
    .innerJoin(patients, eq(samples.patientId, patients.id))
    .where(
      and(
        status ? eq(samples.status, status) : undefined,
        patientId ? eq(samples.patientId, patientId) : undefined
      )
    )
    .orderBy(desc(samples.createdAt));
    
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
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const accessionNumber = `${dateStr}-${randomSuffix}`;
    const barcode = `LAB-${accessionNumber}`;
    
    const [newSample] = await db.insert(samples).values({ 
      ...sample, 
      accessionNumber, 
      barcode,
      analyzerType: sample.analyzerType || null
    }).returning();
    return newSample;
  }

  async updateSampleStatus(id: number, status: string): Promise<Sample | undefined> {
    const [updated] = await db.update(samples).set({ status }).where(eq(samples.id, id)).returning();
    return updated;
  }

  // Results
  async getTestResult(id: number): Promise<TestResult | undefined> {
    const [result] = await db.select().from(testResults).where(eq(testResults.id, id));
    return result;
  }

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
    let qcFlag: string | null = null;
    const val = parseFloat(resultValue);
    if (!isNaN(val)) {
      if (val > 100) qcFlag = "High";
      else if (val < 10) qcFlag = "Low";
      if (val > 500 || val < 2) qcFlag = "Critical";
    }

    const [updated] = await db.update(testResults)
      .set({ 
        resultValue, 
        notes, 
        qcFlag,
        status: "entered", 
        performedAt: new Date() 
      })
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

  // Audit Logs
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [newLog] = await db.insert(auditLogs).values(log).returning();
    return newLog;
  }

  async getAuditLogsByResult(testResultId: number): Promise<(AuditLog & { staffMember: Staff })[]> {
    const rows = await db.select({
      log: auditLogs,
      staffMember: staff
    })
    .from(auditLogs)
    .innerJoin(staff, eq(auditLogs.userId, staff.id))
    .where(eq(auditLogs.testResultId, testResultId))
    .orderBy(desc(auditLogs.timestamp));

    return rows.map(r => ({ ...r.log, staffMember: r.staffMember }));
  }
}

export const storage = new DatabaseStorage();
