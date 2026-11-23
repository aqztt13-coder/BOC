# Basra Oil Company (BOC) HRMS — Security & Integrity Upgrade Report

## 1. Executive Summary
This upgrade hardens authentication, authorization, workflow state transitions, document storage, audit reliability, backup recovery, HR calculation governance, and server security across the existing React 19, TypeScript, Vite, Express, Firebase Auth, PostgreSQL, Drizzle ORM, and PWA stack—while preserving all existing users, employees, documents, transactions, and audit history.

A verified pre-migration baseline snapshot (`backup_snapshots.id = 1`, `backup_type = 'PRE_MIGRATION_AUDIT'`) was recorded in PostgreSQL before any schema changes were applied.

---

## 2. Critical Security Fixes

| Area | Previous Risk | Implemented Fix |
|---|---|---|
| **Privilege Escalation & Hardcoded Admin** | Hardcoded admin email and automatic first-user `HR_ADMIN` assignment in authentication middleware; unauthenticated `/api/auth/bootstrap-workspace` allowed creating an admin whenever existing admins lacked a local password hash. | Removed hardcoded admin email and first-user auto-admin logic (`src/middleware/auth.ts`). External accounts are blocked unless matched to an active employee record (least-privilege `EMPLOYEE` role only) or explicitly listed in `ADMIN_BOOTSTRAP_EMAILS`. Locked `/api/auth/bootstrap-workspace` whenever any active `HR_ADMIN` or `HR_MANAGER` exists unless authenticated as `HR_ADMIN`. |
| **Account Provisioning Escalation** | `HR_MANAGER` could provision `HR_ADMIN` accounts via `POST /api/employees`. | Enforced `canProvisionAccountRole` (`src/utils/accessControl.ts`): only `HR_ADMIN` may create `HR_ADMIN` or `HR_MANAGER` accounts. Replaced silent `.onConflictDoNothing()` with explicit conflict detection and atomic rollback. |
| **Organizational Scoping & PII Protection** | Scoping only checked `department`; non-HR managers and `READ_ONLY` users received sensitive fields (`nationalId`, `basicSalaryIQD`, `phone`, `notes`). | Enforced hierarchical scoping (`department`, `section`, `oilfield`, `employeeId`) in `canAccessEmployee`. Added `redactEmployeeForUser` across `/api/bootstrap`, `/api/employees`, and `/api/search` so only `HR_ADMIN`, `HR_MANAGER`, and the employee themselves receive unredacted PII and salary data. |
| **Confidential & Unlinked Documents** | Download route allowed unlinked (`employeeId = null`) documents and failed to enforce confidentiality levels or block `READ_ONLY`. | Enforced `canAccessDocument`: blocks `READ_ONLY`, restricts `CONFIDENTIAL`/`HR_ONLY` documents strictly to HR roles, and blocks unlinked documents for employees/section managers and out-of-scope departments. |
| **Notification IDOR & Shared Read State** | `PATCH /api/notifications/:id/read` updated any notification ID without ownership verification; broadcast notifications marked read for one user were marked read for everyone. | Verified ownership via `canManageNotification` and tracked per-user read status for role broadcasts in `notifications.read_by_uids`. |
| **Admin Self-Lockout & Session Revocation** | Updating user roles or disabling accounts did not revoke active sessions or guard against removing the last active `HR_ADMIN`. | Wrapped `PATCH /api/admin/users/:id` in a row-locked transaction that blocks self-demotion/deactivation and last-admin removal, increments `tokenVersion` on role/status changes, and never returns `passwordHash`. |
| **File Upload Spoofing & Storage** | Document uploads trusted client MIME types and stored raw Base64 blobs in PostgreSQL. | Added magic-byte inspection (`%PDF-`, PNG, JPEG, WebP), MIME match check, 4 MB decoded binary limit, SHA-256 hashing, filename sanitization, and path-confined private disk storage (`private_storage/documents`) with legacy Base64 fallback for pre-existing records. |
| **HTTP Headers, Rate Limits & PWA Caching** | Missing security headers, missing rate limits, and PWA Service Worker could cache private API responses. | Added `helmet` (iframe-compatible), tiered `express-rate-limit` on `/api/auth`, `/api/verify`, and `/api`, safe global error handler, `Cache-Control: no-store`, and `NetworkOnly` Workbox rule for `/api/*`. |
| **Vulnerable Excel Dependency** | Direct dependency `xlsx@0.18.5` had two high-severity advisories (Prototype Pollution and ReDoS). | Migrated `src/utils/exporters.ts` to `exceljs` with RTL Arabic sheets and removed `xlsx` from `package.json`. |

---

## 3. Workflow, Concurrency & Data Integrity Fixes

