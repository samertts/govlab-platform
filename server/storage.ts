import { db } from "./db";
import {
  staff, patients, testTypes, samples, testResults, auditLogs,
  organizations, directorates, facilities, apiTokens, events, offlineQueue, invoices, invoiceItems,
  labs, nationalReports, policyEngine, nationalAccessAudit, identityVerifications,
  testPolicies, governanceEvents,
  clinicalPathways, pathwayRules, clinicalPathwayEvents,
  worklistView, nationalMetricsView, suggestionStreamView,
  unifiedSuggestionStream, notificationTemplates, notificationEvents, deliveryLogs, notifications, securityEvents,
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
  type IdentityVerification, type InsertIdentityVerification,
  type TestPolicy, type InsertTestPolicy,
  type GovernanceEvent, type InsertGovernanceEvent,
  type ClinicalPathway, type InsertClinicalPathway,
  type PathwayRule, type InsertPathwayRule,
  type ClinicalPathwayEvent, type InsertClinicalPathwayEvent,
  type ApiToken, type InsertApiToken,
  type Event, type InsertEvent,
  type OfflineQueueItem, type InsertOfflineQueueItem,
  type Invoice, type InsertInvoice, type InvoiceWithItems,
  type InvoiceItem, type InsertInvoiceItem,
  type OrganizationWithHierarchy,
  type WorklistViewEntry, type InsertWorklistView,
  type NationalMetricsViewEntry, type InsertNationalMetricsView,
  type SuggestionStreamViewEntry, type InsertSuggestionStreamView,
  type UnifiedSuggestion, type InsertUnifiedSuggestion,
  type NotificationTemplate, type InsertNotificationTemplate,
  type NotificationEvent, type InsertNotificationEvent,
  type DeliveryLog, type InsertDeliveryLog,
  type Notification, type InsertNotification,
  type SecurityEvent, type InsertSecurityEvent,
  governanceJobs,
  type GovernanceJob, type InsertGovernanceJob,
  resultsHot, resultsArchive, patientHistorySummary,
  type ResultHot, type InsertResultHot,
  type ResultArchive, type InsertResultArchive,
  type PatientHistorySummaryEntry, type InsertPatientHistorySummary,
  analyzers, analyzerEventQueue,
  type Analyzer, type InsertAnalyzer,
  type AnalyzerEventQueueEntry, type InsertAnalyzerEventQueue,
  localSyncEvents, syncConflictPolicy, conflictAuditLog, facilityConnectivityStatus,
  type LocalSyncEvent, type InsertLocalSyncEvent,
  type SyncConflictPolicyEntry, type InsertSyncConflictPolicy,
  type ConflictAuditLogEntry, type InsertConflictAuditLog,
  type FacilityConnectivityStatusEntry, type InsertFacilityConnectivityStatus,
  zeroTrustIdentities, securityQuarantineQueue, nationalAuditTrail,
  type ZeroTrustIdentity, type InsertZeroTrustIdentity,
  type SecurityQuarantineEntry, type InsertSecurityQuarantine,
  type NationalAuditTrailEntry, type InsertNationalAuditTrail,
  intelligenceEvents, anonymizedMetrics, intelligenceAlerts,
  type IntelligenceEvent, type InsertIntelligenceEvent,
  type AnonymizedMetric, type InsertAnonymizedMetric,
  type IntelligenceAlert, type InsertIntelligenceAlert,
  nationalTests, nationalAnalyzers, nationalRoles, nationalFacilities,
  type NationalTest, type InsertNationalTest,
  type NationalAnalyzer, type InsertNationalAnalyzer,
  type NationalRole, type InsertNationalRole,
  type NationalFacility, type InsertNationalFacility,
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

  // Identity Verification (sovereign identity)
  createIdentityVerification(verification: InsertIdentityVerification): Promise<IdentityVerification>;
  updateIdentityVerificationStatus(id: number, status: string, verifiedAt?: Date): Promise<IdentityVerification | undefined>;
  getIdentityVerificationsByPatient(patientId: number): Promise<IdentityVerification[]>;
  getIdentityVerification(id: number): Promise<IdentityVerification | undefined>;
  getLatestVerificationByPatient(patientId: number): Promise<IdentityVerification | undefined>;

  // Clinical Governance Engine — Test Policies
  createTestPolicy(policy: InsertTestPolicy): Promise<TestPolicy>;
  getTestPolicies(sector?: string, activeOnly?: boolean): Promise<TestPolicy[]>;
  getTestPolicy(id: number): Promise<TestPolicy | undefined>;
  updateTestPolicyActive(id: number, activeFlag: boolean): Promise<TestPolicy | undefined>;
  evaluateTestPolicies(testCode: string, sector: string): Promise<TestPolicy[]>;
  getRecentTestResultsByCode(testCode: string, patientId: number, withinDays: number): Promise<TestResult[]>;

  // Clinical Governance Engine — Governance Events
  createGovernanceEvent(event: InsertGovernanceEvent): Promise<GovernanceEvent>;
  getGovernanceEvents(specimenId?: number, testCode?: string, limit?: number): Promise<GovernanceEvent[]>;

  // Clinical Pathways Engine — Pathway Definitions
  createClinicalPathway(pathway: InsertClinicalPathway): Promise<ClinicalPathway>;
  getClinicalPathways(sector?: string, activeOnly?: boolean): Promise<ClinicalPathway[]>;
  getClinicalPathway(id: number): Promise<ClinicalPathway | undefined>;
  updateClinicalPathwayActive(id: number, activeFlag: boolean): Promise<ClinicalPathway | undefined>;
  getPathwaysByTriggerTest(triggerTest: string, sector?: string): Promise<ClinicalPathway[]>;

  // Clinical Pathways Engine — Pathway Rules
  createPathwayRule(rule: InsertPathwayRule): Promise<PathwayRule>;
  getPathwayRules(activeOnly?: boolean): Promise<PathwayRule[]>;
  getPathwayRule(id: number): Promise<PathwayRule | undefined>;
  updatePathwayRuleActive(id: number, activeFlag: boolean): Promise<PathwayRule | undefined>;
  getPathwayRulesByTestCode(testCode: string): Promise<PathwayRule[]>;

  // Clinical Pathways Engine — Pathway Events
  createClinicalPathwayEvent(event: InsertClinicalPathwayEvent): Promise<ClinicalPathwayEvent>;
  getClinicalPathwayEvents(specimenId?: number, pathwayId?: number, limit?: number): Promise<ClinicalPathwayEvent[]>;

  // Clinical Pathways Engine — Patient test history check
  hasPatientCompletedTest(patientId: number, testCode: string, withinDays?: number): Promise<boolean>;

  // Event-Driven Processing: Enhanced Events
  getUnprocessedEvents(limit?: number): Promise<Event[]>;
  markEventProcessed(id: number): Promise<void>;
  markEventFailed(id: number): Promise<void>;

  // Read Models
  upsertWorklistView(entry: InsertWorklistView): Promise<WorklistViewEntry>;
  getWorklistView(labId?: number): Promise<WorklistViewEntry[]>;
  upsertNationalMetrics(entry: InsertNationalMetricsView): Promise<NationalMetricsViewEntry>;
  getNationalMetricsView(labId?: number): Promise<NationalMetricsViewEntry[]>;
  createSuggestionStreamEntry(entry: InsertSuggestionStreamView): Promise<SuggestionStreamViewEntry>;
  getSuggestionStreamView(labId?: number, limit?: number): Promise<SuggestionStreamViewEntry[]>;

  // Unified Suggestion Orchestrator
  createUnifiedSuggestion(suggestion: InsertUnifiedSuggestion): Promise<UnifiedSuggestion>;
  getUnifiedSuggestions(labId?: number, patientId?: number, limit?: number): Promise<UnifiedSuggestion[]>;
  findDuplicateSuggestion(deduplicationKey: string): Promise<UnifiedSuggestion | undefined>;

  // Notification Engine
  createNotificationTemplate(template: InsertNotificationTemplate): Promise<NotificationTemplate>;
  getNotificationTemplates(eventType?: string): Promise<NotificationTemplate[]>;
  createNotificationEvent(event: InsertNotificationEvent): Promise<NotificationEvent>;
  createDeliveryLog(log: InsertDeliveryLog): Promise<DeliveryLog>;

  // Notifications (lightweight user-facing)
  createNotification(notification: InsertNotification): Promise<Notification>;
  getNotifications(userId: number, unreadOnly?: boolean, limit?: number): Promise<Notification[]>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  markNotificationRead(id: number, userId?: number): Promise<Notification | undefined>;
  markAllNotificationsRead(userId: number): Promise<void>;

  // Security Events
  createSecurityEvent(event: InsertSecurityEvent): Promise<SecurityEvent>;
  getSecurityEvents(userId?: number, limit?: number): Promise<SecurityEvent[]>;

  // Hot vs Cold Data Architecture
  createResultHot(entry: InsertResultHot): Promise<ResultHot>;
  getResultsHotOlderThan(days: number, limit?: number): Promise<ResultHot[]>;
  deleteResultHot(id: number): Promise<void>;
  createResultArchive(entry: InsertResultArchive): Promise<ResultArchive>;
  getResultsArchive(patientId?: number, labId?: number, limit?: number): Promise<ResultArchive[]>;
  upsertPatientHistorySummary(entry: InsertPatientHistorySummary): Promise<PatientHistorySummaryEntry>;
  getPatientHistorySummary(patientId: number, labId?: number): Promise<PatientHistorySummaryEntry | undefined>;
  getPatientHistorySummaries(labId?: number): Promise<PatientHistorySummaryEntry[]>;
  getArchiveWorkerStats(): Promise<{ hotCount: number; archiveCount: number; summaryCount: number }>;

  // Instrument Streaming Gateway: Analyzers
  createAnalyzer(analyzer: InsertAnalyzer): Promise<Analyzer>;
  getAnalyzerByTokenHash(tokenHash: string): Promise<Analyzer | undefined>;
  getAnalyzerById(analyzerId: string): Promise<Analyzer | undefined>;
  getAnalyzers(facilityCode?: string): Promise<Analyzer[]>;
  updateAnalyzerLastUsed(id: number): Promise<void>;
  updateAnalyzerToken(id: number, newTokenHash: string): Promise<Analyzer | undefined>;
  deactivateAnalyzer(id: number): Promise<void>;

  // Instrument Streaming Gateway: Event Queue
  enqueueAnalyzerEvent(entry: InsertAnalyzerEventQueue): Promise<AnalyzerEventQueueEntry>;
  getPendingAnalyzerEvents(limit?: number): Promise<AnalyzerEventQueueEntry[]>;
  markAnalyzerEventProcessed(id: number): Promise<void>;
  markAnalyzerEventFailed(id: number, errorDetail: string): Promise<void>;
  incrementAnalyzerEventRetry(id: number): Promise<AnalyzerEventQueueEntry | undefined>;
  findDuplicateAnalyzerEvent(analyzerId: string, messageHash: string): Promise<AnalyzerEventQueueEntry | undefined>;
  getAnalyzerEventQueueStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }>;

  // Governance Jobs (Asynchronous Clinical Governance)
  createGovernanceJob(job: InsertGovernanceJob): Promise<GovernanceJob>;
  getPendingGovernanceJobs(limit?: number): Promise<GovernanceJob[]>;
  updateGovernanceJobStatus(id: number, status: string, result?: any, errorDetail?: string): Promise<GovernanceJob | undefined>;
  incrementGovernanceJobRetry(id: number): Promise<GovernanceJob | undefined>;
  getGovernanceJobsByEventId(eventId: number): Promise<GovernanceJob[]>;
  getGovernanceJobStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }>;
  findDuplicateGovernanceJob(eventId: number, jobType: string): Promise<GovernanceJob | undefined>;

  // Disaster-Proof Offline Architecture: Local Sync Events
  createLocalSyncEvent(event: InsertLocalSyncEvent): Promise<LocalSyncEvent>;
  getPendingSyncEvents(limit?: number): Promise<LocalSyncEvent[]>;
  getSyncEventsByFacility(facilityCode: string, limit?: number): Promise<LocalSyncEvent[]>;
  getSyncEventByUuid(eventUuid: string): Promise<LocalSyncEvent | undefined>;
  updateSyncEventStatus(id: number, syncStatus: string, errorDetail?: string): Promise<LocalSyncEvent | undefined>;
  incrementSyncEventRetry(id: number): Promise<LocalSyncEvent | undefined>;
  getSyncEventStats(): Promise<{ pending: number; synced: number; failed: number; conflicted: number }>;

  // Disaster-Proof Offline Architecture: Sync Conflict Policy
  createSyncConflictPolicy(policy: InsertSyncConflictPolicy): Promise<SyncConflictPolicyEntry>;
  getSyncConflictPolicies(activeOnly?: boolean): Promise<SyncConflictPolicyEntry[]>;
  getSyncConflictPolicyByEntity(entityType: string): Promise<SyncConflictPolicyEntry | undefined>;
  updateSyncConflictPolicyActive(id: number, activeFlag: boolean): Promise<SyncConflictPolicyEntry | undefined>;

  // Disaster-Proof Offline Architecture: Conflict Audit Log
  createConflictAuditLog(entry: InsertConflictAuditLog): Promise<ConflictAuditLogEntry>;
  getConflictAuditLogs(facilityCode?: string, limit?: number): Promise<ConflictAuditLogEntry[]>;
  updateConflictResolution(id: number, resolvedBy: number): Promise<ConflictAuditLogEntry | undefined>;

  // Disaster-Proof Offline Architecture: Facility Connectivity Status
  upsertFacilityConnectivityStatus(entry: InsertFacilityConnectivityStatus): Promise<FacilityConnectivityStatusEntry>;
  getFacilityConnectivityStatus(facilityCode: string): Promise<FacilityConnectivityStatusEntry | undefined>;
  getAllFacilityConnectivityStatuses(): Promise<FacilityConnectivityStatusEntry[]>;

  // Zero-Trust Security: Identities
  createZeroTrustIdentity(identity: InsertZeroTrustIdentity): Promise<ZeroTrustIdentity>;
  getZeroTrustIdentityByUuid(identityUuid: string): Promise<ZeroTrustIdentity | undefined>;
  getZeroTrustIdentitiesByEntity(identityType: string, entityRef: number): Promise<ZeroTrustIdentity[]>;
  updateZeroTrustIdentityStatus(id: number, tokenStatus: string): Promise<ZeroTrustIdentity | undefined>;
  updateZeroTrustIdentityLastUsed(id: number): Promise<void>;
  getActiveIdentities(identityType?: string): Promise<ZeroTrustIdentity[]>;
  revokeExpiredIdentities(): Promise<number>;

  // Zero-Trust Security: Quarantine Queue
  createQuarantineEntry(entry: InsertSecurityQuarantine): Promise<SecurityQuarantineEntry>;
  getQuarantineEntries(reviewStatus?: string, limit?: number): Promise<SecurityQuarantineEntry[]>;
  updateQuarantineReview(id: number, reviewStatus: string, reviewedBy: number): Promise<SecurityQuarantineEntry | undefined>;

  // Zero-Trust Security: National Audit Trail
  createNationalAuditEntry(entry: InsertNationalAuditTrail): Promise<NationalAuditTrailEntry>;
  getNationalAuditTrail(facilityScope?: string, limit?: number): Promise<NationalAuditTrailEntry[]>;
  getNationalAuditByIdentity(identityUuid: string, limit?: number): Promise<NationalAuditTrailEntry[]>;

  // Clinical Intelligence Layer: Intelligence Events
  createIntelligenceEvent(event: InsertIntelligenceEvent): Promise<IntelligenceEvent>;
  getPendingIntelligenceEvents(limit?: number): Promise<IntelligenceEvent[]>;
  markIntelligenceEventStatus(id: number, status: string): Promise<void>;
  getIntelligenceEventStats(): Promise<{ pending: number; processed: number; rejected: number; failed: number }>;

  // Clinical Intelligence Layer: Anonymized Metrics
  createAnonymizedMetric(metric: InsertAnonymizedMetric): Promise<AnonymizedMetric>;
  findAnonymizedMetric(testCode: string, facilityCode: string, timestampBucket: Date, aggregationLevel: string): Promise<AnonymizedMetric | undefined>;
  incrementAnonymizedMetricCount(metricId: number): Promise<void>;
  getRecentAnonymizedMetrics(limit?: number): Promise<AnonymizedMetric[]>;
  getAnonymizedMetricsByFacility(facilityCode: string, limit?: number): Promise<AnonymizedMetric[]>;
  getAnonymizedMetricsByTestCode(testCode: string, limit?: number): Promise<AnonymizedMetric[]>;

  // Clinical Intelligence Layer: Intelligence Alerts
  createIntelligenceAlert(alert: InsertIntelligenceAlert): Promise<IntelligenceAlert>;
  getIntelligenceAlerts(alertType?: string, limit?: number): Promise<IntelligenceAlert[]>;
  findRecentIntelligenceAlert(alertType: string, facilityCode?: string, withinHours?: number, testCode?: string): Promise<IntelligenceAlert | undefined>;
  acknowledgeIntelligenceAlert(id: number, acknowledgedBy: number): Promise<IntelligenceAlert | undefined>;

  // National Master Data: Tests
  createNationalTest(test: InsertNationalTest): Promise<NationalTest>;
  getNationalTests(status?: string): Promise<NationalTest[]>;
  getNationalTestByLoinc(loincCode: string): Promise<NationalTest | undefined>;
  updateNationalTest(id: number, data: Partial<InsertNationalTest>): Promise<NationalTest | undefined>;

  // National Master Data: Analyzers
  createNationalAnalyzer(analyzer: InsertNationalAnalyzer): Promise<NationalAnalyzer>;
  getNationalAnalyzers(status?: string): Promise<NationalAnalyzer[]>;
  getNationalAnalyzerById(id: number): Promise<NationalAnalyzer | undefined>;
  updateNationalAnalyzer(id: number, data: Partial<InsertNationalAnalyzer>): Promise<NationalAnalyzer | undefined>;

  // National Master Data: Roles
  createNationalRole(role: InsertNationalRole): Promise<NationalRole>;
  getNationalRoles(status?: string): Promise<NationalRole[]>;
  getNationalRoleByCode(roleCode: string): Promise<NationalRole | undefined>;
  updateNationalRole(id: number, data: Partial<InsertNationalRole>): Promise<NationalRole | undefined>;

  // National Master Data: Facilities
  createNationalFacility(facility: InsertNationalFacility): Promise<NationalFacility>;
  getNationalFacilities(sector?: string, level?: string): Promise<NationalFacility[]>;
  getNationalFacilityByCode(facilityCode: string): Promise<NationalFacility | undefined>;
  updateNationalFacility(id: number, data: Partial<InsertNationalFacility>): Promise<NationalFacility | undefined>;
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

  // === Identity Verification ===

  async createIdentityVerification(verification: InsertIdentityVerification): Promise<IdentityVerification> {
    const [record] = await db.insert(identityVerifications).values(verification).returning();
    return record;
  }

  async updateIdentityVerificationStatus(id: number, status: string, verifiedAt?: Date): Promise<IdentityVerification | undefined> {
    const updates: Record<string, any> = { verificationStatus: status };
    if (verifiedAt) updates.verifiedAt = verifiedAt;
    const [updated] = await db.update(identityVerifications)
      .set(updates)
      .where(eq(identityVerifications.id, id))
      .returning();
    return updated;
  }

  async getIdentityVerificationsByPatient(patientId: number): Promise<IdentityVerification[]> {
    return await db.select().from(identityVerifications)
      .where(eq(identityVerifications.patientId, patientId))
      .orderBy(desc(identityVerifications.createdAt));
  }

  async getIdentityVerification(id: number): Promise<IdentityVerification | undefined> {
    const [record] = await db.select().from(identityVerifications).where(eq(identityVerifications.id, id));
    return record;
  }

  async getLatestVerificationByPatient(patientId: number): Promise<IdentityVerification | undefined> {
    const [record] = await db.select().from(identityVerifications)
      .where(eq(identityVerifications.patientId, patientId))
      .orderBy(desc(identityVerifications.createdAt))
      .limit(1);
    return record;
  }

  // === Clinical Governance Engine — Test Policies ===

  async createTestPolicy(policy: InsertTestPolicy): Promise<TestPolicy> {
    const [newPolicy] = await db.insert(testPolicies).values(policy).returning();
    return newPolicy;
  }

  async getTestPolicies(sector?: string, activeOnly?: boolean): Promise<TestPolicy[]> {
    const conditions = [];
    if (sector) conditions.push(eq(testPolicies.sector, sector));
    if (activeOnly) conditions.push(eq(testPolicies.activeFlag, true));
    return await db.select().from(testPolicies)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(testPolicies.createdAt));
  }

  async getTestPolicy(id: number): Promise<TestPolicy | undefined> {
    const [policy] = await db.select().from(testPolicies).where(eq(testPolicies.id, id));
    return policy;
  }

  async updateTestPolicyActive(id: number, activeFlag: boolean): Promise<TestPolicy | undefined> {
    const [updated] = await db.update(testPolicies)
      .set({ activeFlag })
      .where(eq(testPolicies.id, id))
      .returning();
    return updated;
  }

  async evaluateTestPolicies(testCode: string, sector: string): Promise<TestPolicy[]> {
    return await db.select().from(testPolicies)
      .where(and(
        eq(testPolicies.activeFlag, true),
        eq(testPolicies.sector, sector),
        sql`(${testPolicies.testCode} = ${testCode} OR ${testPolicies.testCode} IS NULL)`
      ));
  }

  async getRecentTestResultsByCode(testCode: string, patientId: number, withinDays: number): Promise<TestResult[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - withinDays);

    return await db.select({
      id: testResults.id,
      sampleId: testResults.sampleId,
      testTypeId: testResults.testTypeId,
      resultValue: testResults.resultValue,
      qcFlag: testResults.qcFlag,
      status: testResults.status,
      enteredBy: testResults.enteredBy,
      verifiedBy: testResults.verifiedBy,
      analyzerId: testResults.analyzerId,
      facilityId: testResults.facilityId,
      notes: testResults.notes,
      performedAt: testResults.performedAt,
      verifiedAt: testResults.verifiedAt,
    }).from(testResults)
      .innerJoin(testTypes, eq(testResults.testTypeId, testTypes.id))
      .innerJoin(samples, eq(testResults.sampleId, samples.id))
      .where(and(
        eq(testTypes.code, testCode),
        eq(samples.patientId, patientId),
        sql`${testResults.performedAt} >= ${cutoff}`
      ));
  }

  // === Clinical Governance Engine — Governance Events ===

  async createGovernanceEvent(event: InsertGovernanceEvent): Promise<GovernanceEvent> {
    const [record] = await db.insert(governanceEvents).values(event).returning();
    return record;
  }

  async getGovernanceEvents(specimenId?: number, testCode?: string, limit?: number): Promise<GovernanceEvent[]> {
    const conditions = [];
    if (specimenId) conditions.push(eq(governanceEvents.specimenId, specimenId));
    if (testCode) conditions.push(eq(governanceEvents.testCode, testCode));
    const query = db.select().from(governanceEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(governanceEvents.createdAt));
    if (limit) return await query.limit(limit);
    return await query;
  }

  // === Clinical Pathways Engine — Pathway Definitions ===

  async createClinicalPathway(pathway: InsertClinicalPathway): Promise<ClinicalPathway> {
    const [record] = await db.insert(clinicalPathways).values(pathway).returning();
    return record;
  }

  async getClinicalPathways(sector?: string, activeOnly?: boolean): Promise<ClinicalPathway[]> {
    const conditions = [];
    if (sector) conditions.push(eq(clinicalPathways.sector, sector));
    if (activeOnly) conditions.push(eq(clinicalPathways.activeFlag, true));
    return await db.select().from(clinicalPathways)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(clinicalPathways.createdAt));
  }

  async getClinicalPathway(id: number): Promise<ClinicalPathway | undefined> {
    const [record] = await db.select().from(clinicalPathways).where(eq(clinicalPathways.id, id));
    return record;
  }

  async updateClinicalPathwayActive(id: number, activeFlag: boolean): Promise<ClinicalPathway | undefined> {
    const [updated] = await db.update(clinicalPathways)
      .set({ activeFlag })
      .where(eq(clinicalPathways.id, id))
      .returning();
    return updated;
  }

  async getPathwaysByTriggerTest(triggerTest: string, sector?: string): Promise<ClinicalPathway[]> {
    const conditions = [
      eq(clinicalPathways.activeFlag, true),
      eq(clinicalPathways.triggerTest, triggerTest),
    ];
    if (sector) conditions.push(eq(clinicalPathways.sector, sector));
    return await db.select().from(clinicalPathways)
      .where(and(...conditions));
  }

  // === Clinical Pathways Engine — Pathway Rules ===

  async createPathwayRule(rule: InsertPathwayRule): Promise<PathwayRule> {
    const [record] = await db.insert(pathwayRules).values(rule).returning();
    return record;
  }

  async getPathwayRules(activeOnly?: boolean): Promise<PathwayRule[]> {
    if (activeOnly) {
      return await db.select().from(pathwayRules)
        .where(eq(pathwayRules.activeFlag, true))
        .orderBy(desc(pathwayRules.createdAt));
    }
    return await db.select().from(pathwayRules).orderBy(desc(pathwayRules.createdAt));
  }

  async getPathwayRule(id: number): Promise<PathwayRule | undefined> {
    const [record] = await db.select().from(pathwayRules).where(eq(pathwayRules.id, id));
    return record;
  }

  async updatePathwayRuleActive(id: number, activeFlag: boolean): Promise<PathwayRule | undefined> {
    const [updated] = await db.update(pathwayRules)
      .set({ activeFlag })
      .where(eq(pathwayRules.id, id))
      .returning();
    return updated;
  }

  async getPathwayRulesByTestCode(testCode: string): Promise<PathwayRule[]> {
    return await db.select().from(pathwayRules)
      .where(and(
        eq(pathwayRules.activeFlag, true),
        eq(pathwayRules.testCode, testCode),
      ));
  }

  // === Clinical Pathways Engine — Pathway Events ===

  async createClinicalPathwayEvent(event: InsertClinicalPathwayEvent): Promise<ClinicalPathwayEvent> {
    const [record] = await db.insert(clinicalPathwayEvents).values(event).returning();
    return record;
  }

  async getClinicalPathwayEvents(specimenId?: number, pathwayId?: number, limit?: number): Promise<ClinicalPathwayEvent[]> {
    const conditions = [];
    if (specimenId) conditions.push(eq(clinicalPathwayEvents.specimenId, specimenId));
    if (pathwayId) conditions.push(eq(clinicalPathwayEvents.pathwayId, pathwayId));
    const query = db.select().from(clinicalPathwayEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(clinicalPathwayEvents.createdAt));
    if (limit) return await query.limit(limit);
    return await query;
  }

  // === Clinical Pathways Engine — Patient test history check ===

  async hasPatientCompletedTest(patientId: number, testCode: string, withinDays?: number): Promise<boolean> {
    const conditions = [
      eq(testTypes.code, testCode),
      eq(samples.patientId, patientId),
      eq(testResults.status, "verified"),
    ];

    if (withinDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - withinDays);
      conditions.push(sql`${testResults.verifiedAt} >= ${cutoff}`);
    }

    const results = await db.select({ id: testResults.id })
      .from(testResults)
      .innerJoin(testTypes, eq(testResults.testTypeId, testTypes.id))
      .innerJoin(samples, eq(testResults.sampleId, samples.id))
      .where(and(...conditions))
      .limit(1);

    return results.length > 0;
  }

  // === Event-Driven Processing: Enhanced Events ===

  async getUnprocessedEvents(limit: number = 100): Promise<Event[]> {
    return await db.select().from(events)
      .where(eq(events.processedStatus, "pending"))
      .orderBy(events.createdAt)
      .limit(limit);
  }

  async markEventProcessed(id: number): Promise<void> {
    await db.update(events)
      .set({ processedStatus: "processed", processedAt: new Date() })
      .where(eq(events.id, id));
  }

  async markEventFailed(id: number): Promise<void> {
    await db.update(events)
      .set({ processedStatus: "failed" })
      .where(eq(events.id, id));
  }

  // === Read Models ===

  async upsertWorklistView(entry: InsertWorklistView): Promise<WorklistViewEntry> {
    if (entry.sampleId) {
      const [existing] = await db.select().from(worklistView)
        .where(eq(worklistView.sampleId, entry.sampleId));
      if (existing) {
        const [updated] = await db.update(worklistView)
          .set({ ...entry, projectedAt: new Date() })
          .where(eq(worklistView.id, existing.id))
          .returning();
        return updated;
      }
    }
    const [created] = await db.insert(worklistView).values(entry).returning();
    return created;
  }

  async getWorklistView(labId?: number): Promise<WorklistViewEntry[]> {
    if (labId) {
      return await db.select().from(worklistView)
        .where(eq(worklistView.labId, labId))
        .orderBy(desc(worklistView.lastEventAt));
    }
    return await db.select().from(worklistView).orderBy(desc(worklistView.lastEventAt));
  }

  async upsertNationalMetrics(entry: InsertNationalMetricsView): Promise<NationalMetricsViewEntry> {
    const conditions = [eq(nationalMetricsView.metricType, entry.metricType)];
    if (entry.labId) conditions.push(eq(nationalMetricsView.labId, entry.labId));
    const [existing] = await db.select().from(nationalMetricsView)
      .where(and(...conditions));
    if (existing) {
      const [updated] = await db.update(nationalMetricsView)
        .set({ ...entry, projectedAt: new Date() })
        .where(eq(nationalMetricsView.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(nationalMetricsView).values(entry).returning();
    return created;
  }

  async getNationalMetricsView(labId?: number): Promise<NationalMetricsViewEntry[]> {
    if (labId) {
      return await db.select().from(nationalMetricsView)
        .where(eq(nationalMetricsView.labId, labId))
        .orderBy(desc(nationalMetricsView.projectedAt));
    }
    return await db.select().from(nationalMetricsView).orderBy(desc(nationalMetricsView.projectedAt));
  }

  async createSuggestionStreamEntry(entry: InsertSuggestionStreamView): Promise<SuggestionStreamViewEntry> {
    const [created] = await db.insert(suggestionStreamView).values(entry).returning();
    return created;
  }

  async getSuggestionStreamView(labId?: number, limit: number = 100): Promise<SuggestionStreamViewEntry[]> {
    if (labId) {
      return await db.select().from(suggestionStreamView)
        .where(eq(suggestionStreamView.labId, labId))
        .orderBy(desc(suggestionStreamView.projectedAt))
        .limit(limit);
    }
    return await db.select().from(suggestionStreamView)
      .orderBy(desc(suggestionStreamView.projectedAt))
      .limit(limit);
  }

  // === Unified Suggestion Orchestrator ===

  async createUnifiedSuggestion(suggestion: InsertUnifiedSuggestion): Promise<UnifiedSuggestion> {
    const [created] = await db.insert(unifiedSuggestionStream).values(suggestion).returning();
    return created;
  }

  async getUnifiedSuggestions(labId?: number, patientId?: number, limit: number = 100): Promise<UnifiedSuggestion[]> {
    const conditions = [];
    if (labId) conditions.push(eq(unifiedSuggestionStream.labId, labId));
    if (patientId) conditions.push(eq(unifiedSuggestionStream.patientId, patientId));
    return await db.select().from(unifiedSuggestionStream)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(unifiedSuggestionStream.emittedAt))
      .limit(limit);
  }

  async findDuplicateSuggestion(deduplicationKey: string): Promise<UnifiedSuggestion | undefined> {
    const [found] = await db.select().from(unifiedSuggestionStream)
      .where(eq(unifiedSuggestionStream.deduplicationKey, deduplicationKey))
      .limit(1);
    return found;
  }

  // === Notification Engine ===

  async createNotificationTemplate(template: InsertNotificationTemplate): Promise<NotificationTemplate> {
    const [created] = await db.insert(notificationTemplates).values(template).returning();
    return created;
  }

  async getNotificationTemplates(eventType?: string): Promise<NotificationTemplate[]> {
    if (eventType) {
      return await db.select().from(notificationTemplates)
        .where(and(eq(notificationTemplates.eventType, eventType), eq(notificationTemplates.isActive, true)));
    }
    return await db.select().from(notificationTemplates)
      .where(eq(notificationTemplates.isActive, true));
  }

  async createNotificationEvent(event: InsertNotificationEvent): Promise<NotificationEvent> {
    const [created] = await db.insert(notificationEvents).values(event).returning();
    return created;
  }

  async createDeliveryLog(log: InsertDeliveryLog): Promise<DeliveryLog> {
    const [created] = await db.insert(deliveryLogs).values(log).returning();
    return created;
  }

  // === Notifications (lightweight user-facing) ===

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [created] = await db.insert(notifications).values(notification).returning();
    return created;
  }

  async getNotifications(userId: number, unreadOnly?: boolean, limit: number = 50): Promise<Notification[]> {
    const conditions = [eq(notifications.userId, userId)];
    if (unreadOnly) conditions.push(eq(notifications.isRead, false));
    return await db.select().from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return Number(result[0]?.count || 0);
  }

  async markNotificationRead(id: number, userId?: number): Promise<Notification | undefined> {
    const conditions = [eq(notifications.id, id)];
    if (userId) conditions.push(eq(notifications.userId, userId));
    const [updated] = await db.update(notifications)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }

  // === Security Events ===

  async createSecurityEvent(event: InsertSecurityEvent): Promise<SecurityEvent> {
    const [created] = await db.insert(securityEvents).values(event).returning();
    return created;
  }

  async getSecurityEvents(userId?: number, limit: number = 100): Promise<SecurityEvent[]> {
    if (userId) {
      return await db.select().from(securityEvents)
        .where(eq(securityEvents.userId, userId))
        .orderBy(desc(securityEvents.createdAt))
        .limit(limit);
    }
    return await db.select().from(securityEvents)
      .orderBy(desc(securityEvents.createdAt))
      .limit(limit);
  }

  // === Governance Jobs (Asynchronous Clinical Governance) ===

  async createGovernanceJob(job: InsertGovernanceJob): Promise<GovernanceJob> {
    const [created] = await db.insert(governanceJobs).values(job).returning();
    return created;
  }

  async getPendingGovernanceJobs(limit: number = 50): Promise<GovernanceJob[]> {
    return await db.select().from(governanceJobs)
      .where(eq(governanceJobs.status, "PENDING"))
      .orderBy(governanceJobs.createdAt)
      .limit(limit);
  }

  async updateGovernanceJobStatus(id: number, status: string, result?: any, errorDetail?: string): Promise<GovernanceJob | undefined> {
    const setValues: any = { status };
    if (status === "COMPLETED" || status === "FAILED") {
      setValues.processedAt = new Date();
    }
    if (result !== undefined) setValues.result = result;
    if (errorDetail !== undefined) setValues.errorDetail = errorDetail;
    const [updated] = await db.update(governanceJobs)
      .set(setValues)
      .where(eq(governanceJobs.id, id))
      .returning();
    return updated;
  }

  async incrementGovernanceJobRetry(id: number): Promise<GovernanceJob | undefined> {
    const [updated] = await db.update(governanceJobs)
      .set({ retryCount: sql`${governanceJobs.retryCount} + 1` })
      .where(eq(governanceJobs.id, id))
      .returning();
    return updated;
  }

  async getGovernanceJobsByEventId(eventId: number): Promise<GovernanceJob[]> {
    return await db.select().from(governanceJobs)
      .where(eq(governanceJobs.eventId, eventId))
      .orderBy(desc(governanceJobs.createdAt));
  }

  async getGovernanceJobStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
    const result = await db.select({
      status: governanceJobs.status,
      count: sql<number>`count(*)::int`,
    }).from(governanceJobs).groupBy(governanceJobs.status);
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of result) {
      const key = row.status.toLowerCase() as keyof typeof stats;
      if (key in stats) stats[key] = row.count;
    }
    return stats;
  }

  async findDuplicateGovernanceJob(eventId: number, jobType: string): Promise<GovernanceJob | undefined> {
    const [existing] = await db.select().from(governanceJobs)
      .where(and(eq(governanceJobs.eventId, eventId), eq(governanceJobs.jobType, jobType)))
      .limit(1);
    return existing;
  }

  async createResultHot(entry: InsertResultHot): Promise<ResultHot> {
    const [created] = await db.insert(resultsHot).values(entry).returning();
    return created;
  }

  async getResultsHotOlderThan(days: number, limit: number = 100): Promise<ResultHot[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return await db.select().from(resultsHot)
      .where(sql`${resultsHot.createdAt} < ${cutoff}`)
      .orderBy(resultsHot.createdAt)
      .limit(limit);
  }

  async deleteResultHot(id: number): Promise<void> {
    await db.delete(resultsHot).where(eq(resultsHot.id, id));
  }

  async createResultArchive(entry: InsertResultArchive): Promise<ResultArchive> {
    const [created] = await db.insert(resultsArchive).values(entry).returning();
    return created;
  }

  async getResultsArchive(patientId?: number, labId?: number, limit: number = 200): Promise<ResultArchive[]> {
    const conditions = [];
    if (patientId) conditions.push(eq(resultsArchive.patientId, patientId));
    if (labId) conditions.push(eq(resultsArchive.labId, labId));
    const query = conditions.length > 0
      ? db.select().from(resultsArchive).where(and(...conditions))
      : db.select().from(resultsArchive);
    return await query.orderBy(desc(resultsArchive.createdAt)).limit(limit);
  }

  async upsertPatientHistorySummary(entry: InsertPatientHistorySummary): Promise<PatientHistorySummaryEntry> {
    const conditions = [eq(patientHistorySummary.patientId, entry.patientId)];
    if (entry.labId) conditions.push(eq(patientHistorySummary.labId, entry.labId));
    const [existing] = await db.select().from(patientHistorySummary).where(and(...conditions)).limit(1);
    if (existing) {
      const [updated] = await db.update(patientHistorySummary)
        .set({ ...entry, updatedAt: new Date() })
        .where(eq(patientHistorySummary.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(patientHistorySummary).values(entry).returning();
    return created;
  }

  async getPatientHistorySummary(patientId: number, labId?: number): Promise<PatientHistorySummaryEntry | undefined> {
    const conditions = [eq(patientHistorySummary.patientId, patientId)];
    if (labId) conditions.push(eq(patientHistorySummary.labId, labId));
    const [result] = await db.select().from(patientHistorySummary).where(and(...conditions)).limit(1);
    return result;
  }

  async getPatientHistorySummaries(labId?: number): Promise<PatientHistorySummaryEntry[]> {
    if (labId) {
      return await db.select().from(patientHistorySummary)
        .where(eq(patientHistorySummary.labId, labId))
        .orderBy(desc(patientHistorySummary.updatedAt));
    }
    return await db.select().from(patientHistorySummary).orderBy(desc(patientHistorySummary.updatedAt));
  }

  async getArchiveWorkerStats(): Promise<{ hotCount: number; archiveCount: number; summaryCount: number }> {
    const [hotResult] = await db.select({ count: sql<number>`count(*)::int` }).from(resultsHot);
    const [archiveResult] = await db.select({ count: sql<number>`count(*)::int` }).from(resultsArchive);
    const [summaryResult] = await db.select({ count: sql<number>`count(*)::int` }).from(patientHistorySummary);
    return {
      hotCount: hotResult?.count || 0,
      archiveCount: archiveResult?.count || 0,
      summaryCount: summaryResult?.count || 0,
    };
  }

  async createAnalyzer(analyzer: InsertAnalyzer): Promise<Analyzer> {
    const [created] = await db.insert(analyzers).values(analyzer).returning();
    return created;
  }

  async getAnalyzerByTokenHash(tokenHash: string): Promise<Analyzer | undefined> {
    const [found] = await db.select().from(analyzers).where(eq(analyzers.analyzerTokenHash, tokenHash)).limit(1);
    return found;
  }

  async getAnalyzerById(analyzerId: string): Promise<Analyzer | undefined> {
    const [found] = await db.select().from(analyzers).where(eq(analyzers.analyzerId, analyzerId)).limit(1);
    return found;
  }

  async getAnalyzers(facilityCode?: string): Promise<Analyzer[]> {
    if (facilityCode) {
      return await db.select().from(analyzers).where(eq(analyzers.facilityCode, facilityCode)).orderBy(desc(analyzers.createdAt));
    }
    return await db.select().from(analyzers).orderBy(desc(analyzers.createdAt));
  }

  async updateAnalyzerLastUsed(id: number): Promise<void> {
    await db.update(analyzers).set({ lastUsedAt: new Date() }).where(eq(analyzers.id, id));
  }

  async updateAnalyzerToken(id: number, newTokenHash: string): Promise<Analyzer | undefined> {
    const [updated] = await db.update(analyzers).set({ analyzerTokenHash: newTokenHash }).where(eq(analyzers.id, id)).returning();
    return updated;
  }

  async deactivateAnalyzer(id: number): Promise<void> {
    await db.update(analyzers).set({ isActive: false }).where(eq(analyzers.id, id));
  }

  async enqueueAnalyzerEvent(entry: InsertAnalyzerEventQueue): Promise<AnalyzerEventQueueEntry> {
    const [created] = await db.insert(analyzerEventQueue).values(entry).returning();
    return created;
  }

  async getPendingAnalyzerEvents(limit: number = 50): Promise<AnalyzerEventQueueEntry[]> {
    return await db.select().from(analyzerEventQueue)
      .where(eq(analyzerEventQueue.processedStatus, "pending"))
      .orderBy(analyzerEventQueue.createdAt)
      .limit(limit);
  }

  async markAnalyzerEventProcessed(id: number): Promise<void> {
    await db.update(analyzerEventQueue)
      .set({ processedStatus: "completed", processedAt: new Date() })
      .where(eq(analyzerEventQueue.id, id));
  }

  async markAnalyzerEventFailed(id: number, errorDetail: string): Promise<void> {
    await db.update(analyzerEventQueue)
      .set({ processedStatus: "failed", errorDetail, processedAt: new Date() })
      .where(eq(analyzerEventQueue.id, id));
  }

  async incrementAnalyzerEventRetry(id: number): Promise<AnalyzerEventQueueEntry | undefined> {
    const [updated] = await db.update(analyzerEventQueue)
      .set({ retryCount: sql`${analyzerEventQueue.retryCount} + 1` })
      .where(eq(analyzerEventQueue.id, id))
      .returning();
    return updated;
  }

  async findDuplicateAnalyzerEvent(analyzerId: string, messageHash: string): Promise<AnalyzerEventQueueEntry | undefined> {
    const [existing] = await db.select().from(analyzerEventQueue)
      .where(and(
        eq(analyzerEventQueue.analyzerId, analyzerId),
        eq(analyzerEventQueue.messageHash, messageHash)
      ))
      .limit(1);
    return existing;
  }

  async getAnalyzerEventQueueStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
    const result = await db.select({
      status: analyzerEventQueue.processedStatus,
      count: sql<number>`count(*)::int`,
    }).from(analyzerEventQueue).groupBy(analyzerEventQueue.processedStatus);
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of result) {
      const key = row.status.toLowerCase() as keyof typeof stats;
      if (key in stats) stats[key] = row.count;
    }
    return stats;
  }

  // === Disaster-Proof Offline Architecture: Local Sync Events ===

  async createLocalSyncEvent(event: InsertLocalSyncEvent): Promise<LocalSyncEvent> {
    const [created] = await db.insert(localSyncEvents).values(event).returning();
    return created;
  }

  async getPendingSyncEvents(limit: number = 50): Promise<LocalSyncEvent[]> {
    return await db.select().from(localSyncEvents)
      .where(eq(localSyncEvents.syncStatus, "PENDING"))
      .orderBy(localSyncEvents.createdAt)
      .limit(limit);
  }

  async getSyncEventsByFacility(facilityCode: string, limit: number = 100): Promise<LocalSyncEvent[]> {
    return await db.select().from(localSyncEvents)
      .where(eq(localSyncEvents.facilityCode, facilityCode))
      .orderBy(desc(localSyncEvents.createdAt))
      .limit(limit);
  }

  async getSyncEventByUuid(eventUuid: string): Promise<LocalSyncEvent | undefined> {
    const [found] = await db.select().from(localSyncEvents)
      .where(eq(localSyncEvents.eventUuid, eventUuid))
      .limit(1);
    return found;
  }

  async updateSyncEventStatus(id: number, syncStatus: string, errorDetail?: string): Promise<LocalSyncEvent | undefined> {
    const setValues: any = { syncStatus, lastAttemptAt: new Date() };
    if (errorDetail !== undefined) setValues.errorDetail = errorDetail;
    const [updated] = await db.update(localSyncEvents)
      .set(setValues)
      .where(eq(localSyncEvents.id, id))
      .returning();
    return updated;
  }

  async incrementSyncEventRetry(id: number): Promise<LocalSyncEvent | undefined> {
    const [updated] = await db.update(localSyncEvents)
      .set({ retryCount: sql`${localSyncEvents.retryCount} + 1`, lastAttemptAt: new Date() })
      .where(eq(localSyncEvents.id, id))
      .returning();
    return updated;
  }

  async getSyncEventStats(): Promise<{ pending: number; synced: number; failed: number; conflicted: number }> {
    const result = await db.select({
      status: localSyncEvents.syncStatus,
      count: sql<number>`count(*)::int`,
    }).from(localSyncEvents).groupBy(localSyncEvents.syncStatus);
    const stats = { pending: 0, synced: 0, failed: 0, conflicted: 0 };
    for (const row of result) {
      const key = row.status.toLowerCase() as keyof typeof stats;
      if (key in stats) stats[key] = row.count;
    }
    return stats;
  }

  // === Disaster-Proof Offline Architecture: Sync Conflict Policy ===

  async createSyncConflictPolicy(policy: InsertSyncConflictPolicy): Promise<SyncConflictPolicyEntry> {
    const [created] = await db.insert(syncConflictPolicy).values(policy).returning();
    return created;
  }

  async getSyncConflictPolicies(activeOnly?: boolean): Promise<SyncConflictPolicyEntry[]> {
    if (activeOnly) {
      return await db.select().from(syncConflictPolicy)
        .where(eq(syncConflictPolicy.activeFlag, true))
        .orderBy(syncConflictPolicy.entityType);
    }
    return await db.select().from(syncConflictPolicy).orderBy(syncConflictPolicy.entityType);
  }

  async getSyncConflictPolicyByEntity(entityType: string): Promise<SyncConflictPolicyEntry | undefined> {
    const [found] = await db.select().from(syncConflictPolicy)
      .where(and(eq(syncConflictPolicy.entityType, entityType), eq(syncConflictPolicy.activeFlag, true)))
      .limit(1);
    return found;
  }

  async updateSyncConflictPolicyActive(id: number, activeFlag: boolean): Promise<SyncConflictPolicyEntry | undefined> {
    const [updated] = await db.update(syncConflictPolicy)
      .set({ activeFlag })
      .where(eq(syncConflictPolicy.id, id))
      .returning();
    return updated;
  }

  // === Disaster-Proof Offline Architecture: Conflict Audit Log ===

  async createConflictAuditLog(entry: InsertConflictAuditLog): Promise<ConflictAuditLogEntry> {
    const [created] = await db.insert(conflictAuditLog).values(entry).returning();
    return created;
  }

  async getConflictAuditLogs(facilityCode?: string, limit: number = 100): Promise<ConflictAuditLogEntry[]> {
    if (facilityCode) {
      return await db.select().from(conflictAuditLog)
        .where(eq(conflictAuditLog.facilityCode, facilityCode))
        .orderBy(desc(conflictAuditLog.createdAt))
        .limit(limit);
    }
    return await db.select().from(conflictAuditLog)
      .orderBy(desc(conflictAuditLog.createdAt))
      .limit(limit);
  }

  async updateConflictResolution(id: number, resolvedBy: number): Promise<ConflictAuditLogEntry | undefined> {
    const [updated] = await db.update(conflictAuditLog)
      .set({ resolutionStatus: "RESOLVED", resolvedBy, resolvedAt: new Date() })
      .where(eq(conflictAuditLog.id, id))
      .returning();
    return updated;
  }

  // === Disaster-Proof Offline Architecture: Facility Connectivity Status ===

  async upsertFacilityConnectivityStatus(entry: InsertFacilityConnectivityStatus): Promise<FacilityConnectivityStatusEntry> {
    const [existing] = await db.select().from(facilityConnectivityStatus)
      .where(eq(facilityConnectivityStatus.facilityCode, entry.facilityCode))
      .limit(1);
    if (existing) {
      const [updated] = await db.update(facilityConnectivityStatus)
        .set({ ...entry, updatedAt: new Date() })
        .where(eq(facilityConnectivityStatus.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(facilityConnectivityStatus).values(entry).returning();
    return created;
  }

  async getFacilityConnectivityStatus(facilityCode: string): Promise<FacilityConnectivityStatusEntry | undefined> {
    const [found] = await db.select().from(facilityConnectivityStatus)
      .where(eq(facilityConnectivityStatus.facilityCode, facilityCode))
      .limit(1);
    return found;
  }

  async getAllFacilityConnectivityStatuses(): Promise<FacilityConnectivityStatusEntry[]> {
    return await db.select().from(facilityConnectivityStatus)
      .orderBy(desc(facilityConnectivityStatus.updatedAt));
  }

  // === Zero-Trust Security: Identities ===

  async createZeroTrustIdentity(identity: InsertZeroTrustIdentity): Promise<ZeroTrustIdentity> {
    const [created] = await db.insert(zeroTrustIdentities).values(identity).returning();
    return created;
  }

  async getZeroTrustIdentityByUuid(identityUuid: string): Promise<ZeroTrustIdentity | undefined> {
    const [found] = await db.select().from(zeroTrustIdentities)
      .where(eq(zeroTrustIdentities.identityUuid, identityUuid))
      .limit(1);
    return found;
  }

  async getZeroTrustIdentitiesByEntity(identityType: string, entityRef: number): Promise<ZeroTrustIdentity[]> {
    return await db.select().from(zeroTrustIdentities)
      .where(and(eq(zeroTrustIdentities.identityType, identityType), eq(zeroTrustIdentities.entityRef, entityRef)))
      .orderBy(desc(zeroTrustIdentities.createdAt));
  }

  async updateZeroTrustIdentityStatus(id: number, tokenStatus: string): Promise<ZeroTrustIdentity | undefined> {
    const [updated] = await db.update(zeroTrustIdentities)
      .set({ tokenStatus })
      .where(eq(zeroTrustIdentities.id, id))
      .returning();
    return updated;
  }

  async updateZeroTrustIdentityLastUsed(id: number): Promise<void> {
    await db.update(zeroTrustIdentities)
      .set({ lastUsedAt: new Date() })
      .where(eq(zeroTrustIdentities.id, id));
  }

  async getActiveIdentities(identityType?: string): Promise<ZeroTrustIdentity[]> {
    if (identityType) {
      return await db.select().from(zeroTrustIdentities)
        .where(and(eq(zeroTrustIdentities.tokenStatus, "ACTIVE"), eq(zeroTrustIdentities.identityType, identityType)))
        .orderBy(desc(zeroTrustIdentities.createdAt));
    }
    return await db.select().from(zeroTrustIdentities)
      .where(eq(zeroTrustIdentities.tokenStatus, "ACTIVE"))
      .orderBy(desc(zeroTrustIdentities.createdAt));
  }

  async revokeExpiredIdentities(): Promise<number> {
    const result = await db.update(zeroTrustIdentities)
      .set({ tokenStatus: "EXPIRED" })
      .where(and(
        eq(zeroTrustIdentities.tokenStatus, "ACTIVE"),
        sql`${zeroTrustIdentities.expiresAt} < NOW()`
      ))
      .returning();
    return result.length;
  }

  // === Zero-Trust Security: Quarantine Queue ===

  async createQuarantineEntry(entry: InsertSecurityQuarantine): Promise<SecurityQuarantineEntry> {
    const [created] = await db.insert(securityQuarantineQueue).values(entry).returning();
    return created;
  }

  async getQuarantineEntries(reviewStatus?: string, limit: number = 100): Promise<SecurityQuarantineEntry[]> {
    if (reviewStatus) {
      return await db.select().from(securityQuarantineQueue)
        .where(eq(securityQuarantineQueue.reviewStatus, reviewStatus))
        .orderBy(desc(securityQuarantineQueue.createdAt))
        .limit(limit);
    }
    return await db.select().from(securityQuarantineQueue)
      .orderBy(desc(securityQuarantineQueue.createdAt))
      .limit(limit);
  }

  async updateQuarantineReview(id: number, reviewStatus: string, reviewedBy: number): Promise<SecurityQuarantineEntry | undefined> {
    const [updated] = await db.update(securityQuarantineQueue)
      .set({ reviewStatus, reviewedBy, reviewedAt: new Date() })
      .where(eq(securityQuarantineQueue.id, id))
      .returning();
    return updated;
  }

  // === Zero-Trust Security: National Audit Trail ===

  async createNationalAuditEntry(entry: InsertNationalAuditTrail): Promise<NationalAuditTrailEntry> {
    const [created] = await db.insert(nationalAuditTrail).values(entry).returning();
    return created;
  }

  async getNationalAuditTrail(facilityScope?: string, limit: number = 100): Promise<NationalAuditTrailEntry[]> {
    if (facilityScope) {
      return await db.select().from(nationalAuditTrail)
        .where(eq(nationalAuditTrail.facilityScope, facilityScope))
        .orderBy(desc(nationalAuditTrail.createdAt))
        .limit(limit);
    }
    return await db.select().from(nationalAuditTrail)
      .orderBy(desc(nationalAuditTrail.createdAt))
      .limit(limit);
  }

  async getNationalAuditByIdentity(identityUuid: string, limit: number = 100): Promise<NationalAuditTrailEntry[]> {
    return await db.select().from(nationalAuditTrail)
      .where(eq(nationalAuditTrail.identityUuid, identityUuid))
      .orderBy(desc(nationalAuditTrail.createdAt))
      .limit(limit);
  }

  // === Clinical Intelligence Layer: Intelligence Events ===

  async createIntelligenceEvent(event: InsertIntelligenceEvent): Promise<IntelligenceEvent> {
    const [created] = await db.insert(intelligenceEvents).values(event).returning();
    return created;
  }

  async getPendingIntelligenceEvents(limit: number = 25): Promise<IntelligenceEvent[]> {
    return await db.select().from(intelligenceEvents)
      .where(eq(intelligenceEvents.processingStatus, "PENDING"))
      .orderBy(intelligenceEvents.createdAt)
      .limit(limit);
  }

  async markIntelligenceEventStatus(id: number, status: string): Promise<void> {
    await db.update(intelligenceEvents)
      .set({ processingStatus: status, processedAt: new Date() })
      .where(eq(intelligenceEvents.id, id));
  }

  async getIntelligenceEventStats(): Promise<{ pending: number; processed: number; rejected: number; failed: number }> {
    const rows = await db.select({
      status: intelligenceEvents.processingStatus,
      count: sql<number>`count(*)::int`,
    }).from(intelligenceEvents).groupBy(intelligenceEvents.processingStatus);
    const stats = { pending: 0, processed: 0, rejected: 0, failed: 0 };
    for (const row of rows) {
      const key = row.status.toLowerCase() as keyof typeof stats;
      if (key in stats) stats[key] = row.count;
    }
    return stats;
  }

  // === Clinical Intelligence Layer: Anonymized Metrics ===

  async createAnonymizedMetric(metric: InsertAnonymizedMetric): Promise<AnonymizedMetric> {
    const [created] = await db.insert(anonymizedMetrics).values(metric).returning();
    return created;
  }

  async findAnonymizedMetric(testCode: string, facilityCode: string, timestampBucket: Date, aggregationLevel: string): Promise<AnonymizedMetric | undefined> {
    const [found] = await db.select().from(anonymizedMetrics)
      .where(and(
        eq(anonymizedMetrics.testCode, testCode),
        eq(anonymizedMetrics.facilityCode, facilityCode),
        eq(anonymizedMetrics.timestampBucket, timestampBucket),
        eq(anonymizedMetrics.aggregationLevel, aggregationLevel),
      ))
      .limit(1);
    return found;
  }

  async incrementAnonymizedMetricCount(metricId: number): Promise<void> {
    await db.update(anonymizedMetrics)
      .set({ count: sql`${anonymizedMetrics.count} + 1` })
      .where(eq(anonymizedMetrics.metricId, metricId));
  }

  async getRecentAnonymizedMetrics(limit: number = 100): Promise<AnonymizedMetric[]> {
    return await db.select().from(anonymizedMetrics)
      .orderBy(desc(anonymizedMetrics.createdAt))
      .limit(limit);
  }

  async getAnonymizedMetricsByFacility(facilityCode: string, limit: number = 100): Promise<AnonymizedMetric[]> {
    return await db.select().from(anonymizedMetrics)
      .where(eq(anonymizedMetrics.facilityCode, facilityCode))
      .orderBy(desc(anonymizedMetrics.timestampBucket))
      .limit(limit);
  }

  async getAnonymizedMetricsByTestCode(testCode: string, limit: number = 100): Promise<AnonymizedMetric[]> {
    return await db.select().from(anonymizedMetrics)
      .where(eq(anonymizedMetrics.testCode, testCode))
      .orderBy(desc(anonymizedMetrics.timestampBucket))
      .limit(limit);
  }

  // === Clinical Intelligence Layer: Intelligence Alerts ===

  async createIntelligenceAlert(alert: InsertIntelligenceAlert): Promise<IntelligenceAlert> {
    const [created] = await db.insert(intelligenceAlerts).values(alert).returning();
    return created;
  }

  async getIntelligenceAlerts(alertType?: string, limit: number = 100): Promise<IntelligenceAlert[]> {
    if (alertType) {
      return await db.select().from(intelligenceAlerts)
        .where(eq(intelligenceAlerts.alertType, alertType))
        .orderBy(desc(intelligenceAlerts.createdAt))
        .limit(limit);
    }
    return await db.select().from(intelligenceAlerts)
      .orderBy(desc(intelligenceAlerts.createdAt))
      .limit(limit);
  }

  async findRecentIntelligenceAlert(alertType: string, facilityCode?: string, withinHours: number = 24, testCode?: string): Promise<IntelligenceAlert | undefined> {
    const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);
    const conditions = [
      eq(intelligenceAlerts.alertType, alertType),
      sql`${intelligenceAlerts.createdAt} > ${cutoff}`,
    ];
    if (facilityCode) {
      conditions.push(eq(intelligenceAlerts.facilityCode, facilityCode));
    }
    if (testCode) {
      conditions.push(eq(intelligenceAlerts.testCode, testCode));
    }
    const [found] = await db.select().from(intelligenceAlerts)
      .where(and(...conditions))
      .limit(1);
    return found;
  }

  async acknowledgeIntelligenceAlert(id: number, acknowledgedBy: number): Promise<IntelligenceAlert | undefined> {
    const [updated] = await db.update(intelligenceAlerts)
      .set({ acknowledged: true, acknowledgedBy, acknowledgedAt: new Date() })
      .where(eq(intelligenceAlerts.id, id))
      .returning();
    return updated;
  }

  // === National Master Data: Tests ===

  async createNationalTest(test: InsertNationalTest): Promise<NationalTest> {
    const [created] = await db.insert(nationalTests).values(test).returning();
    return created;
  }

  async getNationalTests(status?: string): Promise<NationalTest[]> {
    if (status) {
      return await db.select().from(nationalTests)
        .where(eq(nationalTests.status, status))
        .orderBy(nationalTests.loincCode);
    }
    return await db.select().from(nationalTests).orderBy(nationalTests.loincCode);
  }

  async getNationalTestByLoinc(loincCode: string): Promise<NationalTest | undefined> {
    const [found] = await db.select().from(nationalTests)
      .where(eq(nationalTests.loincCode, loincCode));
    return found;
  }

  async updateNationalTest(id: number, data: Partial<InsertNationalTest>): Promise<NationalTest | undefined> {
    const [updated] = await db.update(nationalTests)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(nationalTests.id, id))
      .returning();
    return updated;
  }

  // === National Master Data: Analyzers ===

  async createNationalAnalyzer(analyzer: InsertNationalAnalyzer): Promise<NationalAnalyzer> {
    const [created] = await db.insert(nationalAnalyzers).values(analyzer).returning();
    return created;
  }

  async getNationalAnalyzers(status?: string): Promise<NationalAnalyzer[]> {
    if (status) {
      return await db.select().from(nationalAnalyzers)
        .where(eq(nationalAnalyzers.status, status))
        .orderBy(nationalAnalyzers.manufacturer);
    }
    return await db.select().from(nationalAnalyzers).orderBy(nationalAnalyzers.manufacturer);
  }

  async getNationalAnalyzerById(id: number): Promise<NationalAnalyzer | undefined> {
    const [found] = await db.select().from(nationalAnalyzers)
      .where(eq(nationalAnalyzers.id, id));
    return found;
  }

  async updateNationalAnalyzer(id: number, data: Partial<InsertNationalAnalyzer>): Promise<NationalAnalyzer | undefined> {
    const [updated] = await db.update(nationalAnalyzers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(nationalAnalyzers.id, id))
      .returning();
    return updated;
  }

  // === National Master Data: Roles ===

  async createNationalRole(role: InsertNationalRole): Promise<NationalRole> {
    const [created] = await db.insert(nationalRoles).values(role).returning();
    return created;
  }

  async getNationalRoles(status?: string): Promise<NationalRole[]> {
    if (status) {
      return await db.select().from(nationalRoles)
        .where(eq(nationalRoles.status, status))
        .orderBy(nationalRoles.roleCode);
    }
    return await db.select().from(nationalRoles).orderBy(nationalRoles.roleCode);
  }

  async getNationalRoleByCode(roleCode: string): Promise<NationalRole | undefined> {
    const [found] = await db.select().from(nationalRoles)
      .where(eq(nationalRoles.roleCode, roleCode));
    return found;
  }

  async updateNationalRole(id: number, data: Partial<InsertNationalRole>): Promise<NationalRole | undefined> {
    const [updated] = await db.update(nationalRoles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(nationalRoles.id, id))
      .returning();
    return updated;
  }

  // === National Master Data: Facilities ===

  async createNationalFacility(facility: InsertNationalFacility): Promise<NationalFacility> {
    const [created] = await db.insert(nationalFacilities).values(facility).returning();
    return created;
  }

  async getNationalFacilities(sector?: string, level?: string): Promise<NationalFacility[]> {
    const conditions = [];
    if (sector) conditions.push(eq(nationalFacilities.sector, sector));
    if (level) conditions.push(eq(nationalFacilities.level, level));
    if (conditions.length > 0) {
      return await db.select().from(nationalFacilities)
        .where(and(...conditions))
        .orderBy(nationalFacilities.facilityCode);
    }
    return await db.select().from(nationalFacilities).orderBy(nationalFacilities.facilityCode);
  }

  async getNationalFacilityByCode(facilityCode: string): Promise<NationalFacility | undefined> {
    const [found] = await db.select().from(nationalFacilities)
      .where(eq(nationalFacilities.facilityCode, facilityCode));
    return found;
  }

  async updateNationalFacility(id: number, data: Partial<InsertNationalFacility>): Promise<NationalFacility | undefined> {
    const [updated] = await db.update(nationalFacilities)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(nationalFacilities.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
