import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

// Users (Lab Staff)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(), // Hashed password
  role: text("role").notNull().default("technician"), // admin, pathologist, technician, receptionist
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Patients
export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  mrn: text("mrn").notNull().unique(), // Medical Record Number
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
  code: text("code").notNull().unique(), // e.g., CBC, GLU
  name: text("name").notNull(), // e.g., Complete Blood Count
  price: integer("price").notNull(), // In cents
  referenceRange: text("reference_range"), // General reference range text
  units: text("units"),
  turnaroundTime: integer("turnaround_time"), // In hours
  isActive: boolean("is_active").default(true),
});

// Samples / Accessions
export const samples = pgTable("samples", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  accessionNumber: text("accession_number").notNull().unique(), // Unique daily ID
  collectionDate: timestamp("collection_date").defaultNow(),
  status: text("status").notNull().default("collected"), // collected, received, processing, completed, reported
  priority: text("priority").default("routine"), // routine, urgent, stat
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Test Results
export const testResults = pgTable("test_results", {
  id: serial("id").primaryKey(),
  sampleId: integer("sample_id").notNull().references(() => samples.id),
  testTypeId: integer("test_type_id").notNull().references(() => testTypes.id),
  resultValue: text("result_value"),
  status: text("status").notNull().default("pending"), // pending, entered, verified
  enteredBy: integer("entered_by").references(() => users.id),
  verifiedBy: integer("verified_by").references(() => users.id),
  notes: text("notes"),
  performedAt: timestamp("performed_at"),
  verifiedAt: timestamp("verified_at"),
});

// === RELATIONS ===
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
  enteredByUser: one(users, {
    fields: [testResults.enteredBy],
    references: [users.id],
  }),
  verifiedByUser: one(users, {
    fields: [testResults.verifiedBy],
    references: [users.id],
  }),
}));

export const patientsRelations = relations(patients, ({ many }) => ({
  samples: many(samples),
}));

// === BASE SCHEMAS ===
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertPatientSchema = createInsertSchema(patients).omit({ id: true, createdAt: true });
export const insertTestTypeSchema = createInsertSchema(testTypes).omit({ id: true });
export const insertSampleSchema = createInsertSchema(samples).omit({ id: true, createdAt: true, accessionNumber: true }); // Accession generated backend
export const insertTestResultSchema = createInsertSchema(testResults).omit({ id: true, enteredBy: true, verifiedBy: true, verifiedAt: true });

// === EXPLICIT API CONTRACT TYPES ===

export type User = typeof users.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type TestType = typeof testTypes.$inferSelect;
export type Sample = typeof samples.$inferSelect;
export type TestResult = typeof testResults.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertTestType = z.infer<typeof insertTestTypeSchema>;
export type InsertSample = z.infer<typeof insertSampleSchema>;
export type InsertTestResult = z.infer<typeof insertTestResultSchema>;

// Request types
export type CreatePatientRequest = InsertPatient;
export type UpdatePatientRequest = Partial<InsertPatient>;

export type CreateSampleRequest = InsertSample & {
  testTypeIds: number[]; // Create results placeholders
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
