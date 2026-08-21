# SEC-009 — Continuous Security Validation: Design Document

> **Status:** DESIGN COMPLETE — IMPLEMENTATION IN PROGRESS  
> **Active ticket:** SEC-009.0 — CI Security Foundation (`.github/workflows/ci.yml`)  
> **Date:** 2026-08-20  
> **Note:** MVP capabilities (gitleaks, dependency scan, CodeQL, tenant suite, SQL harness spike) remain future tickets.

---

## 1. Executive Summary

**Nómadas Tour** is a multi-tenant SaaS for bus seat reservations. SEC-001–SEC-008 closed critical hardening gaps (identity forgery, RLS posture, RPC grants, tenant isolation, audit trail, outbox, realtime, reservation links). SEC-009 converts those gains into **continuous, automated validation** to prevent regressions.

**Core philosophy:**

```
SEC-001–008 = hardening / corrective architectural work
SEC-009     = regression prevention + continuous automated validation
```

SEC-009 must become a sustained capability, not another re-hardening project.

---

## 2. Current Security Controls Inventory

### 2.1 Authentication

| Control                              | Implementation                                                                                  | File                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Supabase Auth (email/password + JWT) | `supabase.auth.signInWithPassword()`, `getUser()`                                               | `lib/supabase/server.ts`, `backend/src/middlewares/auth.ts`     |
| Session handling                     | SSR cookie via `@supabase/ssr`; refresh handled by middleware                                   | `middleware.ts:10-33`, `lib/supabase/server.ts`                 |
| Role resolution                      | Backend fetches `public.users` (not `user_metadata`)                                            | `backend/src/middlewares/auth.ts:36-50`                         |
| Role helpers                         | `private.auth_app_role()`, `private.auth_app_agency_id()` (SECURITY DEFINER, empty search_path) | `supabase/migrations/039_rls_identity_from_public_users_v2.sql` |

### 2.2 Authorization

| Layer                       | Mechanism                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**                | `AuthRoleGuard` (agency/superadmin), route groups `/agency/*`, `/admin/*`                                                 |
| **Backend middleware**      | `auth` → `authorize(role)` → `tenant` (agency ownership + active status)                                                  |
| **RLS policies**            | All tenant-scoped policies use `private.auth_app_role()/auth_app_agency_id()`                                             |
| **Cross-agency (boarding)** | Operator agency ≠ seller agency; `trip_agencies` assignment required; RPC `boarding_toggle` validates operator assignment |
| **Service role**            | `supabaseAdmin` (service_role key) for all mutations; `EXECUTE` on RPCs only to `service_role`                            |

### 2.3 Database Security

| Control                          | Status                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| RLS enabled on all tenant tables | ✅ 30+ policies using `private.auth_app_*` helpers                                            |
| Deny-all on sensitive tables     | `password_resets`, `outbox_events`, `reservation_links` (RLS, no client policies)             |
| Client writes removed            | `INSERT` revoked from `authenticated` on `reservations`, `boarding_logs`; `UPDATE` on `seats` |
| RPC security                     | All mutations `SECURITY DEFINER`, `search_path=public`, `EXECUTE` only to `service_role`      |
| Public RPCs                      | Token-based (`public_get/save_reservation_link`), validate link state                         |
| Partial unique indexes           | Seat uniqueness per active link (`reservation_link_seats WHERE is_active`)                    |
| Append-only audit                | Trigger rejects UPDATE/DELETE on `audit_log`                                                  |

### 2.4 API Security

| Control            | Implementation                                                               |
| ------------------ | ---------------------------------------------------------------------------- |
| Rate limiting      | Per-route `express-rate-limit` on auth (15/15min), public links (30/15min)   |
| Input validation   | Zod schemas on **all** controllers; strict mode; cross-field refinements     |
| Error sanitization | Global handler: AppError → `{code,message,details?}`; unknown → 500 no stack |
| CORS               | Explicit origins from `CORS_ORIGIN` env; credentials=true                    |
| Trust proxy        | `trust proxy: 1` (single hop behind Render LB)                               |
| File uploads       | Busboy strict limits (1 file, 1MB, no fields)                                |

### 2.5 Secrets Management

