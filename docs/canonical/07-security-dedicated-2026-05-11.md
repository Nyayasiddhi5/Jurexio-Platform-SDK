---
status: live
version: 5.0.1
audience: security reviewers, CISOs, compliance officers, SOC/SOC2 prep
last_updated: 2026-05-11 (Session-15 v13 — Phase 6 doc closure)
authority: NV-DOC-001 — dedicated security canonical
expands: `07-pre-deploy-plan-2026-05-07.md` (kept as the operational pre-deploy checklist) and `09-uat-and-compliance-2026-05-08.md` § G hash-chain audit
---

# Nyayavigya Platform — Security & Compliance Posture (Dedicated Canonical)

> **The screen-source for: identity, transport, data-at-rest, tenancy, audit, secret-management, prompt-injection defence, regulatory mapping (DPDP, GDPR, SOC2 prep).**

---

## 1 — Identity & access

### 1.1 User authentication

| Surface | Mechanism | Token TTL | Refresh |
|---|---|---|---|
| Console UI | JWT (HS256, secret = `JWT_SECRET`) | 24 h (dev) / **TIGHTEN to 4 h before prod** | Rotating refresh token, 90 d (dev) / 30 d prod |
| SDK callers | API key (`X-API-Key` header) | n/a (long-lived) | revoke + reissue |
| East-west | Inter-service header (`X-NV-API-Key`) | n/a | rotate per release |
| Streaming (SSE/WS) | Short-lived stream token derived from JWT (`issueStreamToken`) | 5 min | re-issue from JWT |

Refresh-token rotation bug fixed 2026-05-10 (NV-AUTH-FIX) — `rotateRefreshToken` now does string-eq on `user_id` and queries `nv_users` (not the non-existent `users` table).

### 1.2 Authorisation (RBAC)

Role hierarchy (numerical, in `src/middleware/nv-auth.ts`):

| Role | Level | Notes |
|---|---|---|
| `super_admin` | 10 | Cross-org, can edit any per-org overlay, can flip feature flags |
| `org_admin` | 9 | Owns a single org; edits org-platform-settings + per-org console layout |
| `manager` | 8 | Approves HITL items, manages workflows |
| `senior_analyst` | 7 | GRPO training dashboard, advanced agent flows |
| `analyst` | 6 | Operations dashboards, lineage views |
| `operator` | 5 | Agent registry browsing, decision cards |
| `developer` | 4 | SDK developer console, API playground |
| `viewer` | 3 | Read-only dashboards |
| `user` | 2 | Default end-user |
| `guest` | 1 | Pre-auth |

`requireRole(...)` middleware enforces the minimum on every protected route. `ProtectedRoute minRole=` enforces it client-side too (server is the source of truth).

### 1.3 SDK key scopes

**Source of truth: `nv_schema.sdk_app_api_keys.scopes` (NOT `src/config/nv-sdk-variants.ts`).** The variant config is a documentation aid; runtime always reads from the DB. Reissuing a key updates the DB row; cache invalidation is per-key (60s TTL).

---

## 2 — Transport security

| Hop | Protection |
|---|---|
| Internet → ALB / nginx | TLS 1.3, ACM-managed wildcard cert (`*.nyayasiddhi.online`); HSTS 31536000 |
| ALB / nginx → Gateway | Private subnet (no TLS — VPC isolation) |
| Gateway → Postgres (RDS) | TLS via `sslmode=require`; cert in `aws-global-bundle.pem` |
| Gateway → Redis (ElastiCache) | TLS + token auth (`NYV_REDIS_TCP_URL` includes `rediss://` + token) |
| Gateway → LLM providers | TLS to provider HTTPS endpoints |
| Gateway ↔ Gateway (east-west) | Private subnet + `X-NV-API-Key` |
| Console UI ↔ Gateway | Same-origin via Vite proxy in dev; HTTPS in prod |

**Per-deploy network bridge**: every `docker compose up` from a fresh dir creates a NEW project-scoped network — recovery via `nyv-gateway-bridge.service` systemd unit. Documented as a gotcha in `replit.md`.

---

## 3 — Data at rest

