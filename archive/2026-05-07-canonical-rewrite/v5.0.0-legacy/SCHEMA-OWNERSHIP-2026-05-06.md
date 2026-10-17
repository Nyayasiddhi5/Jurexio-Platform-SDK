# Nyayavigya Schema Ownership Map

**Date**: 2026-05-06
**Status**: Living document — update on every schema change
**Source of truth**: `shared/schema.ts` (single file, 1954 LOC, 87 tables)

---

## 1. Two-tier schema model

| Schema | Purpose | Owner | Examples |
|---|---|---|---|
| `nv_schema.*` | Governance, audit, agent personas, PII vault, hash chain, GRPO runs | NYV Backbone (this repo) | `nv_audit_chain`, `nv_grpo_runs`, `nv_agent_personas`, `nv_pii_vault` |
| `public.*` | App data — SDK app keys, SDK usage metrics, user data | NYV Backbone (this repo) | `sdk_app_api_keys`, `sdk_usage_metrics`, `users`, `organizations` |

> The split exists because audit/governance data has different retention, RLS, and access patterns from app data. Do **not** mix them.

---

## 2. Table inventory by domain (87 tables)

### 2.1 Document subsystem (15 tables) — see `DOCUMENT-MANAGEMENT-AUDIT-AND-PLAN-2026-05-06.md`
| Table | OrgId? | Verdict |
|---|---|---|
| `ns_parsed_documents` | ✅ | ★ Canonical |
| `ns_doc_processing_jobs` | ✅ | ★ Canonical |
| `ns_rag_document_chunks` | ✅ | ★ Canonical |
| `ns_document_graph` | ✅ | ★ Canonical |
| `nv_case_documents` | ❌ | 🔴 Legacy — needs `org_id` backfill (D1 in audit) |
| `nv_document_embeddings` | ❌ | 🔴 Legacy — needs `org_id` backfill |
| `document_processing_jobs` | ❌ | 🔴 Legacy — drop after migration |
| `document_pages` | ? | Verify usage |
| `document_extracted_content` | ? | Verify usage |
| `document_parsing` | ? | Verify usage |
| `nv_identity_extractions` | ❌ | 🟠 Add `org_id` |
| `sdk_document_templates` | ✅ | OK |
| `nv_legal_templates` | ✅ | OK |
| `nv_template_clauses` | ✅ | OK |
| `nv_statute_versions` | n/a (global) | OK |

### 2.2 Multi-tenancy core (8 tables)
- `users`, `organizations`, `org_members`, `org_invitations`
- `sdk_app_api_keys`, `sdk_apps`, `sdk_app_agent_allocations`
- `nv_org_settings`

### 2.3 AI agents & orchestration (12 tables)
- `nv_agent_personas`, `nv_agent_versions`, `nv_agent_executions`
- `nv_orchestration_plans`, `nv_orchestration_steps`
- `nv_grpo_runs`, `nv_grpo_episodes`
- `nv_routing_decisions`, `nv_routing_overrides`
- `nv_capability_manifest_snapshots`
- `nv_a2a_messages`, `nv_a2a_sessions`

### 2.4 Governance & audit (10 tables)
- `nv_audit_chain` (hash-chain), `nv_audit_records`
- `hitl_workflows`, `hitl_decisions`, `hitl_approvals`
- `nv_pii_vault`, `nv_pii_redaction_log`
- `nv_compliance_evidence`, `nv_drift_alerts`
- `nv_regulatory_updates`

### 2.5 LLM provider routing (6 tables)
- `nv_llm_providers`, `nv_llm_models`, `nv_llm_usage`
- `nv_llm_budgets`, `nv_llm_priority_rules`, `nv_llm_fallback_chains`

### 2.6 SDK consumption (8 tables)
- `sdk_usage_metrics`, `sdk_rate_limit_buckets`
- `sdk_webhook_subscriptions` (planned), `sdk_webhook_deliveries` (planned)
- `nv_sdk_provisioning_log`
- `sdk_clause_library`
- `nv_sdk_plan_quotas` (planned)

### 2.7 Legal-domain knowledge (10 tables)
- `nv_statute_versions`, `nv_statute_amendments`
- `nv_jurisdiction_profiles`, `nv_constitutional_articles`
- `nv_case_law_citations`, `nv_case_law_summaries`
- `template_library`, `nv_legal_templates`, `nv_template_clauses`
- `nv_legal_taxonomy`

### 2.8 Bot services & persistence (6 tables)
- `nv_clawd_sessions`, `nv_openbot_configs`
- `nv_automateai_workflows`, `nv_automateai_executions`
- `nv_twindesk_twins`, `nv_skillshop_skills`

### 2.9 Email / outbound automation (5 tables — `wai_*`)
- `wai_campaigns`, `wai_recipients`, `wai_email_log`, `wai_templates`, `wai_unsubscribes`
- **Verdict**: ⚠️ Suspected non-backbone (marketing). Audit + relocate to dedicated marketing service in v5.0.2.

### 2.10 Misc / utility (7 tables)
- `nv_feature_flags`, `nv_system_health_snapshots`
- `nv_smoke_test_runs`, `nv_smoke_probe_results`
- `nv_api_keys` (legacy), `nv_session_tokens`, `nv_password_resets`

---

## 3. Naming conventions (enforced)

| Prefix | Owner | Example |
|---|---|---|
| `nv_*` | NYV backbone (governance/audit/agents/LLM/legal-domain) | `nv_agent_personas` |
| `ns_*` | NS-scaled doc subsystem (orgId-first, partition-ready) | `ns_parsed_documents` |
| `sdk_*` | SDK consumption surface (apps, keys, usage, quotas) | `sdk_app_api_keys` |
| `hitl_*` | Human-in-the-loop workflows | `hitl_decisions` |
| `wai_*` | ⚠️ Email/outbound (non-backbone candidate) | `wai_campaigns` |
| `template_*`, `users`, `organizations` | Generic / legacy unprefixed | — |

**Rule (added 2026-05-06)**: All NEW tables in this repo MUST start with `nv_*` (governance/audit/agents) or `ns_*` (orgId-first scale tables) or `sdk_*` (SDK surface). No new unprefixed table names.

---

## 4. Cross-table FK contracts (critical)

| Child table | FK column | Parent table | Cascade |
|---|---|---|---|
| `sdk_app_api_keys` | `app_id` | `sdk_apps.id` | RESTRICT |
| `sdk_usage_metrics` | `api_key_id` | `sdk_app_api_keys.id` | CASCADE |
| `ns_parsed_documents` | `organization_id` | `organizations.id` | RESTRICT |
| `ns_rag_document_chunks` | `document_id` | `ns_parsed_documents.document_id` | CASCADE |
| `nv_audit_chain` | `prev_hash` | `nv_audit_chain.record_hash` | RESTRICT (immutable) |

---

## 5. Migration discipline

- **Drizzle is authoritative** for schema definition.
- `drizzle-kit push` requires TTY in dev; in CI/EC2 use `psql` with idempotent `CREATE TABLE IF NOT EXISTS` for new tables.
- Every schema change MUST:
  1. Update `shared/schema.ts`
  2. Update this document (table inventory + ownership)
  3. Add migration script in `scripts/migrations/YYYY-MM-DD-description.sql`
  4. Bump `NYV_PLATFORM_VERSION` patch (5.0.1 → 5.0.2)
  5. Add CHANGELOG entry

---

**Maintainer note**: Re-run `rg -n "pgTable\\(" shared/schema.ts | wc -l` after each PR. Number must match this document's count (currently 87).
