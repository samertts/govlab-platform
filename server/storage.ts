import { db } from "./db";
import {
  staff, patients, testTypes, samples, testResults, auditLogs,
  organizations, directorates, facilities, apiTokens, events, offlineQueue, invoices, invoiceItems,
  labs, nationalReports, policyEngine, nationalAccessAudit,
  type Staff, type InsertStaff,
  type Patient, type InsertPatient, type UpdatePatientRequest,
  type TestType, type InsertTestType,
  type Sample, type InsertSample,
  type TestResult, type InsertTestResult,
  type SampleWithPatient, type AuditLog, type InsertAuditLog,
  type Organization, type InsertOrganization,
  type Directorate, type InsertDirectorate, type DirectorateWithFacilities,
  type Facility, type InsertFacility,
  type Lab, type InsertLab,
  type NationalReport, type InsertNationalReport,
  type Policy, type InsertPolicy,
  type NationalAccessAuditEntry, type InsertNationalAccessAudit,
  type ApiToken, type InsertApiToken,
  type Event, type InsertEvent,
  type OfflineQueueItem, type InsertOfflineQueueItem,
  type Invoice, type InsertInvoice, type InvoiceWithItems,
  type InvoiceItem, type InsertInvoiceItem,
  type OrganizationWithHierarchy
} from "@shared/schema";
import { eq, desc, and, sql, isNull } from "drizzle-orm";
import { createHash } from "crypto";

function computeAuditHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const data = JSON.stringify({ prevHash, ...payload });
  return createHash("sha256").update(data).digest("hex");
}

export interface IStorage {
  // Staff
  getStaffMember(id: number): Promise<Staff | undefined>;
  getStaffByUsername(username: string): Promise<Staff | undefined>;
  getStaffByReplitUserId(replitUserId: string): Promise<Staff | undefined>;
  createStaffMember(member: InsertStaff): Promise<Staff>;
  findOrCreateStaffByReplitUser(replitUserId: string, name: string): Promise<Staff>;

  // Patients (labId = null means no filter; used for MINISTRY_AUDITOR)
  getPatients(search?: string, labId?: number | null): Promise<Patient[]>;
  getPatient(id: number): Promise<Patient | undefined>;
  createPatient(patient: InsertPatient): Promise<Patient>;
  updatePatient(id: number, patient: UpdatePatientRequest): Promise<Patient | undefined>;

  // Test Types
  getTestTypes(): Promise<TestType[]>;
  createTestType(testType: InsertTestType): Promise<TestType>;

  // Samples (labId filtering for multi-tenancy)
  getSamples(status?: string, patientId?: number, labId?: number | null): Promise<SampleWithPatient[]>;
  getSample(id: number): Promise<SampleWithPatient | undefined>;
  createSample(sample: InsertSample): Promise<Sample>;
  updateSampleStatus(id: number, status: string): Promise<Sample | undefined>;

  // Results
  getTestResult(id: number): Promise<TestResult | undefined>;
  getTestResultsBySample(sampleId: number): Promise<(TestResult & { testType: TestType })[]>;
  createTestResult(result: InsertTestResult): Promise<TestResult>;
  updateTestResult(id: number, resultValue: string, notes?: string): Promise<TestResult | undefined>;
  verifyTestResult(id: number, verifiedBy: number): Promise<TestResult | undefined>;

  // Audit Logs (immutable, hash-chained)
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogsByResult(testResultId: number): Promise<(AuditLog & { staffMember: Staff })[]>;

  // Labs (multi-tenant entities linked to organizations)
  getLabs(organizationId?: number): Promise<Lab[]>;
  getLab(id: number): Promise<Lab | undefined>;
  createLab(lab: InsertLab): Promise<Lab>;
  updateStaffLab(staffId: number, labId: number | null): Promise<Staff | undefined>;