| Datum | Store | Encryption |
|---|---|---|
| User PII | `nv_schema.nv_pii_vault` | **AES-256-GCM**, per-row IV, key from `NV_PII_ENCRYPTION_KEY` (64-hex) |
| LLM transcripts | `nv_messages` | RDS at-rest encryption (KMS) — plaintext in DB |
| Audit chain | `nv_schema.nv_audit_logs_hash_chain` | RDS KMS at-rest; tamper detection via SHA-256 chain |
| API keys | `nv_schema.sdk_app_api_keys` | Stored as bcrypt-style hash; raw key shown ONCE on creation |
| Refresh tokens | `nv_refresh_tokens` | Stored as SHA-256 hash; raw token only in HTTP-only cookie |
| Documents (1 GB pipeline) | tmp disk during conversion → optional S3 archive | server-side S3 KMS when archived |
| Redis cache | ElastiCache | encryption-in-transit + at-rest (KMS) |

### 3.1 PII redaction in LLM path

The safety ring station 8 (`orchestrateLLM`) only sees PII-redacted prompts when the `services/pii-redaction-service.ts` flag is on. Original PII is stored encrypted in `nv_pii_vault` keyed by `pii_token`, and the response engineering station re-substitutes the plaintext on the way back to the caller. **At no point is unredacted PII sent to a third-party LLM provider** when the redaction flag is on (default ON).

---

## 4 — Multi-tenancy (defence-in-depth)

Three independent rings, all required to be bypassed for a cross-tenant breach:

1. **Express middleware** — `tenantIsolation` in `src/middleware/nv-tenant-isolation.ts`. 403s any request whose body claims a different tenant than the authenticated identity.
2. **Postgres RLS** — `drizzle/0004_enable_rls_for_tenant_tables.sql`. Even a raw query bypassing the Express layer is filtered by `current_setting('app.current_tenant')`.
3. **Per-tenant rate limit** — `sdkApiKeyRateLimit`. Limits any single tenant's blast radius from a hijacked key.

Verification: T7 deploy 2026-05-07 + 40/40 UAT 2026-05-09 confirmed cross-tenant 403 on attack inputs. → canonical doc 09 § Appendix E.7.

---

## 5 — Audit & non-repudiation

### 5.1 Hash-chained audit log

Every safety-ring station appends one row per request to `nv_schema.nv_audit_logs_hash_chain`:

```
{ id, prev_hash, payload (JSONB), payload_hash, chain_hash = sha256(prev_hash || payload_hash), created_at }
```

Tamper detection: `services/hash-chain-verifier.ts` walks the chain and reports the first row where `chain_hash ≠ sha256(prev_hash || payload_hash)`.

Repair tolerance: when a known-good break is being patched, `NYV_AUDIT_CHAIN_TOLERATE=1` lets the verifier emit warnings instead of hard-failing — used during the staged migration windows. **MUST be reverted to unset in prod.**

### 5.2 What's logged

Every request: tenant, user (or apiKeyHash), route, status, latency, prompt-hash, response-hash, model+provider chosen, fallback chain attempted, cost in micro-USD, HITL-state.

Retention: 90 days hot in RDS, ≥ 7 years cold in S3 with KMS + Object Lock for SOC2 prep.

---

## 6 — Secret management (NV-SECRETS-001)

One canonical name per concept. Aliases are explicitly listed in `replit.md` § NV-SECRETS-001.

| Concept | Canonical env | Resolver |
|---|---|---|
| Postgres URL | `NYV_DATABASE_URL` (or `DATABASE_URL`) | direct |
| Redis (write/TCP) | `NYV_REDIS_TCP_URL` | `resolveRedisTcpUrl()` |
| Redis (read) | `NYV_REDIS_READ_URL` | `resolveRedisReadUrl()` |
| JWT signing | `JWT_SECRET` | `nv-auth.ts` |
| JWT refresh | `NYV_JWT_REFRESH_SECRET` | `nv-auth.ts` |
| PII vault key | `NV_PII_ENCRYPTION_KEY` (64-hex) | `pii-vault-service.ts` |
| Encryption-at-rest field key | `ENCRYPTION_KEY` | `nv-field-encryption.ts` |
| LLM provider keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | `provider-registry` |
| SDK keys | `NYV_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}` | DB-backed source of truth |