- **Strict Finite State Machine (`src/utils/workflowStateMachine.ts`)**: Blocks resubmission of `معتمد`, `مرفوض`, `مكتمل`, and `مؤرشف` transactions; prevents bypassing required department or HR approval stages; requires explicit approval before completion or archiving.
- **PostgreSQL Atomicity & Row Locking (`FOR UPDATE`)**: Wrapped all state-mutating endpoints (`POST /api/transactions/:id/action`, `POST /api/promotions/initiate`, `POST /api/courses/:id/apply`, `PATCH /api/enrollments/:id`, `POST /api/leaves`, `POST /api/auth/reset-password`, employee/document/user mutations, and backup restore) in PostgreSQL transactions with `FOR UPDATE` row locks.
- **Duplicate Execution Guard (`transactions.executed_at`)**: Prevents duplicate promotions, annual increments, salary changes, and leave deductions under concurrent or repeated approval calls. Also blocks opening duplicate active promotion/increment workflows for the same employee.
- **Leave Balance, Overlap & Attachment Enforcement**: Re-validates balances inside locked approval transactions; enforces `requiresAttachment` by verifying an employee-owned archived document (`leave_requests.attachment_document_id`) on sick/maternity leaves.
- **Training Seat Concurrency Enforcement**: Locks `training_courses` row during both application and final approval to prevent overselling seats.
- **Reliable Atomic Audit Logging**: `writeAuditLog` no longer swallows database errors and participates directly in the caller's PostgreSQL transaction (`tx`).
- **Complete Multi-Table Backup & Atomic Restore**: Upgraded export schema to `BOC-HRMS-ENTERPRISE-V3`. Restoration validates schema, SHA-256 checksum, and referential integrity (`src/lib/backupSchema.ts`), then restores settings, employees, courses, transactions, documents (with binary validation), appreciations, penalties, enrollments, leave requests, and career events inside a single transaction with ID remapping and full DB + disk rollback on failure.

---

## 4. HR Calculation Governance & Server-Side QR Verification

- **No Implicit Approval of Default Rules**: `DEFAULT_HR_RULES.rulesApproved` defaults to `false`. Official promotion and increment workflow initiation (`POST /api/promotions/initiate` and final approval execution) is blocked with HTTP `422` until an `HR_ADMIN` validates and explicitly approves BOC regulations in Admin Settings (`PUT /api/admin/settings` with `validateHRRulesConfig`).
- **Consistent `Asia/Baghdad` Timezone**: Standardized date helpers (`todayBaghdadISO`, `formatBaghdadDateTime`) across backend repository, health check, exporters, promotions, leaves, and employee portal.
- **Server-Side QR Verification (`GET /api/verify/:code`)**: Verifies documents, appreciation letters, and transactions against PostgreSQL without exposing sensitive employee PII or confidential document titles. Replaced overclaiming digital-signature wording in `OfficialDocumentModal.tsx` with an accurate legal notice and live server verification button.
- **Pagination Endpoints**: Added `GET /api/employees` and `GET /api/audit-logs` with `page`, `limit`, filtering, and total counts.

---

## 5. Backward-Compatible Database Migrations Applied
All additive columns were pushed cleanly to PostgreSQL with zero data loss:
- `users.section TEXT NOT NULL DEFAULT ''`
- `transactions.executed_at TIMESTAMP`
- `documents.storage_key TEXT`, `documents.sha256_hash TEXT`, `documents.confidentiality_level TEXT NOT NULL DEFAULT 'INTERNAL'`
- `leave_requests.attachment_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL`
- `notifications.read_by_uids JSONB NOT NULL DEFAULT '[]'`

Standardized PostgreSQL configuration variables (`DATABASE_URL`, `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, with legacy `SQL_ADMIN_*` fallback) across `src/db/index.ts`, `src/db/drizzle.config.ts`, and `.env.example`, and upgraded `GET /api/health` to run a real `SELECT 1` readiness probe.

---

## 6. Verification & Automated Test Results
- **Unit Test Suite (`npx tsx --test src/lib/*.test.ts src/utils/*.test.ts`)**: **26/26 passed** (crypto/OTP/session tokens, backup schema/checksum/FK integrity, file magic-bytes/MIME/size/path traversal, hierarchical org scoping/PII redaction/document ACL/notification IDOR/anti-escalation, HR calculation/rules approval gate/Baghdad dates, and workflow state machine transitions).
- **TypeScript (`tsc --noEmit`)**: **0 errors**.
- **Production Build (`vite build`)**: **Succeeded**.
- **Live HTTP Checks**:
  - `GET /api/health` -> `200 OK` (`database: "ready"`, Helmet security headers verified).
  - `GET /api/auth/status` -> `200 OK` (`{"initialized":true}`, no `employeeCount` exposure).
  - `POST /api/auth/bootstrap-workspace` (unauthenticated) -> `403 Forbidden`.
  - `GET /api/bootstrap` & `GET /api/employees` (unauthenticated) -> `401 Unauthorized`.
  - `GET /api/verify/BOC-TRN-2026-DED06B` -> `200 OK` (verified live record with Baghdad timestamp and legal notice); unknown code -> `404 Not Found`.

---

## 7. Remaining Operational Items (Honest Production Notes)
1. **External SMTP / Email Gateway**: Password-reset OTP emails currently use an in-app preview dispatcher when no external SMTP service is configured. Production deployment requires configuring an approved BOC SMTP/Microsoft 365 mail relay and disabling OTP preview payloads in production responses.
2. **Legally Certified Digital Signatures (PKI)**: Server-side QR verification confirms internal HRMS database integrity, not a legally binding cryptographic PKI signature. Integrating an Iraqi national/ministerial PKI certificate authority is required if paperless legal certification is mandated.
3. **Upstream Transitive Dependency Advisories**: Removing `xlsx` eliminated all direct high-severity package vulnerabilities. `bun audit` still reports transitive advisories inside upstream SDKs (`@grpc/grpc-js` under `firebase`/`firebase-admin`, `glob`/`minimatch`/`uuid` under `vite-plugin-pwa`/`exceljs`, and `esbuild` under dev tooling `vite`/`tsx`/`drizzle-kit`), which should be upgraded as upstream major releases become available.
