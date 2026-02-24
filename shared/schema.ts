import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

// === SOVEREIGN PILOT: ORGANIZATION HIERARCHY ===

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  govCode: text("gov_code").unique(),
  type: text("type").notNull().default("government"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: text("address"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const labs = pgTable("labs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  labName: text("lab_name").notNull(),
  facilityCode: text("facility_code").notNull().unique(),
  address: text("address"),
  contactPhone: text("contact_phone"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const directorates = pgTable("directorates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  headName: text("head_name"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const facilities = pgTable("facilities", {
  id: serial("id").primaryKey(),
  directorateId: integer("directorate_id").notNull().references(() => directorates.id),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  type: text("type").notNull().default("laboratory"),
  address: text("address"),
  contactPhone: text("contact_phone"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SOVEREIGN PILOT: IDENTITY TOKENS ===

export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scope: text("scope").notNull().default("analyzer"),
  facilityId: integer("facility_id").references(() => facilities.id),
  labId: integer("lab_id").references(() => labs.id),
  issuedBy: integer("issued_by").references(() => staff.id),
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === CORE TABLES ===

export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  replitUserId: varchar("replit_user_id").unique(),
  username: text("username").notNull().unique(),
  role: text("role").notNull().default("technician"),
  name: text("name").notNull(),
  facilityId: integer("facility_id").references(() => facilities.id),
  labId: integer("lab_id").references(() => labs.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  mrn: text("mrn").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: timestamp("date_of_birth").notNull(),
  gender: text("gender").notNull(),
  contactNumber: text("contact_number"),
  email: text("email"),
  address: text("address"),
  nationalIdEncrypted: text("national_id_encrypted").unique(),
  facilityId: integer("facility_id").references(() => facilities.id),
  labId: integer("lab_id").references(() => labs.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const testTypes = pgTable("test_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  analyzerCategory: text("analyzer_category"),
  referenceRange: text("reference_range"),
  units: text("units"),
  turnaroundTime: integer("turnaround_time"),
  isActive: boolean("is_active").default(true),
});

export const samples = pgTable("samples", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  accessionNumber: text("accession_number").notNull().unique(),
  barcode: text("barcode").notNull().unique(),
  analyzerType: text("analyzer_type"),
  externalSampleId: text("external_sample_id"),
  facilityId: integer("facility_id").references(() => facilities.id),
  labId: integer("lab_id").references(() => labs.id),
  collectionDate: timestamp("collection_date").defaultNow(),
  status: text("status").notNull().default("collected"),
  priority: text("priority").default("routine"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const testResults = pgTable("test_results", {
  id: serial("id").primaryKey(),
  sampleId: integer("sample_id").notNull().references(() => samples.id),
  testTypeId: integer("test_type_id").notNull().references(() => testTypes.id),
  resultValue: text("result_value"),
  qcFlag: text("qc_flag"),
  status: text("status").notNull().default("pending"),
  enteredBy: integer("entered_by").references(() => staff.id),
  verifiedBy: integer("verified_by").references(() => staff.id),
  analyzerId: integer("analyzer_id"),
  facilityId: integer("facility_id").references(() => facilities.id),
  notes: text("notes"),
  performedAt: timestamp("performed_at"),
  verifiedAt: timestamp("verified_at"),
});

// === IMMUTABLE AUDIT LOG (hash-chained) ===

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => staff.id),
  testResultId: integer("test_result_id").references(() => testResults.id),
  eventType: text("event_type"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  action: text("action").notNull(),
  metadata: jsonb("metadata"),
  prevHash: text("prev_hash"),
  hash: text("hash"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// === SOVEREIGN PILOT: UNIFIED EVENT BUS ===

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  payload: jsonb("payload"),
  emittedBy: integer("emitted_by").references(() => staff.id),
  facilityId: integer("facility_id").references(() => facilities.id),
  labId: integer("lab_id").references(() => labs.id),
  executionContext: text("execution_context"),
  processedStatus: text("processed_status").notNull().default("pending"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SOVEREIGN PILOT: OFFLINE QUEUE ===

export const offlineQueue = pgTable("offline_queue", {
  id: serial("id").primaryKey(),
  operationType: text("operation_type").notNull(),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),
  payload: jsonb("payload"),
  staffId: integer("staff_id").references(() => staff.id),
  facilityId: integer("facility_id").references(() => facilities.id),
  status: text("status").notNull().default("pending"),
  retryCount: integer("retry_count").default(0),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SOVEREIGN PILOT: PRICING ENGINE ===

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  facilityId: integer("facility_id").references(() => facilities.id),
  invoiceNumber: text("invoice_number").notNull().unique(),
  totalAmount: integer("total_amount").notNull().default(0),
  discount: integer("discount").default(0),
  tax: integer("tax").default(0),
  netAmount: integer("net_amount").notNull().default(0),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  issuedAt: timestamp("issued_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  testResultId: integer("test_result_id").references(() => testResults.id),
  testTypeId: integer("test_type_id").notNull().references(() => testTypes.id),
  description: text("description").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull().default(1),
  lineTotal: integer("line_total").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// === NATIONAL CONTROL LAYER: AGGREGATED REPORTS ===

export const nationalReports = pgTable("national_reports", {
  id: serial("id").primaryKey(),
  reportType: text("report_type").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  labId: integer("lab_id").references(() => labs.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  metrics: jsonb("metrics").notNull(),
  generatedBy: integer("generated_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// === NATIONAL CLINICAL OVERSIGHT: POLICY ENGINE ===

export const policyEngine = pgTable("policy_engine", {
  id: serial("id").primaryKey(),
  testCode: text("test_code"),
  sector: text("sector").notNull().default("GOVERNMENT"),
  restrictionType: text("restriction_type").notNull(),
  ruleDurationDays: integer("rule_duration_days"),
  approvalRequired: boolean("approval_required").default(false),
  activeFlag: boolean("active_flag").default(true),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === NATIONAL CLINICAL OVERSIGHT: ACCESS AUDIT ===

export const nationalAccessAudit = pgTable("national_access_audit", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => staff.id),
  roleCode: text("role_code").notNull(),
  patientId: integer("patient_id").references(() => patients.id),
  labId: integer("lab_id").references(() => labs.id),
  reasonCode: text("reason_code").notNull(),
  accessScope: text("access_scope").notNull(),
  executionContext: text("execution_context").notNull(),
  metadata: jsonb("metadata"),
  accessedAt: timestamp("accessed_at").defaultNow().notNull(),
});

// === CLINICAL GOVERNANCE ENGINE: TEST POLICIES ===

export const testPolicies = pgTable("test_policies", {
  id: serial("id").primaryKey(),
  testCode: text("test_code"),
  sector: text("sector").notNull().default("GOVERNMENT"),
  ruleType: text("rule_type").notNull(),
  minIntervalDays: integer("min_interval_days"),
  requiresApproval: boolean("requires_approval").default(false),
  riskClass: text("risk_class").notNull().default("ADVISORY"),
  activeFlag: boolean("active_flag").default(true),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === CLINICAL GOVERNANCE ENGINE: GOVERNANCE EVENTS ===

export const governanceEvents = pgTable("governance_events", {
  id: serial("id").primaryKey(),
  specimenId: integer("specimen_id").references(() => samples.id),
  testCode: text("test_code").notNull(),
  policyId: integer("policy_id").references(() => testPolicies.id),
  evaluationResult: text("evaluation_result").notNull(),
  executionContext: text("execution_context").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === CLINICAL PATHWAYS ENGINE: PATHWAY DEFINITIONS ===

export const clinicalPathways = pgTable("clinical_pathways", {
  id: serial("id").primaryKey(),
  pathwayName: text("pathway_name").notNull(),
  triggerTest: text("trigger_test").notNull(),
  nextRecommendedTest: text("next_recommended_test").notNull(),
  sector: text("sector").notNull().default("GOVERNMENT"),
  conditionType: text("condition_type").notNull(),
  activeFlag: boolean("active_flag").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// === CLINICAL PATHWAYS ENGINE: PATHWAY RULES ===

export const pathwayRules = pgTable("pathway_rules", {
  id: serial("id").primaryKey(),
  testCode: text("test_code").notNull(),
  requiresPreviousTest: text("requires_previous_test"),
  timeWindowDays: integer("time_window_days"),
  suggestionLevel: text("suggestion_level").notNull().default("INFO"),
  riskClass: text("risk_class").notNull().default("ADVISORY"),
  activeFlag: boolean("active_flag").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// === CLINICAL PATHWAYS ENGINE: PATHWAY EVENTS ===

export const clinicalPathwayEvents = pgTable("clinical_pathway_events", {
  id: serial("id").primaryKey(),
  specimenId: integer("specimen_id").references(() => samples.id),
  pathwayId: integer("pathway_id").references(() => clinicalPathways.id),
  suggestionLevel: text("suggestion_level").notNull(),
  executionContext: text("execution_context").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SOVEREIGN IDENTITY: VERIFICATION RECORDS ===

export const identityVerifications = pgTable("identity_verifications", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  nationalIdHash: text("national_id_hash").notNull(),
  verificationStatus: text("verification_status").notNull().default("PENDING"),
  verificationSource: text("verification_source").notNull().default("MOCK_GATEWAY"),
  executionContext: text("execution_context").notNull(),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === EVENT-DRIVEN PROCESSING: READ MODELS ===

export const worklistView = pgTable("worklist_view", {
  id: serial("id").primaryKey(),
  labId: integer("lab_id").references(() => labs.id),
  sampleId: integer("sample_id").references(() => samples.id),
  patientId: integer("patient_id").references(() => patients.id),
  sampleStatus: text("sample_status"),
  pendingTestCount: integer("pending_test_count").default(0),
  enteredTestCount: integer("entered_test_count").default(0),
  verifiedTestCount: integer("verified_test_count").default(0),
  priority: text("priority"),
  lastEventType: text("last_event_type"),
  lastEventAt: timestamp("last_event_at"),
  projectedAt: timestamp("projected_at").defaultNow(),
});

export const nationalMetricsView = pgTable("national_metrics_view", {
  id: serial("id").primaryKey(),
  labId: integer("lab_id").references(() => labs.id),
  metricType: text("metric_type").notNull(),
  metricValue: integer("metric_value").notNull().default(0),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  metadata: jsonb("metadata"),
  projectedAt: timestamp("projected_at").defaultNow(),
});

export const suggestionStreamView = pgTable("suggestion_stream_view", {
  id: serial("id").primaryKey(),
  labId: integer("lab_id").references(() => labs.id),
  sourceEngine: text("source_engine").notNull(),
  sourceEventId: integer("source_event_id"),
  suggestionLevel: text("suggestion_level").notNull(),
  testCode: text("test_code"),
  patientId: integer("patient_id").references(() => patients.id),
  specimenId: integer("specimen_id").references(() => samples.id),
  summary: text("summary"),
  metadata: jsonb("metadata"),
  projectedAt: timestamp("projected_at").defaultNow(),
});

// === UNIFIED SUGGESTION ORCHESTRATOR ===

export const unifiedSuggestionStream = pgTable("unified_suggestion_stream", {
  id: serial("id").primaryKey(),
  labId: integer("lab_id").references(() => labs.id),
  sourceEngine: text("source_engine").notNull(),
  sourceEventId: integer("source_event_id"),
  priorityTier: text("priority_tier").notNull(),
  suggestionLevel: text("suggestion_level").notNull(),
  testCode: text("test_code"),
  patientId: integer("patient_id").references(() => patients.id),
  specimenId: integer("specimen_id").references(() => samples.id),
  summary: text("summary").notNull(),
  deduplicationKey: text("deduplication_key"),
  executionContext: text("execution_context"),
  metadata: jsonb("metadata"),
  emittedAt: timestamp("emitted_at").defaultNow(),
});

// === NOTIFICATION ENGINE ===

export const notificationTemplates = pgTable("notification_templates", {
  id: serial("id").primaryKey(),
  templateCode: text("template_code").notNull().unique(),
  eventType: text("event_type").notNull(),
  titleTemplate: text("title_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
  notificationType: text("notification_type").notNull().default("INFO"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notificationEvents = pgTable("notification_events", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id),
  templateId: integer("template_id").references(() => notificationTemplates.id),
  resolvedTitle: text("resolved_title").notNull(),
  resolvedBody: text("resolved_body").notNull(),
  targetUserId: integer("target_user_id").references(() => staff.id),
  notificationType: text("notification_type").notNull().default("INFO"),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const deliveryLogs = pgTable("delivery_logs", {
  id: serial("id").primaryKey(),
  notificationEventId: integer("notification_event_id").references(() => notificationEvents.id),
  channel: text("channel").notNull().default("in_app"),
  status: text("status").notNull().default("delivered"),
  attemptCount: integer("attempt_count").default(1),
  lastAttemptAt: timestamp("last_attempt_at").defaultNow(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => staff.id),
  message: text("message").notNull(),
  notificationType: text("notification_type").notNull().default("INFO"),
  entityRef: text("entity_ref"),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// === ASYNCHRONOUS CLINICAL GOVERNANCE: JOB MODEL ===

export const governanceJobs = pgTable("governance_jobs", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id"),
  jobType: varchar("job_type", { length: 50 }).notNull(),
  jobSource: varchar("job_source", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  retryCount: integer("retry_count").default(0),
  executionContext: varchar("execution_context", { length: 50 }),
  labId: integer("lab_id"),
  testCode: varchar("test_code", { length: 100 }),
  patientId: integer("patient_id"),
  specimenId: integer("specimen_id"),
  payload: jsonb("payload"),
  result: jsonb("result"),
  errorDetail: text("error_detail"),
  createdAt: timestamp("created_at").defaultNow(),
  processedAt: timestamp("processed_at"),
});

export const insertGovernanceJobSchema = createInsertSchema(governanceJobs).omit({ id: true, createdAt: true, processedAt: true });
export type InsertGovernanceJob = z.infer<typeof insertGovernanceJobSchema>;
export type GovernanceJob = typeof governanceJobs.$inferSelect;

// === INSTRUMENT STREAMING GATEWAY: ANALYZERS ===

export const analyzers = pgTable("analyzers", {
  id: serial("id").primaryKey(),
  analyzerId: varchar("analyzer_id", { length: 100 }).notNull().unique(),
  facilityCode: varchar("facility_code", { length: 100 }).notNull(),
  analyzerType: varchar("analyzer_type", { length: 100 }).notNull(),
  analyzerTokenHash: text("analyzer_token_hash").notNull().unique(),
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const analyzerEventQueue = pgTable("analyzer_event_queue", {
  id: serial("id").primaryKey(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  analyzerId: varchar("analyzer_id", { length: 100 }).notNull(),
  messageHash: varchar("message_hash", { length: 64 }).notNull(),
  payload: jsonb("payload"),
  processedStatus: varchar("processed_status", { length: 30 }).notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  errorDetail: text("error_detail"),
  labId: integer("lab_id"),
  createdAt: timestamp("created_at").defaultNow(),
  processedAt: timestamp("processed_at"),
}, (table) => []);

// === HOT VS COLD DATA ARCHITECTURE ===

export const resultsHot = pgTable("results_hot", {
  id: serial("id").primaryKey(),
  resultId: integer("result_id").notNull(),
  specimenId: integer("specimen_id").notNull(),
  patientId: integer("patient_id").notNull(),
  labId: integer("lab_id"),
  testCode: varchar("test_code", { length: 100 }).notNull(),
  resultValue: text("result_value"),
  resultStatus: varchar("result_status", { length: 30 }).notNull().default("pending"),
  sourceType: varchar("source_type", { length: 30 }).notNull().default("MANUAL"),
  sourceId: varchar("source_id", { length: 200 }),
  enteredBy: integer("entered_by"),
  enteredAt: timestamp("entered_at").defaultNow(),
  verifiedBy: integer("verified_by"),
  verifiedAt: timestamp("verified_at"),
  ingestionMethod: varchar("ingestion_method", { length: 50 }),
  amendmentChainRef: integer("amendment_chain_ref"),
  provenanceJson: jsonb("provenance_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const resultsArchive = pgTable("results_archive", {
  id: serial("id").primaryKey(),
  resultId: integer("result_id").notNull(),
  specimenId: integer("specimen_id").notNull(),
  patientId: integer("patient_id").notNull(),
  labId: integer("lab_id"),
  testCode: varchar("test_code", { length: 100 }).notNull(),
  resultValue: text("result_value"),
  resultStatus: varchar("result_status", { length: 30 }).notNull().default("pending"),
  createdAt: timestamp("created_at"),
  verifiedAt: timestamp("verified_at"),
  archivedAt: timestamp("archived_at").defaultNow(),
});

export const patientHistorySummary = pgTable("patient_history_summary", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  labId: integer("lab_id"),
  totalTests: integer("total_tests").notNull().default(0),
  lastTestDate: timestamp("last_test_date"),
  chronicFlags: jsonb("chronic_flags"),
  riskMarkers: jsonb("risk_markers"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// === RUNTIME SECURITY: SESSION GUARDRAILS ===

export const securityEvents = pgTable("security_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => staff.id),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull().default("LOW"),
  details: jsonb("details"),
  actionTaken: text("action_taken"),
  sessionId: text("session_id"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === ZERO-TRUST SECURITY ARCHITECTURE ===

export const zeroTrustIdentities = pgTable("zero_trust_identities", {
  id: serial("id").primaryKey(),
  identityUuid: varchar("identity_uuid", { length: 64 }).notNull().unique(),
  identityType: varchar("identity_type", { length: 30 }).notNull(),
  entityRef: integer("entity_ref"),
  signedTokenHash: text("signed_token_hash").notNull(),
  facilityScope: varchar("facility_scope", { length: 200 }),
  roleScope: varchar("role_scope", { length: 100 }),
  tokenStatus: varchar("token_status", { length: 20 }).notNull().default("ACTIVE"),
  issuedAt: timestamp("issued_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  rotatedFrom: varchar("rotated_from", { length: 64 }),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const securityQuarantineQueue = pgTable("security_quarantine_queue", {
  id: serial("id").primaryKey(),
  originalEventId: integer("original_event_id"),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  payload: jsonb("payload"),
  quarantineReason: varchar("quarantine_reason", { length: 200 }).notNull(),
  signatureHash: varchar("signature_hash", { length: 128 }),
  issuerIdentity: varchar("issuer_identity", { length: 64 }),
  severity: varchar("severity", { length: 20 }).notNull().default("HIGH"),
  reviewStatus: varchar("review_status", { length: 20 }).notNull().default("PENDING"),
  reviewedBy: integer("reviewed_by").references(() => staff.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const nationalAuditTrail = pgTable("national_audit_trail", {
  id: serial("id").primaryKey(),
  identityUuid: varchar("identity_uuid", { length: 64 }).notNull(),
  actionType: varchar("action_type", { length: 100 }).notNull(),
  entityRef: text("entity_ref"),
  facilityScope: varchar("facility_scope", { length: 200 }),
  reasonCode: varchar("reason_code", { length: 100 }),
  accessOrigin: varchar("access_origin", { length: 200 }),
  reviewFlag: boolean("review_flag").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === DISASTER-PROOF OFFLINE ARCHITECTURE: LOCAL SYNC EVENTS ===

export const localSyncEvents = pgTable("local_sync_events", {
  id: serial("id").primaryKey(),
  eventUuid: varchar("event_uuid", { length: 64 }).notNull().unique(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  facilityCode: varchar("facility_code", { length: 100 }).notNull(),
  payload: jsonb("payload"),
  executionContext: varchar("execution_context", { length: 50 }),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default("PENDING"),
  retryCount: integer("retry_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  errorDetail: text("error_detail"),
  advisoryOriginFlag: boolean("advisory_origin_flag").default(false),
  sourceType: varchar("source_type", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// === DISASTER-PROOF OFFLINE ARCHITECTURE: SYNC CONFLICT POLICY ===

export const syncConflictPolicy = pgTable("sync_conflict_policy", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  priorityOrder: varchar("priority_order", { length: 200 }).notNull().default("LOCAL_LAB,DIRECTORATE,NATIONAL"),
  mergeStrategy: varchar("merge_strategy", { length: 50 }).notNull().default("LAST_WRITE_WINS"),
  retentionDays: integer("retention_days").notNull().default(365),
  activeFlag: boolean("active_flag").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// === DISASTER-PROOF OFFLINE ARCHITECTURE: CONFLICT AUDIT LOG ===

export const conflictAuditLog = pgTable("conflict_audit_log", {
  id: serial("id").primaryKey(),
  syncEventId: integer("sync_event_id").references(() => localSyncEvents.id),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: integer("entity_id"),
  facilityCode: varchar("facility_code", { length: 100 }).notNull(),
  localVersion: jsonb("local_version"),
  remoteVersion: jsonb("remote_version"),
  resolutionStatus: varchar("resolution_status", { length: 30 }).notNull().default("REVIEW_REQUIRED"),
  resolvedBy: integer("resolved_by").references(() => staff.id),
  resolvedAt: timestamp("resolved_at"),
  mergeStrategyApplied: varchar("merge_strategy_applied", { length: 50 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === DISASTER-PROOF OFFLINE ARCHITECTURE: FACILITY CONNECTIVITY STATUS ===

export const facilityConnectivityStatus = pgTable("facility_connectivity_status", {
  id: serial("id").primaryKey(),
  facilityCode: varchar("facility_code", { length: 100 }).notNull().unique(),
  lastSyncAt: timestamp("last_sync_at"),
  onlineStatus: varchar("online_status", { length: 20 }).notNull().default("UNKNOWN"),
  syncLatencyMs: integer("sync_latency_ms"),
  pendingEventCount: integer("pending_event_count").default(0),
  lastErrorAt: timestamp("last_error_at"),
  metadata: jsonb("metadata"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// === RELATIONS ===

export const organizationsRelations = relations(organizations, ({ many }) => ({
  directorates: many(directorates),
  labs: many(labs),
}));

export const labsRelations = relations(labs, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [labs.organizationId],
    references: [organizations.id],
  }),
}));

export const directoratesRelations = relations(directorates, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [directorates.organizationId],
    references: [organizations.id],
  }),
  facilities: many(facilities),
}));

export const facilitiesRelations = relations(facilities, ({ one }) => ({
  directorate: one(directorates, {
    fields: [facilities.directorateId],
    references: [directorates.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  staffMember: one(staff, {
    fields: [auditLogs.userId],
    references: [staff.id],
  }),
  testResult: one(testResults, {
    fields: [auditLogs.testResultId],
    references: [testResults.id],
  }),
}));

export const samplesRelations = relations(samples, ({ one, many }) => ({
  patient: one(patients, {
    fields: [samples.patientId],
    references: [patients.id],
  }),
  facility: one(facilities, {
    fields: [samples.facilityId],
    references: [facilities.id],
  }),
  lab: one(labs, {
    fields: [samples.labId],
    references: [labs.id],
  }),
  results: many(testResults),
}));

export const testResultsRelations = relations(testResults, ({ one }) => ({
  sample: one(samples, {
    fields: [testResults.sampleId],
    references: [samples.id],
  }),
  testType: one(testTypes, {
    fields: [testResults.testTypeId],
    references: [testTypes.id],
  }),
  enteredByStaff: one(staff, {
    fields: [testResults.enteredBy],
    references: [staff.id],
    relationName: "enteredBy",
  }),
  verifiedByStaff: one(staff, {
    fields: [testResults.verifiedBy],
    references: [staff.id],
    relationName: "verifiedBy",
  }),
  facility: one(facilities, {
    fields: [testResults.facilityId],
    references: [facilities.id],
  }),
}));

export const patientsRelations = relations(patients, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [patients.facilityId],
    references: [facilities.id],
  }),
  lab: one(labs, {
    fields: [patients.labId],
    references: [labs.id],
  }),
  samples: many(samples),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  patient: one(patients, {
    fields: [invoices.patientId],
    references: [patients.id],
  }),
  items: many(invoiceItems),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
  testType: one(testTypes, {
    fields: [invoiceItems.testTypeId],
    references: [testTypes.id],
  }),
  testResult: one(testResults, {
    fields: [invoiceItems.testResultId],
    references: [testResults.id],
  }),
}));

// === BASE SCHEMAS ===
export const insertLabSchema = createInsertSchema(labs).omit({ id: true, createdAt: true });
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertDirectorateSchema = createInsertSchema(directorates).omit({ id: true, createdAt: true });
export const insertFacilitySchema = createInsertSchema(facilities).omit({ id: true, createdAt: true });
export const insertApiTokenSchema = createInsertSchema(apiTokens).omit({ id: true, createdAt: true, lastUsedAt: true });
export const insertStaffSchema = createInsertSchema(staff).omit({ id: true, createdAt: true });
export const insertPatientSchema = createInsertSchema(patients).omit({ id: true, createdAt: true });
export const insertTestTypeSchema = createInsertSchema(testTypes).omit({ id: true });
export const insertSampleSchema = createInsertSchema(samples).omit({ id: true, createdAt: true, accessionNumber: true, barcode: true });
export const insertTestResultSchema = createInsertSchema(testResults).omit({ id: true, enteredBy: true, verifiedBy: true, verifiedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true, createdAt: true, processedAt: true });
export const insertOfflineQueueSchema = createInsertSchema(offlineQueue).omit({ id: true, createdAt: true, processedAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });
export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({ id: true, createdAt: true });
export const insertNationalReportSchema = createInsertSchema(nationalReports).omit({ id: true, createdAt: true });
export const insertPolicySchema = createInsertSchema(policyEngine).omit({ id: true, createdAt: true });
export const insertNationalAccessAuditSchema = createInsertSchema(nationalAccessAudit).omit({ id: true, accessedAt: true });
export const insertIdentityVerificationSchema = createInsertSchema(identityVerifications).omit({ id: true, createdAt: true });
export const insertTestPolicySchema = createInsertSchema(testPolicies).omit({ id: true, createdAt: true });
export const insertGovernanceEventSchema = createInsertSchema(governanceEvents).omit({ id: true, createdAt: true });
export const insertClinicalPathwaySchema = createInsertSchema(clinicalPathways).omit({ id: true, createdAt: true });
export const insertPathwayRuleSchema = createInsertSchema(pathwayRules).omit({ id: true, createdAt: true });
export const insertClinicalPathwayEventSchema = createInsertSchema(clinicalPathwayEvents).omit({ id: true, createdAt: true });
export const insertWorklistViewSchema = createInsertSchema(worklistView).omit({ id: true, projectedAt: true });
export const insertNationalMetricsViewSchema = createInsertSchema(nationalMetricsView).omit({ id: true, projectedAt: true });
export const insertSuggestionStreamViewSchema = createInsertSchema(suggestionStreamView).omit({ id: true, projectedAt: true });
export const insertUnifiedSuggestionSchema = createInsertSchema(unifiedSuggestionStream).omit({ id: true, emittedAt: true });
export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({ id: true, createdAt: true });
export const insertNotificationEventSchema = createInsertSchema(notificationEvents).omit({ id: true, createdAt: true });
export const insertDeliveryLogSchema = createInsertSchema(deliveryLogs).omit({ id: true, createdAt: true });
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export const insertSecurityEventSchema = createInsertSchema(securityEvents).omit({ id: true, createdAt: true });
export const insertAnalyzerSchema = createInsertSchema(analyzers).omit({ id: true, createdAt: true, lastUsedAt: true });
export const insertAnalyzerEventQueueSchema = createInsertSchema(analyzerEventQueue).omit({ id: true, createdAt: true, processedAt: true });
export const insertResultsHotSchema = createInsertSchema(resultsHot).omit({ id: true, createdAt: true });
export const insertResultsArchiveSchema = createInsertSchema(resultsArchive).omit({ id: true, archivedAt: true });
export const insertPatientHistorySummarySchema = createInsertSchema(patientHistorySummary).omit({ id: true, updatedAt: true });
export const insertZeroTrustIdentitySchema = createInsertSchema(zeroTrustIdentities).omit({ id: true, createdAt: true, issuedAt: true, lastUsedAt: true });
export const insertSecurityQuarantineSchema = createInsertSchema(securityQuarantineQueue).omit({ id: true, createdAt: true, reviewedAt: true });
export const insertNationalAuditTrailSchema = createInsertSchema(nationalAuditTrail).omit({ id: true, createdAt: true });
export const insertLocalSyncEventSchema = createInsertSchema(localSyncEvents).omit({ id: true, createdAt: true });
export const insertSyncConflictPolicySchema = createInsertSchema(syncConflictPolicy).omit({ id: true, createdAt: true });
export const insertConflictAuditLogSchema = createInsertSchema(conflictAuditLog).omit({ id: true, createdAt: true });
export const insertFacilityConnectivityStatusSchema = createInsertSchema(facilityConnectivityStatus).omit({ id: true, updatedAt: true });

// === AI-ASSISTED CLINICAL INTELLIGENCE LAYER: INTELLIGENCE EVENTS ===

export const intelligenceEvents = pgTable("intelligence_events", {
  id: serial("id").primaryKey(),
  sourceEventId: integer("source_event_id").references(() => events.id),
  sourceEventType: varchar("source_event_type", { length: 100 }).notNull(),
  eventLane: varchar("event_lane", { length: 30 }).notNull().default("INTELLIGENCE"),
  testCode: varchar("test_code", { length: 100 }),
  facilityCode: varchar("facility_code", { length: 100 }),
  sector: varchar("sector", { length: 100 }),
  anonymizedPayload: jsonb("anonymized_payload"),
  processingStatus: varchar("processing_status", { length: 30 }).notNull().default("PENDING"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === AI-ASSISTED CLINICAL INTELLIGENCE LAYER: ANONYMIZED METRICS ===

export const anonymizedMetrics = pgTable("anonymized_metrics", {
  metricId: serial("metric_id").primaryKey(),
  testCode: varchar("test_code", { length: 100 }).notNull(),
  facilityCode: varchar("facility_code", { length: 100 }).notNull(),
  sector: varchar("sector", { length: 100 }),
  timestampBucket: timestamp("timestamp_bucket").notNull(),
  count: integer("count").notNull().default(0),
  aggregationLevel: varchar("aggregation_level", { length: 30 }).notNull().default("HOURLY"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === AI-ASSISTED CLINICAL INTELLIGENCE LAYER: INTELLIGENCE ALERTS ===

export const intelligenceAlerts = pgTable("intelligence_alerts", {
  id: serial("id").primaryKey(),
  alertType: varchar("alert_type", { length: 50 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull().default("ADVISORY"),
  facilityCode: varchar("facility_code", { length: 100 }),
  sector: varchar("sector", { length: 100 }),
  testCode: varchar("test_code", { length: 100 }),
  title: text("title").notNull(),
  description: text("description"),
  payload: jsonb("payload"),
  classification: varchar("classification", { length: 50 }).notNull().default("CLINICAL_SUGGESTION"),
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedBy: integer("acknowledged_by").references(() => staff.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertIntelligenceEventSchema = createInsertSchema(intelligenceEvents).omit({ id: true, createdAt: true, processedAt: true });
export const insertAnonymizedMetricSchema = createInsertSchema(anonymizedMetrics).omit({ metricId: true, createdAt: true });
export const insertIntelligenceAlertSchema = createInsertSchema(intelligenceAlerts).omit({ id: true, createdAt: true, acknowledgedAt: true });

// === NATIONAL MASTER DATA MODEL ===

export const nationalTests = pgTable("national_tests", {
  id: serial("id").primaryKey(),
  loincCode: varchar("loinc_code", { length: 50 }).notNull().unique(),
  testNameAr: text("test_name_ar").notNull(),
  testNameEn: text("test_name_en").notNull(),
  analyzerType: varchar("analyzer_type", { length: 100 }),
  unitStandard: varchar("unit_standard", { length: 50 }),
  versionCode: varchar("version_code", { length: 30 }).notNull().default("1.0.0"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  signatureField: text("signature_field"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const nationalAnalyzers = pgTable("national_analyzers", {
  id: serial("id").primaryKey(),
  manufacturer: varchar("manufacturer", { length: 200 }).notNull(),
  model: varchar("model", { length: 200 }).notNull(),
  supportedTests: text("supported_tests").array(),
  versionCode: varchar("version_code", { length: 30 }).notNull().default("1.0.0"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  signatureField: text("signature_field"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const nationalRoles = pgTable("national_roles", {
  id: serial("id").primaryKey(),
  roleCode: varchar("role_code", { length: 50 }).notNull().unique(),
  permissionsScope: jsonb("permissions_scope").notNull(),
  versionCode: varchar("version_code", { length: 30 }).notNull().default("1.0.0"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  signatureField: text("signature_field"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const nationalFacilities = pgTable("national_facilities", {
  id: serial("id").primaryKey(),
  facilityCode: varchar("facility_code", { length: 100 }).notNull().unique(),
  sector: varchar("sector", { length: 30 }).notNull().default("GOVERNMENT"),
  governorate: varchar("governorate", { length: 200 }),
  level: varchar("level", { length: 30 }).notNull().default("LAB"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  signatureField: text("signature_field"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNationalTestSchema = createInsertSchema(nationalTests).omit({ id: true, createdAt: true, updatedAt: true });
export const insertNationalAnalyzerSchema = createInsertSchema(nationalAnalyzers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertNationalRoleSchema = createInsertSchema(nationalRoles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertNationalFacilitySchema = createInsertSchema(nationalFacilities).omit({ id: true, createdAt: true, updatedAt: true });

// === EXPLICIT API CONTRACT TYPES ===

export type Policy = typeof policyEngine.$inferSelect;
export type NationalAccessAuditEntry = typeof nationalAccessAudit.$inferSelect;
export type IdentityVerification = typeof identityVerifications.$inferSelect;
export type TestPolicy = typeof testPolicies.$inferSelect;
export type GovernanceEvent = typeof governanceEvents.$inferSelect;
export type ClinicalPathway = typeof clinicalPathways.$inferSelect;
export type PathwayRule = typeof pathwayRules.$inferSelect;
export type ClinicalPathwayEvent = typeof clinicalPathwayEvents.$inferSelect;
export type NationalReport = typeof nationalReports.$inferSelect;
export type Lab = typeof labs.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Directorate = typeof directorates.$inferSelect;
export type Facility = typeof facilities.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type TestType = typeof testTypes.$inferSelect;
export type Sample = typeof samples.$inferSelect;
export type TestResult = typeof testResults.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Event = typeof events.$inferSelect;
export type OfflineQueueItem = typeof offlineQueue.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type WorklistViewEntry = typeof worklistView.$inferSelect;
export type NationalMetricsViewEntry = typeof nationalMetricsView.$inferSelect;
export type SuggestionStreamViewEntry = typeof suggestionStreamView.$inferSelect;
export type UnifiedSuggestion = typeof unifiedSuggestionStream.$inferSelect;
export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type NotificationEvent = typeof notificationEvents.$inferSelect;
export type DeliveryLog = typeof deliveryLogs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type Analyzer = typeof analyzers.$inferSelect;
export type AnalyzerEventQueueEntry = typeof analyzerEventQueue.$inferSelect;
export type ResultHot = typeof resultsHot.$inferSelect;
export type ResultArchive = typeof resultsArchive.$inferSelect;
export type PatientHistorySummaryEntry = typeof patientHistorySummary.$inferSelect;
export type ZeroTrustIdentity = typeof zeroTrustIdentities.$inferSelect;
export type SecurityQuarantineEntry = typeof securityQuarantineQueue.$inferSelect;
export type NationalAuditTrailEntry = typeof nationalAuditTrail.$inferSelect;
export type LocalSyncEvent = typeof localSyncEvents.$inferSelect;
export type SyncConflictPolicyEntry = typeof syncConflictPolicy.$inferSelect;
export type ConflictAuditLogEntry = typeof conflictAuditLog.$inferSelect;
export type FacilityConnectivityStatusEntry = typeof facilityConnectivityStatus.$inferSelect;
export type IntelligenceEvent = typeof intelligenceEvents.$inferSelect;
export type AnonymizedMetric = typeof anonymizedMetrics.$inferSelect;
export type IntelligenceAlert = typeof intelligenceAlerts.$inferSelect;
export type NationalTest = typeof nationalTests.$inferSelect;
export type NationalAnalyzer = typeof nationalAnalyzers.$inferSelect;
export type NationalRole = typeof nationalRoles.$inferSelect;
export type NationalFacility = typeof nationalFacilities.$inferSelect;

export type InsertLab = z.infer<typeof insertLabSchema>;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type InsertDirectorate = z.infer<typeof insertDirectorateSchema>;
export type InsertFacility = z.infer<typeof insertFacilitySchema>;
export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertTestType = z.infer<typeof insertTestTypeSchema>;
export type InsertSample = z.infer<typeof insertSampleSchema>;
export type InsertTestResult = z.infer<typeof insertTestResultSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertOfflineQueueItem = z.infer<typeof insertOfflineQueueSchema>;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InsertNationalReport = z.infer<typeof insertNationalReportSchema>;
export type InsertPolicy = z.infer<typeof insertPolicySchema>;
export type InsertNationalAccessAudit = z.infer<typeof insertNationalAccessAuditSchema>;
export type InsertIdentityVerification = z.infer<typeof insertIdentityVerificationSchema>;
export type InsertTestPolicy = z.infer<typeof insertTestPolicySchema>;
export type InsertGovernanceEvent = z.infer<typeof insertGovernanceEventSchema>;
export type InsertClinicalPathway = z.infer<typeof insertClinicalPathwaySchema>;
export type InsertPathwayRule = z.infer<typeof insertPathwayRuleSchema>;
export type InsertClinicalPathwayEvent = z.infer<typeof insertClinicalPathwayEventSchema>;
export type InsertWorklistView = z.infer<typeof insertWorklistViewSchema>;
export type InsertNationalMetricsView = z.infer<typeof insertNationalMetricsViewSchema>;
export type InsertSuggestionStreamView = z.infer<typeof insertSuggestionStreamViewSchema>;
export type InsertUnifiedSuggestion = z.infer<typeof insertUnifiedSuggestionSchema>;
export type InsertNotificationTemplate = z.infer<typeof insertNotificationTemplateSchema>;
export type InsertNotificationEvent = z.infer<typeof insertNotificationEventSchema>;
export type InsertDeliveryLog = z.infer<typeof insertDeliveryLogSchema>;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type InsertAnalyzer = z.infer<typeof insertAnalyzerSchema>;
export type InsertAnalyzerEventQueue = z.infer<typeof insertAnalyzerEventQueueSchema>;
export type InsertResultHot = z.infer<typeof insertResultsHotSchema>;
export type InsertResultArchive = z.infer<typeof insertResultsArchiveSchema>;
export type InsertPatientHistorySummary = z.infer<typeof insertPatientHistorySummarySchema>;
export type InsertZeroTrustIdentity = z.infer<typeof insertZeroTrustIdentitySchema>;
export type InsertSecurityQuarantine = z.infer<typeof insertSecurityQuarantineSchema>;
export type InsertNationalAuditTrail = z.infer<typeof insertNationalAuditTrailSchema>;
export type InsertLocalSyncEvent = z.infer<typeof insertLocalSyncEventSchema>;
export type InsertSyncConflictPolicy = z.infer<typeof insertSyncConflictPolicySchema>;
export type InsertConflictAuditLog = z.infer<typeof insertConflictAuditLogSchema>;
export type InsertFacilityConnectivityStatus = z.infer<typeof insertFacilityConnectivityStatusSchema>;
export type InsertIntelligenceEvent = z.infer<typeof insertIntelligenceEventSchema>;
export type InsertAnonymizedMetric = z.infer<typeof insertAnonymizedMetricSchema>;
export type InsertIntelligenceAlert = z.infer<typeof insertIntelligenceAlertSchema>;
export type InsertNationalTest = z.infer<typeof insertNationalTestSchema>;
export type InsertNationalAnalyzer = z.infer<typeof insertNationalAnalyzerSchema>;
export type InsertNationalRole = z.infer<typeof insertNationalRoleSchema>;
export type InsertNationalFacility = z.infer<typeof insertNationalFacilitySchema>;

// Request types
export type CreatePatientRequest = InsertPatient;
export type UpdatePatientRequest = Partial<InsertPatient>;

export type CreateSampleRequest = InsertSample & {
  testTypeIds: number[];
};
export type UpdateSampleRequest = Partial<InsertSample>;

export type EnterResultRequest = {
  resultValue: string;
  notes?: string;
};

export type VerifyResultRequest = {
  verified: boolean;
};

// Response types extended with relations
export type SampleWithPatient = Sample & {
  patient: Patient;
  results: (TestResult & { testType: TestType })[];
};

export type TestResultWithDetails = TestResult & {
  testType: TestType;
  sample: Sample & { patient: Patient };
};

export type LabWithOrganization = Lab & {
  organization: Organization;
};

export type DirectorateWithFacilities = Directorate & {
  facilities: Facility[];
};

export type OrganizationWithHierarchy = Organization & {
  directorates: (Directorate & { facilities: Facility[] })[];
};

export type InvoiceWithItems = Invoice & {
  patient: Patient;
  items: (InvoiceItem & { testType: TestType })[];
};
