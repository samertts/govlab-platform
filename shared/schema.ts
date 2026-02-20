import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

// === TABLE DEFINITIONS ===

// Staff (Lab Staff - internal roles and identity)
export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  replitUserId: varchar("replit_user_id").unique(),
  username: text("username").notNull().unique(),
  role: text("role").notNull().default("technician"), // admin, pathologist, technician, receptionist
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Patients
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
  createdAt: timestamp("created_at").defaultNow(),
});

// Test Catalog (Available tests)
export const testTypes = pgTable("test_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  referenceRange: text("reference_range"),
  units: text("units"),
  turnaroundTime: integer("turnaround_time"),
  isActive: boolean("is_active").default(true),
});

// Samples / Accessions
export const samples = pgTable("samples", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  accessionNumber: text("accession_number").notNull().unique(),
  barcode: text("barcode").notNull().unique(),
  analyzerType: text("analyzer_type"),
  collectionDate: timestamp("collection_date").defaultNow(),
  status: text("status").notNull().default("collected"),
  priority: text("priority").default("routine"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Test Results
export const testResults = pgTable("test_results", {
  id: serial("id").primaryKey(),
  sampleId: integer("sample_id").notNull().references(() => samples.id),
  testTypeId: integer("test_type_id").notNull().references(() => testTypes.id),
  resultValue: text("result_value"),
  qcFlag: text("qc_flag"),
  status: text("status").notNull().default("pending"),
  enteredBy: integer("entered_by").references(() => staff.id),
  verifiedBy: integer("verified_by").references(() => staff.id),
  notes: text("notes"),
  performedAt: timestamp("performed_at"),
  verifiedAt: timestamp("verified_at"),
});

// Audit Logs
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => staff.id),
  testResultId: integer("test_result_id").notNull().references(() => testResults.id),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  action: text("action").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// === RELATIONS ===
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
  }),
  verifiedByStaff: one(staff, {
    fields: [testResults.verifiedBy],
    references: [staff.id],
  }),
}));

export const patientsRelations = relations(patients, ({ many }) => ({
  samples: many(samples),
}));

// === BASE SCHEMAS ===
export const insertStaffSchema = createInsertSchema(staff).omit({ id: true, createdAt: true });
export const insertPatientSchema = createInsertSchema(patients).omit({ id: true, createdAt: true });
export const insertTestTypeSchema = createInsertSchema(testTypes).omit({ id: true });
export const insertSampleSchema = createInsertSchema(samples).omit({ id: true, createdAt: true, accessionNumber: true, barcode: true });
export const insertTestResultSchema = createInsertSchema(testResults).omit({ id: true, enteredBy: true, verifiedBy: true, verifiedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });

// === EXPLICIT API CONTRACT TYPES ===

export type Staff = typeof staff.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type TestType = typeof testTypes.$inferSelect;
export type Sample = typeof samples.$inferSelect;
export type TestResult = typeof testResults.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertTestType = z.infer<typeof insertTestTypeSchema>;
export type InsertSample = z.infer<typeof insertSampleSchema>;
export type InsertTestResult = z.infer<typeof insertTestResultSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

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
