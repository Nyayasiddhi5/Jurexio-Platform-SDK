---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# NYV Compliance Attestation

**Platform:** Nyayavigya Platform 3.1.2  
**Scope:** Security & compliance hardening controls implemented under task #29 of `nyayavigya-platform-312`.  
**Standards mapped:** SOC 2 Type II (CC), ISO/IEC 27001:2022, EU AI Act, India DPDPA 2023, NIST 800-53 Rev. 5.

This document is the auditor-facing map between each compliance control and the
exact code, migration, and test that enforces it. Each row is independently
verifiable: the test file runs in CI and the migration file is checked into
`drizzle/`.

---

## 1. Distributed PII Vault (PII-at-rest, cluster-safe)

| Control | Standard | Implementation | Test |
|---|---|---|---|
| PII tokens are stored in a shared, encrypted, TTL-bounded data store with a 5-minute default expiry. | SOC 2 CC6.1, CC6.7 · ISO 27001 A.10.1 · DPDPA §8(5) | `src/startup/nv-pii-vault-cleanup.ts` → `addPiiVaultEntry`, `getPiiVaultEntry` (Redis-backed via `NYV_REDIS_TCP_URL`, `PX` TTL) | `tests/unit/security/pii-vault.test.ts` |
| Loud, structured warning logged when the platform falls back to in-memory storage. | SOC 2 CC7.2 · NIST 800-53 SI-4 | Same file, `getRedisClient()` failure branches | `tests/unit/security/pii-vault.test.ts` ("logs degraded warning") |
| Janitor pass refreshes statistics and prunes the in-memory fallback every 5 minutes. | SOC 2 CC6.5 · ISO 27001 A.8.10 | `runPiiVaultCleanup()` invoked from `initPiiVaultCleanup(5)` | `tests/unit/security/pii-vault.test.ts` ("expires entries past TTL") |

**Operational notes:** The expected backend in production is Upstash Redis,
addressed by `NYV_REDIS_TCP_URL` (a `rediss://` TCP URL). The `REDIS_URL`
HTTPS REST endpoint is **not** suitable for `ioredis` and is rejected at boot
by `src/utils/env-validator.ts`.

---

## 2. PostgreSQL Row Level Security (multi-tenant isolation)