  // Organizations hierarchy
  getOrganizations(): Promise<Organization[]>;
  getOrganization(id: number): Promise<OrganizationWithHierarchy | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  getDirectorates(orgId?: number): Promise<Directorate[]>;
  createDirectorate(dir: InsertDirectorate): Promise<Directorate>;
  getFacilities(directorateId?: number): Promise<Facility[]>;
  getFacility(id: number): Promise<Facility | undefined>;
  createFacility(fac: InsertFacility): Promise<Facility>;

  // API Tokens (identity tokens)
  createApiToken(token: InsertApiToken): Promise<ApiToken>;
  getApiTokenByHash(tokenHash: string): Promise<ApiToken | undefined>;
  deactivateApiToken(id: number): Promise<void>;
  updateTokenLastUsed(id: number): Promise<void>;

  // Events (unified event bus persistence)
  createEvent(event: InsertEvent): Promise<Event>;
  getEvents(entityType?: string, limit?: number): Promise<Event[]>;

  // Offline Queue
  enqueueOfflineOp(item: InsertOfflineQueueItem): Promise<OfflineQueueItem>;
  getPendingOfflineOps(staffId?: number): Promise<OfflineQueueItem[]>;
  markOfflineOpProcessed(id: number): Promise<void>;
  markOfflineOpFailed(id: number, errorMessage: string): Promise<void>;

  // Invoices / Pricing
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoice(id: number): Promise<InvoiceWithItems | undefined>;
  getInvoicesByPatient(patientId: number): Promise<Invoice[]>;
  addInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem>;
  updateInvoiceTotals(invoiceId: number): Promise<Invoice | undefined>;
  generateInvoiceForSample(sampleId: number, patientId: number, facilityId?: number | null): Promise<Invoice>;

  // National Reports (aggregated statistics)
  createNationalReport(report: InsertNationalReport): Promise<NationalReport>;
  getNationalReports(reportType?: string, labId?: number): Promise<NationalReport[]>;
  generateNationalSnapshot(generatedBy: number): Promise<NationalReport>;

  // Policy Engine (national clinical oversight)
  createPolicy(policy: InsertPolicy): Promise<Policy>;
  getPolicies(sector?: string, activeOnly?: boolean): Promise<Policy[]>;
  getPolicy(id: number): Promise<Policy | undefined>;
  updatePolicyActive(id: number, activeFlag: boolean): Promise<Policy | undefined>;
  evaluatePolicies(testCode: string, sector: string): Promise<Policy[]>;