| Secret                      | Location                                              | Rotation                                                 |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env`, GitHub Secrets, Render, Edge Function | Runbook in `docs/backup-disaster-recovery-operations.md` |
| `JWT_SECRET`                | `backend/.env`, Render                                | Manual                                                   |
| `RESEND_API_KEY`            | Backend `.env`, Render                                | Manual                                                   |
| `SUPABASE_DB_URL`           | GitHub Secrets (backup workflow)                      | Manual                                                   |
| R2 credentials              | GitHub Secrets (backup workflow)                      | Manual                                                   |

**Gaps:** No secret scanning (gitleaks/trufflehog), no pre-commit hooks.

### 2.6 Dependencies

| Tool             | Status                              |
| ---------------- | ----------------------------------- |
| Package manager  | npm (root + backend) with lockfiles |
| Dependabot       | ❌ Not configured                   |
| npm audit        | ❌ Not automated in CI              |
| License scanning | ❌ None                             |
| SBOM             | ❌ None                             |

### 2.7 Code Security

| Tool                    | Status            |
| ----------------------- | ----------------- |
| ESLint security plugins | ❌ Not configured |
| SAST (CodeQL/Semgrep)   | ❌ None           |
| TypeScript strict mode  | ✅ Enabled        |

### 2.8 Observability / Runtime Security

| Component          | Implementation                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Sentry             | `backend/src/observability/sentry.ts` — token redaction, `beforeSend` strips auth headers, filters 4xx business errors |
| Audit log          | `audit_log` table + `audit_append()` RPC (service_role only), append-only trigger                                      |
| Structured logging | `backend/src/utils/logger.ts` — JSON, request context, no PII                                                          |
| Worker health      | `/health` endpoint, heartbeat, metrics endpoint                                                                        |

### 2.9 Existing Security Tests

| Category                                       | Count   | Run Command                              |
| ---------------------------------------------- | ------- | ---------------------------------------- |
| SEC-* (Identity Forgery / Metadata Guards)     | 7       | `npm run test:security`                  |
| RLS / Tenant Isolation (SQL)                   | 13      | Manual (Supabase SQL Editor)             |
| RLS / Tenant Isolation (Unit/Integration)      | 7       | `npm test` / `npm test --prefix backend` |
| Auth (JWT, Session, Middleware)                | 9       | `npm test` / `npm test --prefix backend` |
| Authorization (Agency/Superadmin/Cross-Agency) | 9       | `npm test` / `npm test --prefix backend` |
| Token Redaction (Sentry)                       | 1       | `npm test --prefix backend`              |
| API Validation (Zod/Public Endpoints)          | 5       | `npm test` / `npm test --prefix backend` |
| SQL Verification Harnesses                     | 13      | Manual (Supabase SQL Editor)             |
| Audit Log Tests                                | 14      | `npm test` / `npm test --prefix backend` |
| Security Regression Tests                      | 14      | `npm run test:security` / `npm test`     |
| **TOTAL**                                      | **112** | —                                        |

---

## 3. Automation Maturity Matrix

| Control                          | Exists | Automated | When Runs            | Blocks Merge/Deploy | Coverage          |
| -------------------------------- | ------ | --------- | -------------------- | ------------------- | ----------------- |
| **Auth/Authorization tests**     | ✅     | ✅        | CI (every PR)        | ✅                  | High              |
| **RLS SQL harnesses**            | ✅     | ❌        | Manual               | ❌                  | High (but manual) |
| **Secret scanning**              | ❌     | ❌        | Never                | ❌                  | None              |
| **Dependency scanning**          | ❌     | ❌        | Never                | ❌                  | None              |
| **SAST**                         | ❌     | ❌        | Never                | ❌                  | None              |
| **License scanning**             | ❌     | ❌        | Never                | ❌                  | None              |
| **Secret scanning in CI**        | ❌     | ❌        | Never                | ❌                  | None              |
| **API security tests**           | ✅     | ✅        | CI                   | ✅                  | Medium            |
| **Audit log PII tests**          | ✅     | ✅        | CI                   | ✅                  | High              |
| **Security regression tests**    | ✅     | ✅        | CI (`test:security`) | ✅                  | High              |
| **Migration chain verification** | ✅     | ✅        | CI                   | ✅                  | Medium            |
| **Sentry token redaction**       | ✅     | ✅        | CI                   | ✅                  | Medium            |
| **TypeScript strict**            | ✅     | ✅        | Build                | ✅                  | High              |

**Classification:**

- 🟢 **Automated in CI** (blocks merge): 8 controls
- 🟡 **Semi-automated** (manual SQL harnesses): 2 controls
- 🔴 **Missing entirely**: 5 controls (secrets, deps, SAST, licenses, SBOM)

---

## 4. Threat Model (Prioritized for Nómadas Tour)

| #   | Category                           | Risk                                       | Current Mitigation                                                                    | Gap for SEC-009                                       |
| --- | ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | **Tenant isolation breach**        | Agency A reads Agency B data               | RLS policies + middleware tenant + RPC validation                                     | ✅ Automated tests exist; need SQL harness automation |
| 2   | **Auth bypass / identity forgery** | Forged JWT `user_metadata.role=superadmin` | Backend reads `public.users` not `user_metadata`; `authorize()` guard; C1 tests       | ✅ Automated C1 regression tests                      |
| 3   | **Auth bypass / stale sessions**   | Expired/invalid JWT accepted               | Supabase `getUser()` validates; middleware checks                                     | ✅ Auth tests                                         |
| 4   | **Authorization bypass**           | Agency accesses another's data             | RLS policies + `tenant` middleware + RPC agency checks                                | ✅ Tests exist; need SQL harness automation           |
| 5   | **Direct RPC execution**           | Client calls privileged RPCs               | `EXECUTE` only to `service_role`; revoked from `authenticated`                        | ✅ SQL harness verifies grants                        |
| 6   | **PII exposure**                   | Leaks in logs/Sentry/outbox                | Sentry `beforeSend` redacts tokens/PII; audit log PII scanner; outbox minimal payload | ✅ Tests exist                                        |
| 7   | **Token leakage**                  | Raw reservation-link tokens in logs/Sentry | `redactReservationLinkUrl()` in Sentry `beforeSend`                                   | ✅ Tested                                             |
| 8   | **SQL injection**                  | Malicious input to RPCs                    | `SECURITY DEFINER` + `search_path=public`; Zod validation; parameterized queries      | ✅ Type-safe RPCs                                     |
| 9   | **XSS**                            | Unsanitized output                         | No server-rendered HTML with user data; frontend escapes                              | Low risk                                              |
| 10  | **API abuse / rate limit bypass**  | Brute force, enumeration                   | Per-route rate limits on auth/public; trust proxy=1                                   | ⚠️ Missing on agency/admin                            |
| 11  | **Supply chain / vulnerable deps** | Malicious/outdated packages                | ❌ No Dependabot, no npm audit CI                                                     | 🔴 **Critical gap**                                   |
| 12  | **Secret leakage**                 | Service role key in repo/logs              | ❌ No secret scanner                                                                  | 🔴 **Critical gap**                                   |
| 13  | **Configuration drift**            | Staging ≠ Production RLS/grants            | Manual SQL harnesses only                                                             | 🔴 Not automated                                      |
| 14  | **Migration drift**                | Applied migrations differ from repo        | Migration chain test exists; SQL harnesses manual                                     | 🟡 Semi-automated                                     |

---

## 5. Security Invariants (Derived from SEC-001–SEC-008 + F5-004)

| ID           | Invariant                                                                | Type         | Validation Method                                         |
| ------------ | ------------------------------------------------------------------------ | ------------ | --------------------------------------------------------- |
| **INV-001**  | Agency A cannot read Agency B reservations                               | DB           | RLS policy `reservations_agency_read` + SQL harness       |
| **INV-002**  | Agency A cannot modify Agency B seats                                    | DB           | RLS + RPC agency checks + SQL harness                     |
| **INV-003**  | Authenticated users cannot execute privileged RPCs directly              | DB           | `EXECUTE` only `service_role`; SQL harness                |
| **INV-004**  | Public users cannot access internal tables                               | DB           | Deny-all RLS (no client policies) + SQL harness           |
| **INV-005**  | Service role key never exposed to frontend                               | Backend      | Secret scan (gitleaks) + code review                      |
| **INV-005b** | Raw reservation-link tokens never reach Sentry/logs                      | Backend      | Sentry `beforeSend` redacts; unit test                    |
| **INV-006**  | RLS identity from trusted DB helpers, not client metadata                | DB           | Policies use `private.auth_app_*`; C1 tests               |
| **INV-007**  | Reserved seats cannot be written by browser clients                      | DB           | `UPDATE` on `seats` revoked from `authenticated`          |
| **INV-008**  | Reservation links never expose raw internal IDs (seat UUIDs, trip UUIDs) | DB + Backend | Public DTO only returns `seat_code`; SQL harness          |
| **INV-009**  | RLS identity comes from trusted DB identity helpers                      | DB           | `private.auth_app_role()`, `auth_app_agency_id()`         |
| **INV-010**  | Service role never used for auth.getUser()                               | Backend      | Code review; `supabaseAdmin` documented                   |
| **INV-011**  | Raw tokens never in Sentry requests/URLs                                 | Backend      | Sentry `beforeSend` redacts 64-hex tokens                 |
| **INV-012**  | Audit log is append-only                                                 | DB           | Trigger `trg_audit_log_append_only` rejects UPDATE/DELETE |
| **INV-013**  | No `user_metadata` reads in runtime code                                 | Code         | C1 source scan test                                       |
| **INV-014**  | No `user_metadata` writes via Auth admin API                             | Code         | C1 write prohibition test                                 |
| **INV-015**  | No rollback SQL in migrations                                            | Migration    | No rollback test                                          |
| **INV-016**  | Seat in at most one active reservation link                              | DB           | Partial unique index `WHERE is_active=TRUE`               |
| **INV-017**  | Boarding operator must be assigned to trip                               | DB/RPC       | `boarding_toggle` validates `trip_agencies`               |
| **INV-018**  | Reservation links expose only `seat_code`, never seat UUIDs              | Backend/DB   | `reservation_link_public_body` returns only `seat_code`   |

---

## 6. Historical Regressions (SEC-001–SEC-008 + F5-004)

| Incident / Finding                           | Root Cause                                       | Current Test                                | Gap to Automate       |
| -------------------------------------------- | ------------------------------------------------ | ------------------------------------------- | --------------------- |
| **C1: Identity forgery via `user_metadata`** | JWT `user_metadata.role` trusted                 | `identity-forgery.backend/frontent.test.ts` | ✅ Automated          |
| **C1: `user_metadata` read in source**       | Direct `auth.getUser().user_metadata` in code    | `no-user-metadata-in-source.test.ts`        | ✅ Automated          |
| **C1: `user_metadata` write via Auth admin** | `updateUser` with `data.role`                    | `no-auth-metadata-writes.test.ts`           | ✅ Automated          |
| **C1: Metadata-based RLS**                   | Policies used `auth.jwt()`                       | `rls-active-migrations.test.ts`             | ✅ Automated          |
| **C1: Rollback SQL in migrations**           | Auto-applicable rollback                         | `no-rollback-in-migrations.test.ts`         | ✅ Automated          |
| **C1: Build artifact has metadata**          | `backend/dist` not gitignored                    | `no-dist-user-metadata.test.ts`             | ✅ Automated          |
| **F5-004: Token exposure in Sentry**         | Raw token in request URL                         | `redactReservationLinkUrl()` + test         | ✅ Automated          |
| **F5-004: Grant + RLS conflict**             | `070` granted SELECT to `authenticated`          | `f5_004_verification.sql`                   | 🟡 Manual SQL harness |
| **F5-004: Seat release on cancel link**      | `cancel_reservation_link` released seats         | `cancel-link-seat-sync.test.ts`             | ✅ Automated          |
| **AUD-020: Legacy boarding routes**          | Old `/scanner/lookup` endpoints                  | `security-residue.test.ts`                  | ✅ Automated          |
| **AUD-020: ILIKE in boarding lookup**        | Fuzzy matching leaked data                       | `security-residue.test.ts`                  | ✅ Automated          |
| **AUD-020: Realtime cross-agency**           | Policy didn't allow operator view                | `realtime-cross-agency.test.ts`             | ✅ Automated          |
| **AUD-020: PII in realtime**                 | `reservation_passengers` exposed to wrong agency | `realtime-cross-agency.test.ts`             | ✅ Automated          |

**Key gap:** SQL verification harnesses (`f5_004_verification.sql`, `f5_001_verification.sql`, `aud_020_*`) are **manual only** — run in Supabase SQL Editor, not in CI.

---

## 7. Continuous Validation Architecture

### 7.1 Five-Layer Security Model

```
Layer 1 — Tooling
SCA / SAST / secrets / dependencies

