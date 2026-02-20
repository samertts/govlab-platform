import { z } from 'zod';
import { 
  insertPatientSchema, 
  insertTestTypeSchema, 
  insertSampleSchema,
  insertTestResultSchema,
  patients,
  testTypes,
  samples,
  testResults,
  type Staff,
  type AuditLog
} from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  patients: {
    list: {
      method: 'GET' as const,
      path: '/api/patients' as const,
      input: z.object({
        search: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof patients.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/patients/:id' as const,
      responses: {
        200: z.custom<typeof patients.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/patients' as const,
      input: insertPatientSchema,
      responses: {
        201: z.custom<typeof patients.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/patients/:id' as const,
      input: insertPatientSchema.partial(),
      responses: {
        200: z.custom<typeof patients.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  testTypes: {
    list: {
      method: 'GET' as const,
      path: '/api/tests' as const,
      responses: {
        200: z.array(z.custom<typeof testTypes.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/tests' as const,
      input: insertTestTypeSchema,
      responses: {
        201: z.custom<typeof testTypes.$inferSelect>(),
      },
    },
  },
  samples: {
    list: {
      method: 'GET' as const,
      path: '/api/samples' as const,
      input: z.object({
        status: z.string().optional(),
        patientId: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof samples.$inferSelect & { 
          patient: typeof patients.$inferSelect,
          results: (typeof testResults.$inferSelect & { testType: typeof testTypes.$inferSelect })[]
        }>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/samples/:id' as const,
      responses: {
        200: z.custom<typeof samples.$inferSelect & { 
          patient: typeof patients.$inferSelect,
          results: (typeof testResults.$inferSelect & { testType: typeof testTypes.$inferSelect })[]
        }>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/samples' as const,
      input: insertSampleSchema.extend({
        testTypeIds: z.array(z.number()),
      }),
      responses: {
        201: z.custom<typeof samples.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/samples/:id/status' as const,
      input: z.object({ status: z.string() }),
      responses: {
        200: z.custom<typeof samples.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  results: {
    listAuditLogs: {
      method: 'GET' as const,
      path: '/api/results/:id/audit-logs' as const,
      responses: {
        200: z.array(z.custom<AuditLog & { staffMember: Staff }>()),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/results/:id' as const,
      input: z.object({
        resultValue: z.string(),
        notes: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof testResults.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    verify: {
      method: 'POST' as const,
      path: '/api/results/:id/verify' as const,
      responses: {
        200: z.custom<typeof testResults.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type AuditLogWithStaff = AuditLog & { staffMember: Staff };