| Control | Standard | Implementation | Test |
|---|---|---|---|
| Every multi-tenant `nv_*` (and `ns_*`/`ni_*`/`nm_*`) table with an `org_id` column has a `tenant_isolation` policy installed by Postgres itself. Policies are always installed on every release; *enforcement* is gated on the `NYV_RLS_ENFORCE` env flag (see "Phased rollout" below). | SOC 2 CC6.1, CC6.6 · ISO 27001 A.5.15 · DPDPA §9(1) | `drizzle/0004_enable_rls_for_tenant_tables.sql` (DO block over `information_schema.columns`); applied at startup by `scripts/nv-migrate.ts` → `applyRlsAndFieldEncryptionMigration()` | `tests/unit/security/rls.test.ts` ("enables RLS on every nv_* … with org_id"; "Migration runner wires 0004 + flags from environment"; live cross-tenant test gated on `DATABASE_URL`) |
| When enforcement is on, even table owners obey RLS — `FORCE ROW LEVEL SECURITY` is set on every protected table. | NIST 800-53 AC-3, AC-4 | Same migration | Same test file ("FORCES RLS so the table owner cannot bypass policies") |
| **Strict policy — no empty-setting bypass.** The policy is `org_id::text = current_setting('app.current_org_id', true)`; an unbound session sees zero rows (`org_id::text = NULL` evaluates to NULL → policy fails). Defence-in-depth: every fresh pooled connection is initialised with `app.current_org_id = ''` via a `pool.on('connect')` hook in `src/db/index.ts` (`attachTenantContextDefault`), so even a leaked or misconfigured connection is fail-closed under enforcement. | SOC 2 CC6.1 · NIST 800-53 AC-3 · OWASP A01:2021 | Migration `0004` policy + `attachTenantContextDefault` in `src/db/index.ts` | `tests/unit/security/rls.test.ts` ("uses STRICT tenant policy with no empty-setting bypass" + "Pool default tenant binding") |
| **Phased rollout via `NYV_RLS_ENFORCE`.** The migration runner (`scripts/nv-migrate.ts`) reads `process.env.NYV_RLS_ENFORCE` and binds it to the session GUC `app.nyv_rls_enforce` before executing 0004. The DO loop installs policies unconditionally but only runs `ENABLE` / `FORCE ROW LEVEL SECURITY` when the GUC is `'true'`. Default (unset / `'false'`): policies present, enforcement OFF, existing behaviour preserved. Operators flip enforcement ON after every DB call site has been wired through `req.withTenant(fn)` (see follow-up #41). | SOC 2 CC8.1 (change management) · NIST 800-53 CM-3 | `scripts/nv-migrate.ts` (sets `app.nyv_rls_enforce` via `set_config`); migration `0004` `IF enforce THEN …` block | `tests/unit/security/rls.test.ts` ("phased rollout: ENABLE/FORCE ROW LEVEL SECURITY is gated on app.nyv_rls_enforce") |
| **Connection-safe tenant binding mounted on the Express app.** `orgRlsMiddleware` is mounted on `/api/nv/` in `src/index.ts` (right after `tenantIsolation`), so every authenticated request gets a `req.withTenant(fn)` helper that opens a transaction and runs `SET LOCAL app.current_org_id = '…'` on the transaction's pinned connection (via `withTenantTx`). `SET LOCAL` is reverted on COMMIT/ROLLBACK so nothing leaks back to the pool. Cron jobs, queue workers, and migrations use `withTenantTx(orgId, fn)` directly. | SOC 2 CC6.1 · NIST 800-53 AC-16 | `src/middleware/nv-org-rls-middleware.ts` (`withTenantTx`, `withTenantContext`) + mount in `src/index.ts` | `tests/unit/security/rls.test.ts` ("orgRlsMiddleware is mounted on the Express app"; "attaches a connection-safe req.withTenant helper that calls SET LOCAL inside a transaction") |
| **Paved-road example (corrected after review).** `GET /api/nv/cases/:id` runs its three SELECTs through the `tx` handle that `req.withTenant(async (tx) => …)` provides — `txExec.execute(sql\`SELECT * FROM nv_cases WHERE id = ${id}\`)` and friends. **Critical**: the earlier shape `req.withTenant(async () => caseManagementService.getCase(id))` was incorrect because the inner service used the global `db` handle, so its queries ran on a different pooled connection than the one carrying `SET LOCAL app.current_org_id`, defeating RLS. The current pattern guarantees connection pinning. A regression test forbids the old shape from reappearing. | n/a (engineering proof) · SOC 2 CC6.1 | `src/routes/nv-case-management-routes.ts` (GET /:id callback) | `tests/unit/security/rls.test.ts` ("Paved-road tenant-bound read uses tx, not global db") |
| Maintenance work that legitimately spans tenants must connect as a dedicated Postgres role with the `BYPASSRLS` attribute. There is no in-app empty-setting bypass. | SOC 2 CC6.1 (privileged access) | Operator runbook — provision a `nyv_maint` role for back-fills and BI exports | n/a (operational control) |
| Illegal `org_id` values (injection attempts) are rejected before hitting the database. | OWASP A03:2021 · NIST 800-53 SI-10 | `SAFE_ORG_ID` regex (`/^[A-Za-z0-9_\-]{1,64}$/`) | Same test file ("withTenantTx refuses illegal org_id values") |

### 2.1 Operator runbook — flipping `NYV_RLS_ENFORCE` to `'true'`

1. Verify every authenticated route that touches a `nv_*`/`ns_*`/`ni_*`/`nm_*` table with `org_id` wraps its DB work in `await req.withTenant(...)` (or, for background workers, `await withTenantTx(orgId, ...)`). Track via follow-up #41.
2. Provision an unprivileged Postgres role for the app (no `SUPERUSER`, no `BYPASSRLS`). RLS is silently no-op for superuser connections.
3. Provision a separate `nyv_maint` role with `BYPASSRLS` for cross-tenant maintenance (back-fills, BI exports, cron jobs that legitimately span tenants).
4. Set `NYV_RLS_ENFORCE=true` and re-run `npm run migrate`. The migration logs `RLS ENFORCED on <schema>.<table>` for every protected table.
5. Smoke-test: sign in as one tenant, confirm requests return their own data; an unbound psql session as the app role should see zero rows from any tenant table.

**Live database test:** When `DATABASE_URL` is set in CI, the test inserts two
rows into `nv_rls_sentinel` (one per tenant), then verifies that querying with
`SET app.current_org_id = 'tenantA'` returns only tenantA's rows even when the
session connects as the table owner.

---

## 3. Field-Level Encryption (`pgp_sym_encrypt`/`pgp_sym_decrypt`)

| Control | Standard | Implementation | Test |
|---|---|---|---|
| Symmetric encryption of every Task #29-mandated sensitive field — voice transcripts, identity-extraction fields, document extraction content, CLAWD bot conversation messages, **mem0 long-term matter memory entries (`nv_matter_memory.content`)**, and **citation / RAG full text (`document_embeddings.text`)** — driven by Postgres `pgcrypto`. Migration `0004` adds `*_enc bytea` companion columns and back-fills via `pgp_sym_encrypt` when `app.field_encryption_key` is set. | SOC 2 CC6.7 · ISO 27001 A.10.1 · EU AI Act Art. 10 · DPDPA §8(5) | `src/services/field-encryption-service.ts` (`encryptedExpr`, `decryptedExpr`, `SENSITIVE_FIELDS`); `drizzle/0004_enable_rls_for_tenant_tables.sql` (column adds + backfill DO block) | `tests/unit/security/field-encryption.test.ts` ("exposes the list of sensitive fields") |
| **Fail-closed dual-write** — every insert/update of a sensitive field is wrapped in a single Postgres transaction with the `pgp_sym_encrypt` mirror UPDATE. If `pgp_sym_encrypt` raises (missing key, pgcrypto absent, bytea conversion failure) the transaction rolls back and **no plaintext row is left without its encrypted companion**. The previous shape (separate INSERT + best-effort `try/catch warn` mirror) is gone — there is no "log and continue" path on the write side. | SOC 2 CC6.7 · ISO 27001 A.10.1 · NIST 800-53 SC-28 | `src/services/identity-extraction-service.ts` (`db.transaction` wrapping insert + `extracted_fields_enc` UPDATE; same for `reviewExtraction`); `src/services/document-pipeline/document-parsing-service.ts` (`db.transaction` wrapping chunk insert + per-chunk `content_enc` UPDATE); `src/services/memory/nv-5tier-memory-service.ts` (`db.transaction` wrapping `nvMatterMemory` insert + `content_enc` UPDATE) | `tests/unit/security/field-encryption.test.ts` ("Field encryption is wired into actual write paths" — one assertion per service) |
| **Decrypt-on-read** — the companion encrypted bytea column is preferred at read time, falling back to the plaintext column during the dual-write transition. Once the legacy plaintext column is dropped (follow-up #42), the COALESCE collapses to the encrypted-only path. | SOC 2 CC6.7 | `src/services/memory/nv-5tier-memory-service.ts` `getMatterMemory` (`COALESCE(${decryptedExpr('content_enc')}, content)`) — paved-road example for the rest of the codebase | `tests/unit/security/field-encryption.test.ts` ("5tier memory service decrypts mem0 content_enc on getMatterMemory (decrypt-on-read)") |
| Migration runner binds `app.field_encryption_key` from `NYV_FIELD_ENCRYPTION_KEY` (or `ENCRYPTION_KEY`) **before** executing 0004, so the in-migration backfill DO block actually runs when a key is configured. Without a key, the backfill self-skips with `RAISE NOTICE` — no plaintext is touched, no half-encrypted state is created. Each backfill `UPDATE` is also gated on `information_schema.columns` for the source plaintext column, so deploys whose tables don't carry the legacy column shape skip silently instead of failing the whole migration with `42703`. | SOC 2 CC8.1 · NIST 800-53 SC-12 | `scripts/nv-migrate.ts` `applyRlsAndFieldEncryptionMigration()` · `drizzle/0004_enable_rls_for_tenant_tables.sql` (column-existence guards) | `tests/unit/security/field-encryption.test.ts` ("Migration runner sets app.field_encryption_key from env") |
| Encryption key is sourced from `NYV_FIELD_ENCRYPTION_KEY` (preferred) or `ENCRYPTION_KEY`. Production startup fails fast when neither is set. | NIST 800-53 SC-12, SC-13 | `resolveKey()` in same file | Same test file ("throws in production when key absent") |
| Backfill is idempotent — only encrypts rows where the encrypted column is `NULL` and the session-scoped key is present. | SOC 2 CC8.1 (change management) | `0004_enable_rls_for_tenant_tables.sql` `UPDATE ... WHERE *_enc IS NULL` | Migration self-test: re-running is a no-op (verified manually before merge) |
| Column identifiers passed to `decryptedExpr` are validated against an allow-list charset to prevent SQL injection. | OWASP A03:2021 | `decryptedExpr` regex check | `tests/unit/security/field-encryption.test.ts` ("rejects illegal column identifier") |

### 3.1 Field Encryption Key Rotation

The pgcrypto-based scheme supports zero-downtime key rotation by
double-encrypting during the cutover window:

1. **Generate new key** (`openssl rand -hex 32`) and load it as
   `NYV_FIELD_ENCRYPTION_KEY_NEXT` on every pod.
2. **Dual-write window (≥ 24 h)**: deploy a build where
   `field-encryption-service.ts` encrypts new writes with `_NEXT` and reads
   try `_NEXT` first, falling back to the previous key. (See the
   `decryptedExpr` extension point — wrap with
   `coalesce(pgp_sym_decrypt(col, $next), pgp_sym_decrypt(col, $prev))`.)
3. **Backfill**: run `scripts/rotate-field-encryption-key.sql` (template
   below) to re-encrypt every row with the new key. The script processes
   one table at a time in 1 000-row batches and is restartable.
4. **Promote**: rename `NYV_FIELD_ENCRYPTION_KEY_NEXT` → `NYV_FIELD_ENCRYPTION_KEY`
   in the secrets store and remove the dual-read fallback in the next deploy.
5. **Audit**: record the rotation in `nv_audit_logs` with
   `event_type = "field_encryption_key_rotated"` and the old/new key
   fingerprints (`fieldEncryption.fingerprint()`).

```sql
-- scripts/rotate-field-encryption-key.sql (template)
DO $$
DECLARE batch_size int := 1000; updated int;
BEGIN
  LOOP
    UPDATE nv_voice_sessions
    SET transcript_text_enc = pgp_sym_encrypt(
          pgp_sym_decrypt(transcript_text_enc, current_setting('app.prev_key')),
          current_setting('app.next_key'))
    WHERE id IN (
      SELECT id FROM nv_voice_sessions
      WHERE transcript_text_enc IS NOT NULL
        AND pgp_sym_decrypt(transcript_text_enc, current_setting('app.next_key'), 'cipher-algo=aes256') IS NULL
      LIMIT batch_size
    );
    GET DIAGNOSTICS updated = ROW_COUNT;
    EXIT WHEN updated = 0;
  END LOOP;
END $$;
```

---

## 4. Real-Time Audit Log Hash-Chain Enforcement

| Control | Standard | Implementation | Test |
|---|---|---|---|
| Every audit log insert is serialized through an in-process mutex and validates that its `previous_hash` matches the canonical DB head before writing. | SOC 2 CC7.2, CC7.3 · ISO 27001 A.12.4 · NIST 800-53 AU-9, AU-10 | `src/middleware/nv-sdk-tracking-middleware.ts` → `withChainLock`, `appendAuditRecord` | `tests/unit/security/hash-chain.test.ts` |
| **Cross-pod coordination via short-lived Redis lock.** Inside the per-process `withChainLock` mutex, every writer also acquires a Redis lock (`SET nv:audit:chain:lock <token> NX PX 250`) before reading the DB chain head. Pods queue up on the same key so they don't all read the same head and race into a unique-violation. The lock is released via a compare-and-delete Lua script so a writer can never delete another pod's lock if its own TTL expired. **Graceful degradation** — when Redis is unavailable, mis-configured, or times out, the helper returns `acquired:false` and writes proceed under the in-process mutex + DB unique-index backstop alone (i.e. the prior single-pod behavior is preserved). The 250ms TTL bounds any orphaned lock from a crashed pod. | SOC 2 CC7.2 · ISO 27001 A.12.4 · NIST 800-53 AU-9, SC-5 | `src/services/audit-chain-lock.ts` (`acquireAuditChainLock`); wired into `appendAuditRecord` in `src/middleware/nv-sdk-tracking-middleware.ts` | `tests/unit/security/hash-chain.test.ts` ("Hash chain — Redis lock keeps the chain whole across pods" — two pods + 10-pod fan-out tests; "Audit chain Redis lock — graceful degradation"; "Audit chain Redis lock helper — direct contract") |
| Tampering (deleted/edited rows that break linkage) raises `AuditChainBrokenError` and rejects the write. | SOC 2 CC7.3 · NIST 800-53 AU-9(3) | Same file, `AuditChainBrokenError` | Same test file ("throws AuditChainBrokenError on tampering") |
| Unique index on `nv_audit_logs.previous_hash` provides a database-level backstop against cross-pod races. | SOC 2 CC7.2 · NIST 800-53 SC-3 | Migration `0004` (`nv_audit_logs_prev_hash_uniq`) | Same test file ("unique-violation triggers AuditChainBrokenError") |
| Daily verifier still runs as a backup defence-in-depth check. | ISO 27001 A.18.2 | `src/services/hash-chain-verifier.ts` (unchanged) | `tests/unit/security/hash-chain.test.ts` ("backup verifier still detects tampering") |
| **Universal writer enforcement** — every audit-log write in `src/` is routed through `appendAuditRecord` (now a public export). The previous direct `INSERT INTO nv_audit_logs` in `nv-sdk-keylife-routes.ts` (which targeted the unqualified `public.nv_audit_logs` and bypassed the chain entirely) has been replaced. A scanning test fails the build if any new file outside `nv-sdk-tracking-middleware.ts` introduces a direct `INSERT INTO (nv_schema.)?nv_audit_logs` statement. | SOC 2 CC7.2, CC7.3 · NIST 800-53 AU-9 | `src/middleware/nv-sdk-tracking-middleware.ts` (`export async function appendAuditRecord`); `src/routes/nv-sdk-keylife-routes.ts` (calls `appendAuditRecord`); chain target is `nv_schema.nv_audit_logs` (canonical), legacy `public.nv_audit_logs` table is now writer-free | `tests/unit/security/hash-chain.test.ts` ("Universal hash-chain enforcement — no direct audit-log INSERTs") |
| **Fail-closed enforcement on security-critical operations** — when `appendAuditRecord` raises on a chain-integrity failure during SDK key creation, the handler does **not** swallow it. Instead it (a) marks the just-issued key `is_active=false` so it cannot authenticate, and (b) returns HTTP 500 with code `NYV-KEYLIFE-AUDIT-001` so the caller retries. An unauditable raw key never escapes the handler. | SOC 2 CC7.2 · NIST 800-53 AU-9, AU-12 | `src/routes/nv-sdk-keylife-routes.ts` (catch block around `appendAuditRecord` → compensating UPDATE + 500) | `tests/unit/security/hash-chain.test.ts` ("SDK key-lifecycle route fails closed when chain enforcement fails") |

---

## 5. Operational Controls

| Control | Standard | Implementation |
|---|---|---|
| All security-relevant configuration is supplied via secrets / environment variables and validated at boot. | SOC 2 CC6.1 · ISO 27001 A.8.24 | `src/utils/env-validator.ts`, `src/startup/nv-environment-validator.ts` |
| Startup logs the active backends (Redis, encryption key fingerprint, RLS migration status) so operators can verify the security posture from log inspection alone. | SOC 2 CC4.1 · NIST 800-53 AU-2 | `initPiiVaultCleanup`, `fieldEncryption.fingerprint()` |
| Migration runner refuses to start the application if pending migrations would put security controls into an inconsistent state. | SOC 2 CC8.1 | `src/startup/nv-migration-safety-runner.ts` |

---

## 6. Test Suite Index

| File | Covers |
|---|---|
| `tests/unit/security/pii-vault.test.ts` | Distributed PII vault — Redis path, in-memory fallback, TTL enforcement, degraded-mode warning |
| `tests/unit/security/rls.test.ts` | RLS migration coverage; middleware sets `app.current_org_id`; live cross-tenant query gated on `DATABASE_URL` |
| `tests/unit/security/field-encryption.test.ts` | `encryptedExpr` / `decryptedExpr` SQL fragment shape; column-id validation; in-process round-trip |
| `tests/unit/security/hash-chain.test.ts` | Real-time enforcement — broken chain throws; concurrent writers serialize; backup verifier still works |

Run with `npx vitest run tests/unit/security/`. The RLS live test
auto-skips when `DATABASE_URL` is unset.