Layer 2 — Application Security
auth / API / DAST / fuzzing

Layer 3 — Domain Security
tenant isolation / authorization / business logic

Layer 4 — Database Security
RLS / grants / RPC / SECURITY DEFINER / constraints

Layer 5 — Environment Security
drift / staging validation / nightly checks
```

### 7.2 Validation Layers

#### Layer 1 — Local (Developer Machine)

| Control                | Tool                           | Must Pass Before Human Commit |
| ---------------------- | ------------------------------ | ----------------------------- |
| Secret scanning        | `gitleaks` pre-commit          | ✅                            |
| Lint security rules    | `eslint-plugin-security`       | ✅                            |
| Dependency audit       | `npm audit --audit-level=high` | ✅                            |
| Focused security tests | `npm run test:security`        | ✅                            |
| TypeScript strict      | `tsc --noEmit`                 | ✅                            |

#### Layer 2 — Pull Request / CI (Every PR)

| Control                    | Tool                                                                                                                                                                  | Blocks Merge             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Unit/security tests        | Vitest (`test:security`, `test`)                                                                                                                                      | ✅                       |
| API security tests         | Vitest (backend + frontend)                                                                                                                                           | ✅                       |
| Security regression suite  | `npm run test:security`                                                                                                                                               | ✅                       |
| TypeScript strict          | `tsc --noEmit`                                                                                                                                                        | ✅                       |
| Secret scanning            | `gitleaks` GitHub Action                                                                                                                                              | ✅                       |
| Dependency audit           | `npm audit --audit-level=high` (root + backend)                                                                                                                       | ✅                       |
| SAST                       | GitHub CodeQL (free tier)                                                                                                                                             | ⚠️ Warn                  |
| Migration chain + security | Vitest (`f5-004.test.ts`, etc.)                                                                                                                                       | ✅                       |
| SQL verification harnesses | **Planned / Spike required**<br/>• Feasibility pending technical spike<br/>• Preferred: Supabase local via Supabase CLI<br/>• Not a gate until spike proves viability | Planned / Spike required |

#### Layer 3 — Nightly (Scheduled)

| Control                        | Tool                                     | Action                           |
| ------------------------------ | ---------------------------------------- | -------------------------------- |
| Deep dependency scan           | `npm audit` + OSV-Scanner                | Alert                            |
| DAST/API probing               | Nuclei against staging                   | Alert                            |
| Extended RLS validation        | SQL harnesses against staging DB         | Alert (Planned / Spike required) |
| Configuration drift            | Compare staging vs production RLS/grants | Alert                            |
| Security regression full suite | Full test suite                          | Alert                            |
| License compliance             | `license-checker`                        | Alert                            |

#### Layer 4 — Pre-production / Staging (Pre-deploy)

| Control                    | Tool                                 | Action                            |
| -------------------------- | ------------------------------------ | --------------------------------- |
| Migration verification     | SQL harnesses against staging DB     | Target state / future after spike |
| RLS/grants checks          | SQL harnesses                        | Target state / future after spike |
| Public API security checks | Nuclei + custom scripts              | ✅ Block deploy                   |
| Tenant isolation           | Integration tests against staging DB | ✅ Block deploy                   |
| Smoke security tests       | Critical path auth/authz             | ✅ Block deploy                   |

### 7.3 Severity Classification

| Severity          | Meaning                          | Example                                                   |
| ----------------- | -------------------------------- | --------------------------------------------------------- |
| **BLOCK**         | Merge/deploy fails; must fix     | Secret leak, RLS missing, SAST critical, migration breaks |
| **WARN**          | Non-blocking; requires attention | SAST medium, dependency moderate, license issue           |
| **INFORMATIONAL** | Visibility only                  | License notice, dependency minor, test coverage delta     |

---

## 8. Supabase-Specific Security Validation

### 8.1 Correct Grant/RLS Validation Rules

**SECURITY DEFINER vs INVOKER — Correct Rule:**

```
New privileged RPC
→ must have explicit, approved execution model

