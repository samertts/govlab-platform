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

### Disaster-Proof Offline Architecture
- **Offline Sync Worker** (`server/offlineSyncWorker.ts`): Background service polling `local_sync_events` in batches, applying exponential backoff with UUID dedup, conflict detection, and merge strategy resolution before syncing to national spine.
- **Global Event Budget** (`server/globalEventBudget.ts`): System-wide event rate limiter using sliding window (500 events/60s) with queue-backpressure (never drops clinical events, never blocks workflows).
- **Conflict Resolution**: `sync_conflict_policy` table defines per-entity merge strategies (LAST_WRITE_WINS default) with LOCAL_LAB > DIRECTORATE > NATIONAL priority. Verified clinical results are never silently overwritten; conflicts produce REVIEW_REQUIRED entries in `conflict_audit_log`.
- **Facility Connectivity**: `facility_connectivity_status` tracks online/offline/degraded status per facility with sync latency and pending event counts.
- **Key Design Rules**: Governance/pathways/intelligence engines execute post-sync only. Sample ownership remains single-facility. Projection stability: max 2 projections per domain. Server-side execution_context only.
- **API Routes**: `/api/sovereign/offline-sync/*`, `/api/sovereign/event-budget/*`, `/api/sovereign/conflict-policies`, `/api/sovereign/conflict-audit`, `/api/sovereign/facility-connectivity/*`.

### Zero-Trust Security Architecture
- **Identity Model** (`server/zeroTrustTokenService.ts`): `zero_trust_identities` table supports USER, ANALYZER, LOCAL_NODE identity types with short-lived (30min) rotatable tokens, HMAC-signed token hashes, facility_scope and role_scope enforcement, and automatic expiry cleanup.
- **Event Signing** (`server/eventSigningService.ts`): All inter-service events are HMAC-signed with signature_hash, issuer_identity, and issued_at fields. Signing is automatic in `eventBus.emitAndPersist`. Workers validate signatures before processing; invalid events are quarantined to `security_quarantine_queue` with SECURITY_ALERT generation.
- **Field-Level Encryption**: AES-256-GCM encryption for patient national IDs via `nationalIdEncryption.ts`. Decryption is role-gated (PATHOLOGIST, LAB_ADMIN, NATIONAL_CLINICAL_SUPERVISOR, MINISTRY_AUDITOR only).
- **Least-Privilege Access Roles**: TECHNICIAN (lab-scoped ops), PATHOLOGIST (verification/review), LAB_ADMIN (facility config), NATIONAL_CLINICAL_SUPERVISOR (cross-facility advisory read-only), MINISTRY_AUDITOR (national read-only audit). No role has unrestricted global write.
- **Cross-Facility Isolation** (`server/zeroTrustAccessControl.ts`): Cross-facility data access blocked by default. National roles require access_reason_code and access_origin. All cross-facility reads logged to `national_audit_trail` with review_flag.
- **National Audit Trail**: Append-only `national_audit_trail` table records identity_uuid, action_type, entity_ref, facility_scope, reason_code, access_origin, review_flag, timestamp.
- **Zero-Trust Worker Enforcement**: Workers derive execution context server-side only; client-provided role/facility headers are stripped by `blockClientProvidedContext` middleware.
- **Security Resilience**: Signature validation failures quarantine events (never block LIS workflows). Expired tokens allow local LIS operations but deny national-level propagation.
- **API Routes**: `/api/sovereign/zero-trust/identities/*`, `/api/sovereign/zero-trust/quarantine/*`, `/api/sovereign/zero-trust/audit-trail/*`, `/api/sovereign/zero-trust/cross-facility-access`.

