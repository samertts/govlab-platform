# GovLab LIS - Laboratory Information System

## Overview

GovLab LIS is a full-stack Laboratory Information System (LIS) designed to manage clinical laboratory workflows for government and clinical lab staff. It supports patient registration, sample accessioning, test result entry, result verification, and provides a dashboard for lab activity overview. The system incorporates role-based access for administrators, pathologists, technicians, and receptionists. Key features include patient registry, accessioning, worklist management, result verification by pathologists, and comprehensive audit logging for all changes. The project aims to provide a robust, multi-tenant LIS solution capable of supporting national oversight and advanced clinical governance.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
GovLab LIS is built with a clear separation of concerns between its frontend and backend. It leverages modern web technologies to deliver a responsive and efficient user experience, while the backend focuses on robust data management, security, and complex business logic. A shared codebase (`shared/`) ensures consistency in data schemas and API contracts between the client and server. The system supports multi-tenancy, with centralized middleware for tenant scope enforcement. Advanced features include a clinical governance engine, a clinical pathways engine, an event-driven notification system, and an instrument streaming gateway.

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query for server state
- **UI**: shadcn/ui (new-york style) built on Radix UI, styled with Tailwind CSS and a custom medical-professional color palette.
- **Animations**: Framer Motion for transitions.
- **Forms**: React Hook Form with Zod for validation.
- **Build Tool**: Vite.

### Backend
- **Runtime**: Node.js with Express 5, executed via `tsx`.
- **Language**: TypeScript.
- **Authentication**: Passport.js with Replit Auth (OpenID Connect) for session-based authentication.
- **API**: RESTful JSON API using Zod schemas for validation and typing, defined in `shared/routes.ts`.
- **Build Tool**: esbuild.
- **Security**: Node.js crypto scrypt for password hashing, AES-256-GCM for national ID encryption.
- **Multi-tenancy**: Centralized `tenantScope.ts` middleware for consistent data filtering.
- **Event-Driven Architecture**: Uses an event bus, background workers for event processing, clinical governance, archiving, and analyzer event processing.
- **Read Models**: Pre-computed views for worklists, national metrics, and suggestions.
- **Clinical Intelligence**: Includes a Clinical Governance Engine and Clinical Pathways Engine for advisory evaluations.

### Data Storage
- **Database**: PostgreSQL.
- **ORM**: Drizzle ORM with `node-postgres`.
- **Schema Management**: `drizzle-kit push`.
- **Key Tables**: `users`, `staff`, `patients`, `testTypes`, `samples`, `testResults`, `auditLogs`, `organizations`, `labs`, `clinicalPathways`, `governanceEvents`, `analyzers`, and various read model tables.
- **Data Archiving**: Hot vs. cold data architecture for results.

### Project Structure
Organized into `client/`, `server/`, and `shared/` directories. The `server/` directory contains modules for authentication, storage, sovereign APIs, clinical engines, workers, read models, and security.

### Sovereign Pilot API Routes
A comprehensive set of API endpoints are available under `/api/sovereign/` and `/api/analyzers/` for managing organizational hierarchy, identity tokens, analyzer ingestion, event streaming, offline mode, invoicing, national reports, patient history oversight, policy management, identity verification, clinical pathways, technician workbenches, and various worker statuses and read models.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, managed via Drizzle ORM. Connection string required via `DATABASE_URL`.

### Key npm Packages
- **drizzle-orm** + **drizzle-zod**: ORM and schema validation.
- **express** v5: Backend web framework.
- **passport** + **passport-local**: Authentication.
- **@tanstack/react-query**: Frontend data fetching.
- **wouter**: Frontend routing.
- **react-hook-form** + **@hookform/resolvers**: Form management and validation.
- **framer-motion**: UI animations.
- **shadcn/ui** components: UI library.

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string.
- `SESSION_SECRET`: Express session secret.
- `NATIONAL_ID_ENCRYPTION_KEY`: For AES-256-GCM encryption of national IDs.