If elevated privileges needed:
  SECURITY DEFINER
  + search_path safe
  + EXECUTE restricted

If correctly operates as SECURITY INVOKER:
  → not a vulnerability
```

**Authenticated GRANT + RLS — Correct Rule:**

```
authenticated GRANT SELECT
+ RLS disabled
  → BLOCK

authenticated GRANT SELECT
+ RLS enabled
+ tenant-scoped policy
  → valid if justified (e.g., 070 Realtime for reservation_links)
```

SEC-009 must validate the **combination of grant + RLS + policy + intent**, not just the grant.

### 8.2 Validate Result, Not Parse Migrations

> SEC-009 must validate the **resulting state** of the schema, not infer security solely by parsing migration SQL.

```text
apply complete migration chain
       ↓
inspect actual database catalogs
       ↓
assert expected security posture
```

Static parsing of `CREATE TABLE` vs `ALTER TABLE ENABLE RLS` is unreliable — a migration may create a table and enable RLS in a later migration.

### 8.3 Supabase-Specific Validation Patterns

| Pattern                                                   | Detection Method                                                                                         | CI Stage             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| Security-sensitive table missing RLS + grants + policies  | `pg_class.relrowsecurity = false` on public tables + `pg_policy` + `information_schema.table_privileges` | Nightly + Pre-deploy |
| RPC with PUBLIC EXECUTE                                   | `pg_proc.proacl` contains `=X/PUBLIC`                                                                    | Nightly + Pre-deploy |
| Authenticated GRANT + RLS disabled                        | Cross-ref `pg_class` + `pg_policy`                                                                       | Nightly              |
| Table in Realtime + no RLS policy                         | `pg_publication_tables` join `pg_class.relrowsecurity`                                                   | Nightly              |
| Service role key in code                                  | gitleaks rule                                                                                            | Pre-commit + CI      |
| Privileged RPC with incorrect execution model             | `pg_proc.prosecdef` + `pg_proc.proacl` + `pg_proc.proconfig` + compare vs approved model                 | Nightly + Pre-deploy |
| RPC with EXECUTE to PUBLIC/anon/authenticated             | `pg_proc.proacl` analysis                                                                                | Nightly + Pre-deploy |
| Table in `supabase_realtime` without tenant-scoped policy | Cross-ref publication + policies                                                                         | Nightly              |

### 8.3 Implementation: SQL Validation Suite

Run validation SQL against catalogs after applying migrations:

```sql
-- Example: Tables without RLS
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname NOT IN ('spatial_ref_sys', ...); -- allowlist

