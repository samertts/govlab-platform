# GovLab LIS - Laboratory Information System

## Overview

GovLab LIS is a full-stack Laboratory Information System (LIS) for managing clinical laboratory workflows. It handles patient registration, sample accessioning, test result entry (worklist), result verification, and a dashboard for lab activity overview. The application is designed for government/clinical lab staff with role-based access (admin, pathologist, technician, receptionist).

Key workflows:
- **Patient Registry**: Register and search patients by name or MRN
- **Accessioning**: Create samples/accessions linked to patients and test types
- **Worklist**: Enter test results for pending samples
- **Verification**: Pathologist review and approval of completed results
- **Audit Logging**: Track changes to test results with user attribution

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side router)
- **State/Data Fetching**: TanStack React Query for server state management with query invalidation on mutations
- **UI Components**: shadcn/ui (new-york style) built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming, custom medical-professional color palette (cerulean blue primary, teal accent)
- **Animations**: Framer Motion for page transitions
- **Forms**: React Hook Form with Zod resolvers using shared schemas
- **Build**: Vite with React plugin

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript (executed via tsx)
- **Authentication**: Passport.js with local strategy, session-based auth using express-session with MemoryStore
- **Password Hashing**: Node.js crypto scrypt (not bcrypt)
- **API Design**: RESTful JSON API under `/api/` prefix. API contract defined in `shared/routes.ts` with Zod schemas for input validation and response types
- **Build**: esbuild bundles server to `dist/index.cjs` for production

### Shared Code (`shared/`)
- **Schema** (`shared/schema.ts`): Drizzle ORM table definitions and Zod insert schemas using `drizzle-zod`. This is the single source of truth for both database structure and validation.
- **Routes** (`shared/routes.ts`): API contract object defining method, path, input schema, and response schemas for each endpoint. Used by both client and server.

### Data Storage
- **Database**: PostgreSQL via `node-postgres` (pg) pool
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Management**: `drizzle-kit push` for applying schema changes (no migration files workflow by default)
- **Tables**: users (Replit Auth), sessions (Replit Auth), staff, patients, testTypes, samples, testResults, auditLogs, organizations, directorates, facilities, apiTokens, events, offlineQueue, invoices, invoiceItems, labs, nationalReports, policyEngine, nationalAccessAudit
- **Key Relationships**: organizations → labs (multi-tenant); organizations → directorates → facilities; staff/patients/samples link to labs via labId; patients → samples → testResults → testTypes; auditLogs (hash-chained) reference testResults and staff; invoices → invoiceItems → testTypes
- **Multi-tenant filtering**: Centralized via `server/tenantScope.ts` middleware. `attachTenantScope` runs after auth and attaches `req.tenantScope` with `{ labId, bypass }`. Helper functions `getTenantLabFilter`, `enforceTenantOwnership`, `stampTenantLabId` provide consistent scoping. Role `ministry_auditor` bypasses filtering and sees all data across labs.

### Storage Layer
- `server/storage.ts` defines an `IStorage` interface and `DatabaseStorage` implementation
- All database access goes through this storage layer, making it testable and swappable

### Authentication & Authorization
- **Replit Auth** via OpenID Connect (OIDC) — replaces old local username/password auth
- Sessions stored in PostgreSQL via `connect-pg-simple`
- Auth module lives in `server/replit_integrations/auth/`
- Auth routes: `/api/login`, `/api/logout`, `/api/auth/user`
- Internal staff records in `staff` table link to Replit users via `replitUserId`
- `requireAuth` middleware: validates Replit Auth session → resolves to staff record (auto-creates if first login, default role: technician)
- Staff roles: admin, pathologist, technician, receptionist, ministry_auditor, national_clinical_supervisor
- Client uses `useAuth()` hook from `client/src/hooks/use-auth.ts` for auth state
- Landing page at `/login` with "Sign In with Replit" button (no custom forms)