### AI-Assisted Clinical Intelligence Layer
- **Intelligence Event Stream** (`server/intelligenceWorker.ts`): Consumes post-commit clinical events (RESULT_VERIFIED, QC_FLAGGED, TEST_ORDERED) in event_lane=INTELLIGENCE. Events emitted after database commit only; intelligence processing never runs inline with clinical transactions.
- **Anonymized Metrics** (`anonymized_metrics` table): Stores aggregated, de-identified operational data. No patient identifiers allowed. Aggregation occurs server-side before persistence. Time-bucketed (HOURLY/DAILY) counts by test_code and facility_code.
- **Data Protection Guardrails** (`server/intelligenceGuardrails.ts`): Strips patient_identity_token, national_id_number, and all PII fields before intelligence processing. Rejects events containing patient identifiers. Enforces zero-trust signature verification on incoming intelligence events.
- **Intelligence Alerts**: Advisory outputs only — EPIDEMIOLOGY_ALERT, LAB_LOAD_PREDICTION, POLICY_SUGGESTION. Published through notification engine only. No direct UI mutation or clinical decision enforcement. All outputs classified as CLINICAL_SUGGESTION.
- **Governance Separation**: Knowledge Engine → clinical suggestions, Clinical Pathways → workflow guidance, Governance Brain → policy enforcement, Intelligence Layer → population-level insights only. No duplicate alert generation across engines.
- **Architecture Guardrails**: Intelligence Layer runs as extension_layer. Core clinical processing remains immutable. Single-lab deployments fully operational without intelligence worker. Intelligence processing never delays RESULT_VERIFIED, WORKLIST rendering, or analyzer ingestion.
- **API Routes**: `/api/sovereign/intelligence/metrics`, `/api/sovereign/intelligence/alerts`, `/api/sovereign/intelligence/alerts/:id/acknowledge`, `/api/sovereign/intelligence/events/stats`, `/api/sovereign/intelligence/worker-status`.

### National Master Data Model
- **National Tests** (`national_tests`): LOINC-aligned master test catalog with `loinc_code` as immutable identifier. Status: ACTIVE/DEPRECATED/DRAFT. Versioned for backward compatibility with archived results. Signature-ready fields for future sovereign digital trust.
- **National Analyzers** (`national_analyzers`): Governance-controlled analyzer definitions with `supported_tests` referencing national_tests.loinc_code. Validated during instrument streaming gateway ingestion.
- **National Roles** (`national_roles`): Aligned with Zero-Trust role model. Local role expansion allowed as extensions only, never overrides. `permissions_scope` defines allowed operations per role.
- **National Facilities** (`national_facilities`): Multi-governorate facility hierarchy. sector=GOVERNMENT/PRIVATE/NATIONAL, level=LAB/DIRECTORATE/NATIONAL_SPINE.
- **Governance Rules**: Labs cannot modify master tables directly. All updates originate from governance-authorized channels only. Changes versioned — never destructive. MASTER_DATA_UPDATED events emitted for async propagation.
- **API Routes**: `/api/sovereign/master/tests/*`, `/api/sovereign/master/analyzers/*`, `/api/sovereign/master/roles/*`, `/api/sovereign/master/facilities/*`.

### Data Storage
- **Database**: PostgreSQL.
- **ORM**: Drizzle ORM with `node-postgres`.
- **Schema Management**: `drizzle-kit push`.
- **Key Tables**: `users`, `staff`, `patients`, `testTypes`, `samples`, `testResults`, `auditLogs`, `organizations`, `labs`, `clinicalPathways`, `governanceEvents`, `analyzers`, `localSyncEvents`, `syncConflictPolicy`, `conflictAuditLog`, `facilityConnectivityStatus`, `zeroTrustIdentities`, `securityQuarantineQueue`, `nationalAuditTrail`, `intelligenceEvents`, `anonymizedMetrics`, `intelligenceAlerts`, `nationalTests`, `nationalAnalyzers`, `nationalRoles`, `nationalFacilities`, and various read model tables.
- **Data Archiving**: Hot vs. cold data architecture for results.

### Project Structure
Organized into `client/`, `server/`, and `shared/` directories. The `server/` directory contains modules for authentication, storage, sovereign APIs, clinical engines, workers, read models, security, clinical intelligence, and national master data.

### Sovereign Pilot API Routes
A comprehensive set of API endpoints are available under `/api/sovereign/` and `/api/analyzers/` for managing organizational hierarchy, identity tokens, analyzer ingestion, event streaming, offline mode, invoicing, national reports, patient history oversight, policy management, identity verification, clinical pathways, technician workbenches, clinical intelligence metrics and alerts, national master data management, and various worker statuses and read models.

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