Vault: Replit Secrets (dev) / AWS Secrets Manager + systemd env file (EC2).

Rotation cadence (target): JWT secret 90 d, PII key never (hard rotation requires migration), provider keys 180 d, SDK keys per-customer.

---

## 7 — Prompt-injection defence

Three concentric layers around station 8:

1. **Input filter** — `src/middleware/orchestration-guardrails.ts` strips known jailbreak patterns (`ignore previous`, `system:`, base64 wrappers).
2. **Prompt envelope** — the 22-section Parlant template wraps user input in a `<user_input>` XML envelope so the model sees the boundary explicitly.
3. **Output verifier** — station 10 (`hallucination-checker`) refuses responses that match exfiltration patterns (system-prompt leak, secret-key shape, internal URL) and triggers HITL review.

Red-team evidence in `nv_schema.adversarial_test_runs` (Drizzle table `nvAdversarialTestRuns`).

---

## 8 — Regulatory mapping

### 8.1 DPDP (India, 2023)

- **Lawful basis**: consent captured at sign-up + per-document upload.
- **Purpose limitation**: the `purpose` field on every `nv_documents` row is enforced server-side; cross-purpose access requires re-consent.
- **Cross-border transfer**: `NYV_F_SOVEREIGN_IN=on` restricts LLM emission to AgentZero + Bedrock IN-region (no US/EU egress).
- **Right-to-erasure**: `services/dsar-service.ts` exposes `/api/nv/dsar/{export,delete}`; PII vault deletion cascades + audit row appended.

### 8.2 GDPR (EU)

- Same DSAR endpoints. EU-resident data path uses `NYV_F_SOVEREIGN_EU=on` → Mistral + Bedrock EU-region (when Mistral key set).
- DPA available on request; data sub-processors list maintained alongside.

### 8.3 SOC2 (Type I prep)

- All five trust criteria scoped: Security, Availability, Processing Integrity, Confidentiality, Privacy.
- Access reviews: per-org admin can audit `/rbac-console`; super_admin can audit `nv_audit_logs` directly.
- Change management: every merge runs `npm run guardrail` (CI-enforced) which blocks on auth-header / script-DB / API-contract / flat-registry / tracker-fresh / never-break.

### 8.4 ISO/IEC 27001 (gap noted)

- ISMS scoping document NOT yet authored — tracked as post-GA work.

---

## 9 — Pre-prod hardening checklist

Before flipping `NODE_ENV=production`:

- [ ] `JWT_SECRET` rotated and stored in AWS Secrets Manager
- [ ] `NV_PII_ENCRYPTION_KEY` confirmed non-default (≠ test key)
- [ ] `SECURITY_CONFIG.session.jwtExpiryHours` tightened **24 → 4**
- [ ] `SECURITY_CONFIG.session.refreshTokenExpiryDays` tightened **90 → 30**
- [ ] `NYV_AUDIT_CHAIN_TOLERATE` unset (verify via `printenv`)
- [ ] `NYV_DOC_ACCESS_MODE=strict` (default in prod, explicit set anyway)
- [ ] Redis ACL token rotated
- [ ] Provider keys live (not test keys) for all 6 active providers
- [ ] WAF rule set deployed at ALB (rate, OWASP top-10, geo-deny if applicable)
- [ ] Hash-chain verifier scheduled hourly via cron / EventBridge
- [ ] Backup test: restore latest RDS snapshot to staging and run smoke

Operational pre-deploy commands and per-step evidence remain in `07-pre-deploy-plan-2026-05-07.md` (kept as the runbook companion to this posture doc).

---

## 10 — What's NOT covered here

- **Operational runbook** for incident response → ship as `12-incident-response-*.md` later.
- **Vulnerability scan results** — run via `runDependencyAudit` + `runSastScan` on demand.
- **Threat model (STRIDE / PASTA)** — pending; tracked as post-GA in tracker §5.

---

*End of security dedicated canonical.*
