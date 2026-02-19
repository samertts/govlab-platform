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
- **Tables**: users, patients, testTypes, samples, testResults, auditLogs
- **Key Relationships**: patients → samples → testResults → testTypes; auditLogs reference testResults and users

### Storage Layer
- `server/storage.ts` defines an `IStorage` interface and `DatabaseStorage` implementation
- All database access goes through this storage layer, making it testable and swappable

### Authentication & Authorization
- Session-based auth with Passport.js LocalStrategy
- Sessions stored in MemoryStore (suitable for development; consider connect-pg-simple for production)
- Protected routes on client use a `PrivateRoute` wrapper that checks `/api/auth/me`
- User roles defined: admin, pathologist, technician, receptionist

### Project Structure
```
client/               # Frontend React application
  src/
    components/       # Reusable components
      layout/         # Sidebar, PageHeader
      ui/             # shadcn/ui components
    hooks/            # Custom hooks (use-auth, use-lab, use-patients, use-toast)
    pages/            # Route pages (Dashboard, Patients, Accessioning, Worklist, Verification)
    lib/              # Utilities (queryClient, utils)
server/               # Backend Express application
  index.ts            # Entry point, middleware setup
  routes.ts           # API route registration with auth
  storage.ts          # Database storage interface and implementation
  db.ts               # Database connection pool
  vite.ts             # Vite dev server middleware
  static.ts           # Production static file serving
shared/               # Shared between client and server
  schema.ts           # Drizzle table definitions + Zod schemas
  routes.ts           # API contract definitions
```

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