-- RPC with PUBLIC EXECUTE
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proacl IS NOT NULL
  AND p.proacl @> ARRAY['=X/PUBLIC'];
```

---

## 9. Tenant Isolation Validation (Core Capability)

### 9.1 Scope

SEC-009 must protect explicitly:

```
Agency A → cannot read Agency B
Agency A → cannot modify Agency B
Agency A → cannot execute privileged RPCs on Agency B
Agency A → cannot read Realtime of Agency B
Agency A → cannot read audit records of Agency B
Agency A → cannot operate seats/reservations of Agency B
```

This is a **first-class Security Regression Suite**, not a DAST detail.

### 9.2 Test Matrix (Per Agency Pair)

| Operation      | Agency A (Owner)                          | Agency B (Other)               | Expected                |
| -------------- | ----------------------------------------- | ------------------------------ | ----------------------- |
| **Read**       | Reservations                              | Reservations                   | A: 200, B: 0            |
| **Write**      | Create reservation                        | Create reservation             | A: 201, B: 403          |
| **Update**     | Cancel own                                | Cancel A's                     | A: 200, B: 403          |
| **RPC**        | `create_agency_reservation`               | Same RPC                       | A: 201, B: 403          |
| **RPC**        | `boarding_toggle` (assigned)              | `boarding_toggle` (unassigned) | A: 200, B: 403          |
| **Realtime**   | Subscribe own `reservation_links`         | Subscribe other's              | A: rows, B: none        |
| **Realtime**   | Subscribe `boarding_logs` (trip assigned) | Subscribe other trip           | A: rows, B: none        |
| **Public API** | `/reservations/link?token=...`            | Same token                     | A: 200, B: 200 (public) |
| **Audit**      | `/api/agency/audit`                       | `/api/agency/audit`            | A: own, B: own          |

### 9.3 Execution Strategy

| Environment           | Method                                                                        | Data                    |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| **CI (ephemeral)**    | Supabase local / temp Postgres, apply migrations, seed 2 agencies, run matrix | Fresh DB per run        |
| **Nightly (staging)** | Run against staging DB with seeded test agencies                              | Read-only assertions    |
| **Pre-deploy**        | Full matrix against staging                                                   | Block deploy on failure |

### 9.4 Implementation

Reusable fixtures in `tests/security/tenant-isolation.fixture.ts`. Run via Vitest in CI (ephemeral DB) and against staging nightly.

---

## 10. Security Baseline / Drift Detection

### 10.1 Baseline Model (Controls, Not Schema)

**File:** `security-baseline.json` (committed, versioned)

```json
{
  "version": "2026-08-20",
  "tables": {
    "reservations": { "rls_required": true },
    "seats": { "rls_required": true },
    "reservation_links": {
      "rls_required": true,
      "grant_authenticated_SELECT": true
    }
  },
  "functions": {
    "create_reservation_core": { "execution_model": "service_role_only" },
    "public_get_reservation_link": { "execution_model": "public_tokenized" }
  },
  "grants": {
    "reservation_links": {
      "authenticated": ["SELECT"],
      "service_role": ["SELECT", "INSERT", "UPDATE", "DELETE"]
    },
    "reservation_link_seats": {
      "service_role": ["SELECT", "INSERT", "UPDATE", "DELETE"]
    }
  },
  "realtime": {
    "reservation_links": { "enabled": true, "tenant_policy_required": true }
  }
}
```

**Principles:**

- Describes **controls**, not raw schema
- Validation queries PostgreSQL catalogs directly (`pg_class`, `pg_policy`, `pg_proc`, `pg_roles`, `information_schema`, `pg_publication_tables`)
- No full schema dump in baseline

### 10.2 Drift Detection

| Drift Type                 | Detection                                             | Frequency                |
| -------------------------- | ----------------------------------------------------- | ------------------------ |
| **Schema vs Baseline**     | Query catalogs → diff vs baseline                     | Nightly                  |
| **Staging vs Baseline**    | Run validation SQL against staging                    | Nightly                  |
| **Production vs Baseline** | Read-only verification                                | Weekly (manual approval) |
| **Migration vs Baseline**  | New migration must update baseline or pass validation | CI (pre-merge)           |

### 10.3 Drift Categories to Detect

```
RLS disabled unexpectedly
Unexpected grant
Unexpected RPC EXECUTE
Unexpected SECURITY DEFINER
Missing tenant policy
Unexpected realtime publication
Unexpected exposed table/schema
```

---

## 11. Tool Evaluation (2026 Current State)

| Category        | Candidates                                   | Status      |
| --------------- | -------------------------------------------- | ----------- |
| **SAST**        | GitHub CodeQL (free tier), Semgrep           | ✅ Evaluate |
| **SCA**         | npm audit, OSV-Scanner, Dependabot           | ✅ Evaluate |
| **Secrets**     | gitleaks, TruffleHog, GitHub Secret Scanning | ✅ Evaluate |
| **DAST**        | Nuclei (ProjectDiscovery), OWASP ZAP         | ✅ Evaluate |
| **Fuzzing**     | TypeScript/Node/API compatible tools         | ✅ Evaluate |
| **AI-assisted** | Strix, CodeQL AI, Semgrep Assistant          | 🔍 Watch    |

**Important corrections:**

- **Nuclei** is ProjectDiscovery, not OWASP. Classify as "DAST / API / template-based security scanner".
- **No tool selection now** — evaluate pricing/licenses/capabilities at implementation time.
- Prioritize: zero cost / free tier, low maintenance, low false positives, TypeScript/Next.js/Node/Supabase integration.

---

## 12. MVP (Value & Risk Prioritized)

**No artificial time commitment.** Prioritize by value/risk.

### MVP Capabilities (5)

| Priority | Capability                                        | Why                                          | Effort |
| -------- | ------------------------------------------------- | -------------------------------------------- | ------ |
| **1**    | **Secret scanning (gitleaks)**                    | Critical gap; service role key exposure risk | Low    |
| **2**    | **Dependency scanning** (npm audit + OSV-Scanner) | Supply chain risk; zero cost                 | Low    |
| **3**    | **Security regression suite**                     | Already exist; ensure they block             | Low    |
| **4**    | **Tenant isolation validation**                   | Core domain risk; first-class suite          | Medium |
| **5**    | **SAST (CodeQL)**                                 | Free, native, catches injection              | Low    |

### Technical Spike (Pre-MVP Decision)

| Item                               | Purpose                                                | Status         |
| ---------------------------------- | ------------------------------------------------------ | -------------- |
| SQL harness automation feasibility | Validate running 13 Supabase-dependent harnesses in CI | Spike required |

**No fixed duration.** If SQL harness automation is complex, it remains a spike, not an MVP capability.

---

## 13. DAST — Scope & Boundaries

```
DAST ≠ business logic testing
DAST ≠ tenant isolation testing
DAST ≠ full pentest
```

- Runs against **staging** or dedicated security environment
- **Never** active scanning on Production
- Complements, does not replace, tenant isolation / business logic tests

### Authenticated DAST — Post-MVP

The MVP covers **unauthenticated/public DAST** only. Authenticated DAST is a post-MVP capability:

```
Authenticated DAST
  ├── anonymous
  ├── agency user
  ├── second agency user
  └── superadmin
