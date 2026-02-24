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
export const insertEventSchema = createInsertSchema(events).omit({ id: true, createdAt: true });
export const insertOfflineQueueSchema = createInsertSchema(offlineQueue).omit({ id: true, createdAt: true, processedAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });
export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({ id: true, createdAt: true });
export const insertNationalReportSchema = createInsertSchema(nationalReports).omit({ id: true, createdAt: true });
export const insertPolicySchema = createInsertSchema(policyEngine).omit({ id: true, createdAt: true });
export const insertNationalAccessAuditSchema = createInsertSchema(nationalAccessAudit).omit({ id: true, accessedAt: true });
export const insertIdentityVerificationSchema = createInsertSchema(identityVerifications).omit({ id: true, createdAt: true });

// === EXPLICIT API CONTRACT TYPES ===

export type Policy = typeof policyEngine.$inferSelect;
export type NationalAccessAuditEntry = typeof nationalAccessAudit.$inferSelect;
export type IdentityVerification = typeof identityVerifications.$inferSelect;
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