  // National Access Audit (immutable)
  logNationalAccess(entry: InsertNationalAccessAudit): Promise<NationalAccessAuditEntry>;
  getNationalAccessAuditLog(userId?: number, patientId?: number): Promise<NationalAccessAuditEntry[]>;
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
  async getPatients(search?: string, labId?: number | null): Promise<Patient[]> {
    const conditions = [];
    if (search) {
      const lowerSearch = search.toLowerCase();
      conditions.push(
        sql`(lower(${patients.firstName}) like ${`%${lowerSearch}%`} OR lower(${patients.lastName}) like ${`%${lowerSearch}%`} OR ${patients.mrn} like ${`%${lowerSearch}%`})`
      );
    }
    if (labId !== undefined && labId !== null) {
      conditions.push(eq(patients.labId, labId));
    }
    if (conditions.length > 0) {
      return await db.select().from(patients).where(and(...conditions)).orderBy(desc(patients.createdAt));
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
  async getSamples(status?: string, patientId?: number, labId?: number | null): Promise<SampleWithPatient[]> {
    const conditions = [];
    if (status) conditions.push(eq(samples.status, status));
    if (patientId) conditions.push(eq(samples.patientId, patientId));
    if (labId !== undefined && labId !== null) conditions.push(eq(samples.labId, labId));

    const rows = await db.select({
      sample: samples,
      patient: patients
    })
    .from(samples)
    .innerJoin(patients, eq(samples.patientId, patients.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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

  // Audit Logs (immutable, hash-chained)
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [lastLog] = await db.select({ hash: auditLogs.hash })
      .from(auditLogs)
      .orderBy(desc(auditLogs.id))
      .limit(1);

    const prevHash = lastLog?.hash || null;
    const hash = computeAuditHash(prevHash, {
      userId: log.userId,
      action: log.action,
      oldValue: log.oldValue,
      newValue: log.newValue,
      testResultId: log.testResultId,
      entityType: log.entityType,
      entityId: log.entityId,
    });

    const [newLog] = await db.insert(auditLogs).values({
      ...log,
      prevHash,
      hash,
    }).returning();
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

  // === Labs ===

  async getLabs(organizationId?: number): Promise<Lab[]> {
    if (organizationId) {
      return await db.select().from(labs).where(eq(labs.organizationId, organizationId)).orderBy(labs.labName);
    }
    return await db.select().from(labs).orderBy(labs.labName);
  }

  async getLab(id: number): Promise<Lab | undefined> {
    const [lab] = await db.select().from(labs).where(eq(labs.id, id));
    return lab;
  }

  async createLab(lab: InsertLab): Promise<Lab> {
    const [newLab] = await db.insert(labs).values(lab).returning();
    return newLab;
  }

  async updateStaffLab(staffId: number, labId: number | null): Promise<Staff | undefined> {
    const [updated] = await db.update(staff).set({ labId }).where(eq(staff.id, staffId)).returning();
    return updated;
  }

  // === SOVEREIGN PILOT: Organization Hierarchy ===

  async getOrganizations(): Promise<Organization[]> {
    return await db.select().from(organizations).orderBy(organizations.name);
  }

  async getOrganization(id: number): Promise<OrganizationWithHierarchy | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    if (!org) return undefined;

    const dirs = await db.select().from(directorates).where(eq(directorates.organizationId, id));
    const dirsWithFacilities = await Promise.all(dirs.map(async (dir) => {
      const facs = await db.select().from(facilities).where(eq(facilities.directorateId, dir.id));
      return { ...dir, facilities: facs };
    }));

    return { ...org, directorates: dirsWithFacilities };
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const [newOrg] = await db.insert(organizations).values(org).returning();
    return newOrg;
  }

  async getDirectorates(orgId?: number): Promise<Directorate[]> {
    if (orgId) {
      return await db.select().from(directorates).where(eq(directorates.organizationId, orgId));
    }
    return await db.select().from(directorates).orderBy(directorates.name);
  }

  async createDirectorate(dir: InsertDirectorate): Promise<Directorate> {
    const [newDir] = await db.insert(directorates).values(dir).returning();
    return newDir;
  }

  async getFacilities(directorateId?: number): Promise<Facility[]> {
    if (directorateId) {
      return await db.select().from(facilities).where(eq(facilities.directorateId, directorateId));
    }
    return await db.select().from(facilities).orderBy(facilities.name);
  }

  async getFacility(id: number): Promise<Facility | undefined> {
    const [fac] = await db.select().from(facilities).where(eq(facilities.id, id));
    return fac;
  }

  async createFacility(fac: InsertFacility): Promise<Facility> {
    const [newFac] = await db.insert(facilities).values(fac).returning();
    return newFac;
  }

  // === SOVEREIGN PILOT: API Tokens ===

  async createApiToken(token: InsertApiToken): Promise<ApiToken> {
    const [newToken] = await db.insert(apiTokens).values(token).returning();
    return newToken;
  }

  async getApiTokenByHash(tokenHash: string): Promise<ApiToken | undefined> {
    const [token] = await db.select().from(apiTokens).where(
      and(eq(apiTokens.tokenHash, tokenHash), eq(apiTokens.isActive, true))
    );
    return token;
  }

  async deactivateApiToken(id: number): Promise<void> {
    await db.update(apiTokens).set({ isActive: false }).where(eq(apiTokens.id, id));
  }

  async updateTokenLastUsed(id: number): Promise<void> {
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, id));
  }

  // === SOVEREIGN PILOT: Events ===

  async createEvent(event: InsertEvent): Promise<Event> {
    const [newEvent] = await db.insert(events).values(event).returning();
    return newEvent;
  }

  async getEvents(entityType?: string, limit: number = 50): Promise<Event[]> {
    if (entityType) {
      return await db.select().from(events)
        .where(eq(events.entityType, entityType))
        .orderBy(desc(events.createdAt))
        .limit(limit);
    }
    return await db.select().from(events).orderBy(desc(events.createdAt)).limit(limit);
  }

  // === SOVEREIGN PILOT: Offline Queue ===

  async enqueueOfflineOp(item: InsertOfflineQueueItem): Promise<OfflineQueueItem> {
    const [newItem] = await db.insert(offlineQueue).values(item).returning();
    return newItem;
  }

  async getPendingOfflineOps(staffId?: number): Promise<OfflineQueueItem[]> {
    if (staffId) {
      return await db.select().from(offlineQueue)
        .where(and(eq(offlineQueue.status, "pending"), eq(offlineQueue.staffId, staffId)))
        .orderBy(offlineQueue.createdAt);
    }
    return await db.select().from(offlineQueue)
      .where(eq(offlineQueue.status, "pending"))
      .orderBy(offlineQueue.createdAt);
  }

  async markOfflineOpProcessed(id: number): Promise<void> {
    await db.update(offlineQueue)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(offlineQueue.id, id));
  }

  async markOfflineOpFailed(id: number, errorMessage: string): Promise<void> {
    await db.update(offlineQueue)
      .set({ 
        status: "failed", 
        errorMessage,
        retryCount: sql`${offlineQueue.retryCount} + 1`
      })
      .where(eq(offlineQueue.id, id));
  }

  // === SOVEREIGN PILOT: Invoices / Pricing ===

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();
    return newInvoice;
  }