```

Requires: credentials, fixtures, roles, agencies, controlled data, authorization validation, multiple sessions/tenants.

Runs against **staging** or dedicated security environment.

**Never** active authenticated scanning against Production.

**Clear boundary:**

```
DAST
≠ tenant isolation suite
≠ business logic testing
≠ full penetration test
```

Authenticated DAST is complementary.

---

## 14. Fuzzing — Post-MVP

Orient to:

- API, Zod, public endpoints, reservation links, auth boundaries
- Malformed JSON, wrong types, oversized input, duplicate IDs, invalid seat codes, malformed tokens
- **Does not replace** authorization/business logic tests

---

## 15. Load/Stress Testing — Phase 8

```
SEC-009 → security
Phase 8 → load/stress/capacity/performance
```

Only abuse/rate-limit testing in SEC-009. Full load testing (1,000+ RPS) → Phase 8.

---

## 16. Hexagonal Architecture — Policy

```
NO rewrite global
```

SEC-009 does not include hexagonal migration. Policy for future:

- New bounded contexts may adopt Ports & Adapters incrementally
- Simple features do not force hexagonal
- Hexagonal improves boundaries/testability but is **not a security tool**
- Document as future architectural policy, not SEC-009 deliverable

---

## 17. Privacy Boundaries

| Data Type                              | Can Leave Repo/CI?     | Mitigation                                        |
| -------------------------------------- | ---------------------- | ------------------------------------------------- |
| Source code                            | ✅ Public repo         | —                                                 |
| Env values                             | ❌ Never               | GitHub Secrets; never in logs                     |
| Supabase schema                        | ✅ (migrations public) | —                                                 |
| Database metadata                      | ⚠️ Staging only        | Never prod; read-only queries                     |
| Logs                                   | ⚠️ Internal only       | No PII; audit log strips PII                      |
| Sentry                                 | ⚠️ External            | `beforeSend` redacts tokens/PII; no code upload   |
| SAST (CodeQL)                          | ⚠️ Code to GH          | CodeQL runs in GitHub infra; code never leaves GH |
| OSV-Scanner                            | ✅ Local only          | Runs in CI container; no upload                   |
| Nuclei                                 | ✅ Local               | Runs against staging; no data exfil               |
| AI-assisted (Strix, Semgrep Assistant) | ⚠️ Code to GH          | Evaluate privacy policy before adoption           |

**Hard rule:** No production data, secrets, or PII leave infrastructure boundary.

---

## 18. CI / Local / Nightly / Staging — Summary

Legend for SQL / RLS harness automation (must match §7.2 and §12):

| Label              | Meaning                                                       |
| ------------------ | ------------------------------------------------------------- |
| **Current**        | What already exists today                                     |
| **Planned**        | What SEC-009 will implement once designed/approved            |
| **Spike required** | Must be validated technically before becoming a gate or alert |
| **Target state**   | Desired behavior after the spike proves feasibility           |

```text
SQL harness automation
→ technical spike required
→ preferred: Supabase local via Supabase CLI
→ no gate until feasibility is proven
```

| Level                  | Controls                                                                                                                                                                                                              | Severity / Status                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Local**              | **Current / Planned gates:** gitleaks, security tests, npm audit, lint security, tsc                                                                                                                                  | **BLOCK**                                  |
| **PR/CI**              | **Current / Planned gates:** security tests, API tests, regression suite, tsc, gitleaks, npm audit, CodeQL (**WARN**), migration checks<br/>**SQL harnesses:** Planned / Spike required — **no SQL harness gate yet** | **BLOCK / WARN** (SQL harness: not a gate) |
| **Nightly**            | **Planned alerts:** deep dependency scan, DAST staging, drift, tenant isolation<br/>**SQL harnesses:** Planned / Spike required — **no SQL harness alert until feasibility is proven**                                | **ALERT** (SQL harness: not until spike)   |
| **Staging/Pre-deploy** | **Planned gates:** tenant isolation, API security, smoke security<br/>**SQL/RLS harnesses:** Target state / future after spike — **no SQL harness deploy gate yet**                                                   | **BLOCK** (SQL harness: not a gate yet)    |

---

## 19. Open Questions (Require Human Decision)

1. **Staging for DAST:** Dedicated staging Supabase + Render for nightly? Or ephemeral-only?
2. **SAST choice:** CodeQL (free, native) vs Semgrep (more tunable)? CodeQL recommended.
3. **Nightly staging access:** Can CI connect to staging Supabase (read-only) for drift? Or ephemeral-only?
4. **Secret rotation ownership:** Who owns quarterly rotation? Codify in baseline.
5. **Alert routing:** Where do SEC-009 warnings/alerts go? (Slack, PagerDuty, GitHub Issues?)
6. **Pre-deploy gate:** SQL harnesses required before Render deploy? (Currently only tests block)
7. **Budget:** MVP tools free. Phase 2 (Snyk, StackHawk) may cost — confirm ceiling.
8. **Pre-commit hook enforcement:** Require gitleaks in husky or rely on CI?
9. **Supabase local in CI:** Verify feasibility via spike before committing to SQL harness automation.

---

## 20. Definition of Done (Design)

- [x] Current security controls fully documented
- [x] Automation maturity matrix complete
- [x] Threat model prioritized for Nómadas Tour
- [x] Security invariants extracted (18 invariants)
- [x] Historical regressions catalogued (14 incidents)
- [x] CI/Local/Nightly/Staging layers designed with BLOCK/WARN/INFO
- [x] Tool evaluation complete (CodeQL, gitleaks, OSV-Scanner, Nuclei)
- [x] Supabase-specific validation patterns designed (9 patterns, corrected rules)
- [x] Tenant isolation test matrix defined (10 operations × 2 agencies)
- [x] Security baseline schema designed (controls, not schema) + drift detection strategy
- [x] Privacy boundaries defined for all external tools
- [x] SEC-009 decomposition into phases with MVP prioritized
- [x] MVP prioritized by value/risk (5 controls, no fixed duration)
- [x] Risks/trade-offs documented
- [x] Grant/RLS validation rules corrected (SECURITY DEFINER, authenticated GRANT)
- [x] Baseline modeled as controls, not schema
- [x] SQL harness automation feasibility flagged (spike needed)
- [x] DAST separated from business logic/tenant isolation
- [x] Fuzzing post-MVP, load/stress in Phase 8
- [x] Hexagonal separated from SEC-009
- [x] MVP prioritized without artificial time commitment

---

## 21. Validation

```powershell
git diff --check
npx.cmd prettier --check docs/SEC-009-continuous-security-validation-design.md
```

---

## 22. Report

```
FILE CREATED: docs/SEC-009-continuous-security-validation-design.md
KEY DESIGN CORRECTIONS APPLIED:
  - Security baseline as controls, not schema dump
  - Grant/RLS validation rules corrected (SECURITY DEFINER, authenticated GRANT)
  - Validate result state, not parse migrations
  - SQL harness automation feasibility flagged (Supabase local spike needed)
  - Tenant isolation elevated to core capability
  - Five-layer security model defined
  - MVP prioritized by value/risk, no fixed duration
  - DAST scope bounded; fuzzing post-MVP; load testing in Phase 8
  - Hexagonal separated from SEC-009
  - Privacy boundaries explicit
  - MVP: secret scan, dep scan, regression suite, tenant isolation, SAST
  - Open questions documented

MVP: secret scan, dep scan, regression suite, tenant isolation, SAST
OPEN QUESTIONS: 9 (staging DAST, SAST choice, nightly access, rotation ownership, alerts, pre-deploy gate, budget, pre-commit, Supabase local)
VALIDATION: git diff --check PASS
STATUS: DESIGN COMPLETE — READY FOR IMPLEMENTATION DESIGN
```