### Project Structure
```
client/               # Frontend React application
  src/
    components/       # Reusable components
      layout/         # Sidebar, PageHeader
      ui/             # shadcn/ui components
    hooks/            # Custom hooks (use-auth, use-lab, use-patients, use-toast, use-offline)
    pages/            # Route pages (Dashboard, Patients, Accessioning, Worklist, Verification, TechnicianBench)
    lib/              # Utilities (queryClient, utils)
server/               # Backend Express application
  index.ts            # Entry point, middleware setup
  routes.ts           # API route registration with auth
  storage.ts          # Database storage interface and implementation
  sovereignRoutes.ts  # Sovereign Pilot API routes (org hierarchy, tokens, analyzers, events, offline, invoices)
  tenantScope.ts      # Centralized multi-tenant scope middleware (attachTenantScope, helpers)
  oversightGuard.ts   # Write-guard middleware blocking national oversight roles from mutations
  eventBus.ts         # Unified event bus (EventEmitter + persistence)
  db.ts               # Database connection pool
  vite.ts             # Vite dev server middleware
  static.ts           # Production static file serving
shared/               # Shared between client and server
  schema.ts           # Drizzle table definitions + Zod schemas
  routes.ts           # API contract definitions
```

### Sovereign Pilot API Routes
All sovereign routes are under `/api/sovereign/` or `/api/analyzers/`:
- **Org hierarchy**: `GET/POST /api/sovereign/organizations`, `/api/sovereign/directorates`, `/api/sovereign/facilities`
- **Identity tokens**: `POST /api/sovereign/tokens`, `DELETE /api/sovereign/tokens/:id`
- **Analyzer gateway**: `POST /api/analyzers/ingest` (Bearer token auth)
- **Event bus**: `GET /api/sovereign/events`, `GET /api/sovereign/events/stream` (SSE)
- **Offline mode**: `POST /api/sovereign/offline/enqueue`, `GET /api/sovereign/offline/pending`, `POST /api/sovereign/offline/sync`
- **Pricing**: `POST /api/sovereign/invoices/generate`, `GET /api/sovereign/invoices/:id`, `GET /api/sovereign/invoices?patientId=`
- **Labs**: `GET/POST /api/sovereign/labs`, `GET /api/sovereign/labs/:id`, `PATCH /api/sovereign/staff/:id/lab`
- **National reports**: `GET /api/sovereign/national-reports`, `POST /api/sovereign/national-reports/generate` (ministry_auditor/admin only)
- **Oversight — patient history**: `GET /api/sovereign/oversight/patient/:id/history?reason_code=` (national oversight roles, requires reason_code)
- **Oversight — policies**: `GET/POST /api/sovereign/oversight/policies`, `PATCH /api/sovereign/oversight/policies/:id/active`, `POST /api/sovereign/oversight/policies/evaluate`
- **Oversight — access audit**: `GET /api/sovereign/oversight/access-audit`
- **Technician bench**: `GET /api/sovereign/bench/queue`

### Dev vs Production
- **Development**: Vite dev server proxied through Express with HMR
- **Production**: Client built to `dist/public/`, server bundled to `dist/index.cjs` via esbuild

## External Dependencies

### Database
- **PostgreSQL**: Required. Connection via `DATABASE_URL` environment variable. Drizzle ORM handles queries. Run `npm run db:push` to sync schema to database.

### Key npm Packages
- **drizzle-orm** + **drizzle-zod**: ORM and schema-to-Zod conversion
- **express** v5: HTTP server framework
- **passport** + **passport-local**: Authentication
- **express-session** + **memorystore**: Session management
- **@tanstack/react-query**: Client-side data fetching/caching
- **wouter**: Client-side routing
- **react-hook-form** + **@hookform/resolvers**: Form handling with Zod validation
- **framer-motion**: Animations
- **date-fns**: Date formatting
- **recharts**: Dashboard analytics charts
- **shadcn/ui** components (Radix UI primitives): Full component library

### Environment Variables
- `DATABASE_URL` (required): PostgreSQL connection string
- `SESSION_SECRET` (optional, defaults to "secret"): Express session secret