  async getInvoice(id: number): Promise<InvoiceWithItems | undefined> {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!inv) return undefined;

    const [patient] = await db.select().from(patients).where(eq(patients.id, inv.patientId));

    const itemRows = await db.select({
      item: invoiceItems,
      testType: testTypes
    })
    .from(invoiceItems)
    .innerJoin(testTypes, eq(invoiceItems.testTypeId, testTypes.id))
    .where(eq(invoiceItems.invoiceId, id));

    return {
      ...inv,
      patient,
      items: itemRows.map(r => ({ ...r.item, testType: r.testType })),
    };
  }

  async getInvoicesByPatient(patientId: number): Promise<Invoice[]> {
    return await db.select().from(invoices)
      .where(eq(invoices.patientId, patientId))
      .orderBy(desc(invoices.createdAt));
  }

  async addInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
    const [newItem] = await db.insert(invoiceItems).values(item).returning();
    return newItem;
  }

  async updateInvoiceTotals(invoiceId: number): Promise<Invoice | undefined> {
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
    const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    const discount = inv?.discount || 0;
    const tax = inv?.tax || 0;
    const netAmount = totalAmount - discount + tax;

    const [updated] = await db.update(invoices)
      .set({ totalAmount, netAmount })
      .where(eq(invoices.id, invoiceId))
      .returning();
    return updated;
  }

  async generateInvoiceForSample(sampleId: number, patientId: number, facilityId?: number | null): Promise<Invoice> {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;

    const invoice = await this.createInvoice({
      patientId,
      facilityId: facilityId || null,
      invoiceNumber,
      totalAmount: 0,
      netAmount: 0,
      status: "draft",
    });

    const results = await this.getTestResultsBySample(sampleId);
    for (const result of results) {
      await this.addInvoiceItem({
        invoiceId: invoice.id,
        testResultId: result.id,
        testTypeId: result.testType.id,
        description: result.testType.name,
        unitPrice: result.testType.price,
        quantity: 1,
        lineTotal: result.testType.price,
      });
    }

    const updated = await this.updateInvoiceTotals(invoice.id);
    return updated || invoice;
  }

  // === National Reports ===

  async createNationalReport(report: InsertNationalReport): Promise<NationalReport> {
    const [newReport] = await db.insert(nationalReports).values(report).returning();
    return newReport;
  }

  async getNationalReports(reportType?: string, labId?: number): Promise<NationalReport[]> {
    const conditions = [];
    if (reportType) conditions.push(eq(nationalReports.reportType, reportType));
    if (labId) conditions.push(eq(nationalReports.labId, labId));
    return await db.select().from(nationalReports)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(nationalReports.createdAt));
  }

  async generateNationalSnapshot(generatedBy: number): Promise<NationalReport> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = now;

    const [totalPatients] = await db.select({ count: sql<number>`count(*)::int` }).from(patients);
    const [totalSamples] = await db.select({ count: sql<number>`count(*)::int` }).from(samples);
    const [pendingSamples] = await db.select({ count: sql<number>`count(*)::int` }).from(samples).where(eq(samples.status, "collected"));
    const [processingSamples] = await db.select({ count: sql<number>`count(*)::int` }).from(samples).where(eq(samples.status, "processing"));
    const [completedSamples] = await db.select({ count: sql<number>`count(*)::int` }).from(samples).where(eq(samples.status, "completed"));
    const [totalResults] = await db.select({ count: sql<number>`count(*)::int` }).from(testResults);
    const [verifiedResults] = await db.select({ count: sql<number>`count(*)::int` }).from(testResults).where(eq(testResults.status, "verified"));
    const [totalLabs] = await db.select({ count: sql<number>`count(*)::int` }).from(labs);
    const [totalOrgs] = await db.select({ count: sql<number>`count(*)::int` }).from(organizations);

    const labBreakdown = await db.select({
      labId: samples.labId,
      count: sql<number>`count(*)::int`,
    }).from(samples)
      .groupBy(samples.labId);

    const metrics = {
      totalPatients: totalPatients.count,
      totalSamples: totalSamples.count,
      pendingSamples: pendingSamples.count,
      processingSamples: processingSamples.count,
      completedSamples: completedSamples.count,
      totalResults: totalResults.count,
      verifiedResults: verifiedResults.count,
      totalLabs: totalLabs.count,
      totalOrganizations: totalOrgs.count,
      labBreakdown,
    };

    return await this.createNationalReport({
      reportType: "national_snapshot",
      periodStart,
      periodEnd,
      metrics,
      generatedBy,
    });
  }

  // === Policy Engine ===

  async createPolicy(policy: InsertPolicy): Promise<Policy> {
    const [newPolicy] = await db.insert(policyEngine).values(policy).returning();
    return newPolicy;
  }

  async getPolicies(sector?: string, activeOnly?: boolean): Promise<Policy[]> {
    const conditions = [];
    if (sector) conditions.push(eq(policyEngine.sector, sector));
    if (activeOnly) conditions.push(eq(policyEngine.activeFlag, true));
    return await db.select().from(policyEngine)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(policyEngine.createdAt));
  }

  async getPolicy(id: number): Promise<Policy | undefined> {
    const [policy] = await db.select().from(policyEngine).where(eq(policyEngine.id, id));
    return policy;
  }

  async updatePolicyActive(id: number, activeFlag: boolean): Promise<Policy | undefined> {
    const [updated] = await db.update(policyEngine)
      .set({ activeFlag })
      .where(eq(policyEngine.id, id))
      .returning();
    return updated;
  }

  async evaluatePolicies(testCode: string, sector: string): Promise<Policy[]> {
    return await db.select().from(policyEngine)
      .where(and(
        eq(policyEngine.activeFlag, true),
        eq(policyEngine.sector, sector),
        sql`(${policyEngine.testCode} = ${testCode} OR ${policyEngine.testCode} IS NULL)`
      ));
  }

  // === National Access Audit ===

  async logNationalAccess(entry: InsertNationalAccessAudit): Promise<NationalAccessAuditEntry> {
    const [record] = await db.insert(nationalAccessAudit).values(entry).returning();
    return record;
  }

  async getNationalAccessAuditLog(userId?: number, patientId?: number): Promise<NationalAccessAuditEntry[]> {
    const conditions = [];
    if (userId) conditions.push(eq(nationalAccessAudit.userId, userId));
    if (patientId) conditions.push(eq(nationalAccessAudit.patientId, patientId));
    return await db.select().from(nationalAccessAudit)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(nationalAccessAudit.accessedAt));
  }
}

export const storage = new DatabaseStorage();
