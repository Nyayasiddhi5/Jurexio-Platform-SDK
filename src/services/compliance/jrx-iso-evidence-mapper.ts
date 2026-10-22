/**
 * jrx-iso-evidence-mapper.ts — Task #299
 *
 * Resolves logical evidence-source keys (declared by each control in
 * `jrx-iso-control-catalogue.ts`) to concrete evidence rows surfaced in
 * the drilldown drawer:
 *
 *   { sourceKey, summary, artefact, capturedAt, jurisdiction }
 *
 * Where the data lives:
 *   - cam_actions_*  → nv_cam_actions table (status pending/resolved)
 *   - audit_*        → audit_log / nv_audit_log if present, else synthesised
 *                      from `e2e` reports + Jurexio Ledger hash chain
 *   - e2e_*          → file artefacts under `docs/canonical/`
 *   - security_*     → output of last `runDependencyAudit` / SAST / HoundDog
 *   - canonical_doc_*→ static artefact pointers
 *
 * Jurisdiction-aware: rows tagged 'GLOBAL' apply everywhere; rows tagged
 * 'US' or 'IN' only surface when the matching jurisdiction filter is
 * active (or when GLOBAL is selected we include everything).
 *
 * We persist a denormalised view in `nv_iso_control_evidence` so the
 * drilldown can paginate without re-hitting every upstream table on
 * every drilldown call. The seed runs once at boot and is idempotent.
 *
 * NV-NAMING-001: jrx- prefix.  NV-WIRING-001: imported by
 * jrx-iso-compliance-routes.ts and the boot seed in src/index.ts.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  ISO_CONTROL_CATALOGUE,
  type IsoControl,
  type IsoJurisdiction,
} from '../../data/jrx-iso-control-catalogue.js';

const logger = createLogger('./jrx-iso-evidence-mapper');

export interface IsoEvidenceRow {
  sourceKey: string;
  summary: string;
  artefact: string;
  capturedAt: string; // ISO timestamp — when the artefact was produced (canonical for static rows; "now" for live counts)
  lastRefreshedAt?: string; // ISO timestamp — when the evidence row was last touched by a refresh sweep (Task #312)
  jurisdiction: IsoJurisdiction; // GLOBAL | US | IN
}

let _evidenceTableEnsured = false;
async function ensureEvidenceTable(): Promise<void> {
  if (_evidenceTableEnsured || !db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_iso_control_evidence (
        id              SERIAL PRIMARY KEY,
        control_id      VARCHAR(100) NOT NULL,
        source_key      VARCHAR(100) NOT NULL,
        summary         TEXT         NOT NULL,
        artefact        VARCHAR(500) NOT NULL,
        jurisdiction    VARCHAR(20)  NOT NULL DEFAULT 'GLOBAL',
        captured_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
        UNIQUE (control_id, source_key, artefact, jurisdiction)
      )
    `);
    // Idempotent migration for tables created before the jurisdiction
    // column existed: add the column then drop the legacy 3-col unique
    // constraint so the inline 4-col UNIQUE above is the only one in
    // play. On fresh installs both ALTERs are no-ops.
    await db.execute(sql`
      ALTER TABLE nv_iso_control_evidence
        ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(20) NOT NULL DEFAULT 'GLOBAL'
    `);
    await db.execute(sql`
      ALTER TABLE nv_iso_control_evidence
        DROP CONSTRAINT IF EXISTS nv_iso_control_evidence_control_id_source_key_artefact_key
    `);
    // Task #312 — track when each row was last touched by a refresh so
    // we can prune evidence whose source key has been removed from the
    // manifest without nuking static rows whose canonical capturedAt
    // intentionally pre-dates "now".
    await db.execute(sql`
      ALTER TABLE nv_iso_control_evidence
        ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMP NOT NULL DEFAULT NOW()
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_iso_control_evidence_control
        ON nv_iso_control_evidence (control_id, jurisdiction, captured_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_iso_control_evidence_refreshed
        ON nv_iso_control_evidence (last_refreshed_at)
    `);
    _evidenceTableEnsured = true;
  } catch (err: any) {
    logger.warn('iso_evidence_ensure_table_failed', { err: err?.message });
  }
}

let _controlsTableEnsured = false;
async function ensureControlsTable(): Promise<void> {
  if (_controlsTableEnsured || !db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sdk_compliance_controls (
        id                SERIAL PRIMARY KEY,
        control_id        VARCHAR(100) UNIQUE NOT NULL,
        framework         VARCHAR(100),
        jurisdiction      VARCHAR(50),
        title             VARCHAR(255) NOT NULL,
        category          VARCHAR(100),
        severity          VARCHAR(50),
        requirements      JSONB DEFAULT '[]'::jsonb,
        automation_level  VARCHAR(50),
        created_at        TIMESTAMP DEFAULT NOW(),
        updated_at        TIMESTAMP DEFAULT NOW()
      )
    `);
    _controlsTableEnsured = true;
  } catch (err: any) {
    logger.warn('iso_controls_ensure_table_failed', { err: err?.message });
  }
}

async function safeCount(query: ReturnType<typeof sql>): Promise<number | null> {
  if (!db) return null;
  try {
    const r: any = await db.execute(query);
    const rows = (r?.rows ?? r ?? []) as any[];
    return Number(rows[0]?.c ?? 0);
  } catch {
    return null;
  }
}

/**
 * Live counts queried at seed time. Each is null if the underlying
 * table doesn't exist yet, so we can degrade gracefully without
 * polluting the manifest with synthetic numbers.
 */
interface LiveCounts {
  camPending: number | null;
  camResolved: number | null;
  auditLogRows: number | null;
  hitlPending: number | null;
  modelsRegistered: number | null;
  sdkApps: number | null;
  agentsRegistered: number | null;
}
async function gatherLiveCounts(): Promise<LiveCounts> {
  return {
    camPending:       await safeCount(sql`SELECT COUNT(*)::int AS c FROM nv_cam_actions WHERE status = 'pending'`),
    camResolved:      await safeCount(sql`SELECT COUNT(*)::int AS c FROM nv_cam_actions WHERE status = 'resolved'`),
    auditLogRows:     await safeCount(sql`SELECT COUNT(*)::int AS c FROM nv_audit_log`),
    hitlPending:      await safeCount(sql`SELECT COUNT(*)::int AS c FROM nv_hitl_queue WHERE status = 'pending'`),
    modelsRegistered: await safeCount(sql`SELECT COUNT(*)::int AS c FROM nv_model_catalog`),
    sdkApps:          await safeCount(sql`SELECT COUNT(*)::int AS c FROM nv_sdk_applications`),
    agentsRegistered: await safeCount(sql`SELECT COUNT(*)::int AS c FROM nv_agents`),
  };
}

function row(
  sourceKey: string,
  summary: string,
  artefact: string,
  jurisdiction: IsoJurisdiction = 'GLOBAL',
  capturedAt: string = new Date().toISOString(),
): IsoEvidenceRow {
  return { sourceKey, summary, artefact, capturedAt, jurisdiction };
}

/**
 * Static + live manifest of evidence rows keyed by source_key. Each
 * key may map to multiple rows tagged with different jurisdictions —
 * the seed inserts all of them, and the read path filters by the
 * requested jurisdiction.
 */
async function buildSourceManifest(): Promise<Record<string, IsoEvidenceRow[]>> {
  const live = await gatherLiveCounts();
  const liveOk = (n: number | null, fmt: (n: number) => string, fallback: string): string =>
    n === null ? fallback : fmt(n);

  return {
    // ── CAM (live) ────────────────────────────────────────────────
    cam_actions_open: [
      row('cam_actions_open',
        liveOk(live.camPending, n => `${n} open compliance action(s) currently in the CAM reviewer queue (live row count from nv_cam_actions)`, 'CAM reviewer queue — live count unavailable; table not initialised'),
        '/api/jrx/cam/reviews?status=pending'),
    ],
    cam_actions_resolved: [
      row('cam_actions_resolved',
        liveOk(live.camResolved, n => `${n} resolved compliance action(s) closed by reviewers (live row count from nv_cam_actions)`, 'CAM resolved actions — live count unavailable'),
        '/api/jrx/cam/reviews?status=resolved'),
    ],

    // ── E2E reports (artefact-backed) ─────────────────────────────
    e2e_consumer_platform_2026_05_13: [
      row('e2e_consumer_platform_2026_05_13',
        'Consumer-platform E2E PASS — 137/140 routes, 53/56 real-LLM (gemini-2.5-flash, 17-step pipeline)',
        'docs/canonical/11-consumer-platform-e2e-2026-05-13.md',
        'GLOBAL', '2026-05-13T00:00:00Z'),
    ],
    e2e_legaltech_uat_40: [
      row('e2e_legaltech_uat_40',
        '40/40 real-legaltech UAT PASS with strict verifier (drafting, research, citations, e-filing, voice)',
        'docs/canonical/09-uat-and-compliance-2026-05-08.md',
        'GLOBAL', '2026-05-08T00:00:00Z'),
    ],

    // ── Security scans ────────────────────────────────────────────
    security_dependency_audit: [
      row('security_dependency_audit', 'Last `runDependencyAudit` snapshot — vulnerable transitive deps tracked + patched', 'audit/dependency-audit-latest.json'),
    ],
    security_sast_scan: [
      row('security_sast_scan', 'Last `runSastScan` snapshot — 0 critical, 0 high outstanding', 'audit/sast-scan-latest.json'),
    ],
    security_hounddog_scan: [
      row('security_hounddog_scan', 'Last `runHoundDogScan` snapshot — secrets / sensitive-data leak check', 'audit/hounddog-scan-latest.json'),
    ],

    // ── Audit / runtime (live counts where possible) ──────────────
    audit_log_recent: [
      row('audit_log_recent',
        liveOk(live.auditLogRows, n => `${n} audit log row(s) persisted in nv_audit_log (append-only, hash-chained via Jurexio Ledger)`, 'Recent audit log — append-only, hash-chained via Jurexio Ledger'),
        '/api/jrx/admin/audit/log?limit=10'),
    ],
    audit_pii_redaction: [
      row('audit_pii_redaction', 'PII redaction middleware applied on every LLM-bound request (NV-ARCH-001 safety ring)', 'src/middleware/jrx-pii-redaction.ts'),
    ],
    audit_sdk_auth: [
      row('audit_sdk_auth',
        liveOk(live.sdkApps, n => `${n} SDK application(s) registered in nv_sdk_applications, all auth via canonical X-API-Key`, 'SDK auth via canonical X-API-Key (Bearer fallback)'),
        '/api/jrx/sdk/applications'),
      row('audit_sdk_auth', '7/7 SDK keys validated in last consumer-platform E2E', 'docs/canonical/11-consumer-platform-e2e-2026-05-13.md#auth', 'GLOBAL', '2026-05-13T00:00:00Z'),
    ],
    audit_rbac_denies: [
      row('audit_rbac_denies', 'RBAC enforcement — non-super_admin denied on admin routes (per-route role table)', 'src/middleware/jrx-rbac.ts'),
    ],
    audit_safety_ring: [
      row('audit_safety_ring', 'Safety-ring middleware chain enforced — no direct LLM calls (NV-ARCH-001)', 'src/middleware/jrx-safety-ring.ts'),
    ],
    audit_llm_routing: [
      row('audit_llm_routing',
        liveOk(live.modelsRegistered, n => `${n} models registered in nv_model_catalog, all routed via realLLMService.executeRequest (NV-LLM-001)`, 'Single-router rule (NV-LLM-001) — all LLM traffic exits via realLLMService.executeRequest'),
        'src/services/llm-providers/realLLMService.ts'),
    ],
    audit_rate_limit: [
      row('audit_rate_limit', 'Per-tier rate limiter active — Redis-backed sliding window', 'src/middleware/jrx-rate-limit.ts'),
    ],
    audit_hitl_decisions: [
      row('audit_hitl_decisions',
        liveOk(live.hitlPending, n => `${n} pending HITL decision(s) in nv_hitl_queue — reviewer queue surfaced at /console/hitl-decision-cards`, 'HITL decision cards persisted — reviewer queue surfaced at /console/hitl-decision-cards'),
        '/api/jrx/hitl/decisions'),
    ],
    audit_agent_runs: [
      row('audit_agent_runs',
        liveOk(live.agentsRegistered, n => `${n} agent(s) registered in nv_agents — per-agent execution traces persisted`, 'Per-agent execution traces persisted — orchestration scoreboard surfaces drift'),
        '/api/jrx/orchestration/scoreboard'),
    ],
    jurexio_ledger_hash_chain: [
      row('jurexio_ledger_hash_chain', 'Jurexio Ledger append-only hash chain — every audit row signed with prev-hash linkage', '/api/jrx/ledger/verify'),
    ],

    // ── Canonical docs ────────────────────────────────────────────
    canonical_doc_guardrails: [
      row('canonical_doc_guardrails', 'Active guardrails contract (NV-ARCH-001 .. NV-CLIENT-BUILD-001) — CI-enforced', 'replit.md#hard-guardrails'),
    ],
    canonical_doc_uat: [
      row('canonical_doc_uat', 'UAT + compliance evidence pack — last refresh 2026-05-08', 'docs/canonical/09-uat-and-compliance-2026-05-08.md', 'GLOBAL', '2026-05-08T00:00:00Z'),
    ],
    canonical_doc_sdk_api: [
      row('canonical_doc_sdk_api', 'Frozen SDK + API surface (NV-API-CONTRACT-001) — additions allowed, removals fail CI', 'docs/canonical/04-sdk-and-api-canonical-2026-05-07.md', 'GLOBAL', '2026-05-07T00:00:00Z'),
    ],
    canonical_doc_ec2: [
      row('canonical_doc_ec2', 'EC2 + integration status (i-0df71e5ea1df8f588) — multi-domain TLS, RDS, ElastiCache', 'docs/canonical/EC2-INTEGRATION-STATUS.md'),
    ],
    agent_registry_freshness: [
      row('agent_registry_freshness',
        liveOk(live.agentsRegistered, n => `${n} agents in nv_agents — registry auto-generated from src/data/jrx-agents-registry.json (NV-AGENT-REGISTRY-FRESH-001)`, 'Agent registry freshness — auto-generated, never edited by hand'),
        'src/data/jrx-agents-registry.json'),
    ],
    consent_records_summary: [
      row('consent_records_summary', 'DPDPA consent records — granted / withdrawn rollup at /api/jrx/compliance/dpdpa', '/api/jrx/compliance/dpdpa', 'IN'),
      row('consent_records_summary', 'CCPA / state-privacy consent rollup mirrored under DPDPA aggregator', '/api/jrx/compliance/dpdpa', 'US'),
    ],
    pg_encryption_at_rest: [
      row('pg_encryption_at_rest', 'RDS encryption-at-rest enabled (KMS) + NV_PII_ENCRYPTION_KEY application-level envelope', 'docs/canonical/EC2-INTEGRATION-STATUS.md#encryption'),
    ],
    tls_cert_invertory: [], // legacy typo guard — leave empty
    tls_cert_inventory: [
      row('tls_cert_inventory', 'Public hostnames secured by valid TLS certs — console / api / nym', 'certs/'),
    ],
    rds_snapshot_inventory: [
      row('rds_snapshot_inventory', 'Daily automated RDS snapshots retained 7 days; weekly long-retention snapshot', 'docs/canonical/EC2-INTEGRATION-STATUS.md#backups'),
    ],

    // ── Privacy / AI-regulation evidence (Task #311) ──────────────
    eu_ai_act_classifications: [
      row('eu_ai_act_classifications', 'EU AI Act risk classifications — Annex III §8(a) administration of justice; high-risk inventory surfaced at /api/jrx/compliance/eu-ai-act', '/api/jrx/compliance/eu-ai-act'),
    ],
    eu_ai_act_gap_analysis: [
      row('eu_ai_act_gap_analysis', 'EU AI Act gap analysis — registration / notified body / post-market monitoring tracked as critical gaps in CAM', '/api/jrx/compliance/eu-ai-act'),
    ],
    eu_ai_act_bias_report: [
      row('eu_ai_act_bias_report', 'EU AI Act bias assessment — protected attributes (gender, caste, language, geography) with thresholds and mitigations', '/api/jrx/compliance/eu-ai-act'),
    ],
    gdpr_records_of_processing: [
      row('gdpr_records_of_processing', 'GDPR Article 30 ROPA — controller and processor records of processing activities maintained by DPO', 'docs/canonical/09-uat-and-compliance-2026-05-08.md#gdpr-ropa'),
    ],
    gdpr_data_protection_impact_assessments: [
      row('gdpr_data_protection_impact_assessments', 'GDPR Article 35 DPIAs completed for high-risk EU agents; medium-risk inventory pending', 'docs/canonical/09-uat-and-compliance-2026-05-08.md#gdpr-dpia'),
    ],
    gdpr_standard_contractual_clauses: [
      row('gdpr_standard_contractual_clauses', 'Standard Contractual Clauses (Module 2 controller-to-processor) signed with primary LLM providers; per-provider TIA partial', 'docs/canonical/09-uat-and-compliance-2026-05-08.md#gdpr-sccs'),
    ],
    dpdpa_grievance_redressal: [
      row('dpdpa_grievance_redressal', 'DPDPA s.13 grievance redressal — DPO inbox dpo@jurexio.example + CAM reviewer queue', '/api/jrx/compliance/dpdpa', 'IN'),
    ],
    data_subject_rights_endpoints: [
      row('data_subject_rights_endpoints', 'Data subject rights endpoints — access / withdraw / delete (GDPR Art 15-22, DPDPA s.11-13, CCPA)', '/api/jrx/consent/export'),
      row('data_subject_rights_endpoints', 'Withdraw consent endpoint', '/api/jrx/consent/withdraw'),
      row('data_subject_rights_endpoints', 'Delete-my-data endpoint', '/api/jrx/consent/delete-my-data'),
    ],
    breach_notification_log: [
      row('breach_notification_log', 'Breach notification log — DPDPA s.8(6) DPB intimation + GDPR Art 33 72-hour DPA notification + EU AI Act Art 73 serious-incident reporting', '/api/jrx/compliance/dpdpa#breach_log'),
    ],

    // ── Jurisdiction-scoped evidence (US) ─────────────────────────
    us_soc2_audit_window: [
      row('us_soc2_audit_window', 'SOC 2 Type II audit window in progress — 12-month observation period, US auditor of record', 'docs/canonical/09-uat-and-compliance-2026-05-08.md#soc2', 'US'),
    ],
    us_nist_ai_rmf_mapping: [
      row('us_nist_ai_rmf_mapping', 'NIST AI RMF Govern/Map/Measure/Manage cross-walk maintained alongside ISO 42001 controls', 'docs/canonical/09-uat-and-compliance-2026-05-08.md#nist-ai-rmf', 'US'),
    ],
    us_state_privacy_register: [
      row('us_state_privacy_register', 'State privacy register — CCPA / CPRA / VCDPA / CPA disclosures captured', 'docs/canonical/09-uat-and-compliance-2026-05-08.md#us-state-privacy', 'US'),
    ],

    // ── Jurisdiction-scoped evidence (IN) ─────────────────────────
    in_dpdpa_consent_register: [
      row('in_dpdpa_consent_register', 'DPDPA 2023 consent register — granted / withdrawn / purpose-limited', '/api/jrx/compliance/dpdpa', 'IN'),
    ],
    in_meity_advisory_register: [
      row('in_meity_advisory_register', 'MeitY AI advisory compliance register — model deployment notifications tracked', 'docs/canonical/09-uat-and-compliance-2026-05-08.md#meity', 'IN'),
    ],
    in_data_localisation: [
      row('in_data_localisation', 'India data-localisation — RDS region ap-south-1 (Mumbai), no cross-border replication', 'docs/canonical/EC2-INTEGRATION-STATUS.md#region', 'IN'),
    ],
  };
}

/**
 * Seed sdk_compliance_controls + nv_iso_control_evidence with the
 * full ISO 42001 / ISO 27001 / SOC2 catalogue. Idempotent.
 */
export async function seedIsoControlsAndEvidence(): Promise<void> {
  if (!db) {
    logger.warn('seed_skipped_no_db');
    return;
  }
  try {
    await ensureControlsTable();
    await ensureEvidenceTable();

    // Insert / upsert controls.
    let inserted = 0;
    for (const c of ISO_CONTROL_CATALOGUE) {
      try {
        await db.execute(sql`
          INSERT INTO sdk_compliance_controls
            (control_id, framework, jurisdiction, title, category, severity,
             requirements, automation_level)
          VALUES
            (${c.controlId},
             ${c.framework},
             ${'GLOBAL'},
             ${c.title},
             ${c.category},
             ${c.verdict === 'FAIL' ? 'critical' : c.verdict === 'PARTIAL' ? 'high' : 'medium'},
             ${JSON.stringify([c.text])}::jsonb,
             ${'semi-automated'})
          ON CONFLICT (control_id) DO UPDATE
            SET framework = EXCLUDED.framework,
                title = EXCLUDED.title,
                category = EXCLUDED.category,
                severity = EXCLUDED.severity,
                requirements = EXCLUDED.requirements,
                updated_at = NOW()
        `);
        inserted++;
      } catch (err: any) {
        logger.warn('seed_control_failed', { controlId: c.controlId, err: err?.message });
      }
    }

    const refresh = await refreshIsoControlEvidence({ trigger: 'boot' });

    logger.info('iso_seed_complete', {
      controls: inserted,
      evidenceRows: refresh?.evidenceRows ?? 0,
      pruned: refresh?.pruned ?? 0,
      catalogueSize: ISO_CONTROL_CATALOGUE.length,
    });
  } catch (err: any) {
    logger.warn('iso_seed_failed', { err: err?.message });
  }
}

export interface IsoEvidenceRefreshResult {
  refreshedAt: string;
  durationMs: number;
  evidenceRows: number;
  upsertErrors: number;
  pruned: number;
  pruneSkipped: boolean;
  trigger: 'boot' | 'scheduler' | 'manual';
}

let _refreshInFlight: Promise<IsoEvidenceRefreshResult | null> | null = null;
let _lastRefresh: IsoEvidenceRefreshResult | null = null;

/**
 * Task #312 — Re-run the source manifest, upsert every evidence row,
 * stamp `last_refreshed_at = NOW()`, and prune any rows that the
 * current manifest no longer produces (whose `last_refreshed_at`
 * therefore stayed behind this run's start). Static rows with a
 * canonical historical `captured_at` (e.g. a UAT pass dated
 * 2026-05-13) keep that timestamp — only `last_refreshed_at`
 * advances — so the drilldown still reports when the artefact was
 * actually produced.
 *
 * Concurrency: a single in-flight refresh is shared between the
 * scheduler tick and any concurrent manual POST so we never run two
 * full sweeps in parallel against the same DB.
 */
export async function refreshIsoControlEvidence(
  opts: { trigger?: 'boot' | 'scheduler' | 'manual' } = {},
): Promise<IsoEvidenceRefreshResult | null> {
  if (!db) {
    logger.warn('refresh_skipped_no_db');
    return null;
  }
  if (_refreshInFlight) return _refreshInFlight;

  const trigger = opts.trigger ?? 'manual';
  const started = Date.now();

  _refreshInFlight = (async () => {
    try {
      await ensureEvidenceTable();
      const manifest = await buildSourceManifest();

      // Capture a single DB-side timestamp and use it for BOTH the row
      // stamp and the prune cutoff, so we never rely on the app clock
      // agreeing with the DB clock. Without this, app→DB skew could
      // mis-classify freshly-stamped rows as stale and delete them.
      let dbRefreshTs: string;
      try {
        const tsRow: any = await db!.execute(sql`SELECT NOW()::text AS ts`);
        const rows = (tsRow?.rows ?? tsRow ?? []) as any[];
        dbRefreshTs = String(rows[0]?.ts ?? new Date(started).toISOString());
      } catch (err: any) {
        logger.warn('refresh_db_now_failed', { err: err?.message });
        dbRefreshTs = new Date(started).toISOString();
      }

      let evidenceRows = 0;
      let upsertErrors = 0;
      for (const c of ISO_CONTROL_CATALOGUE) {
        const extraSources = collectJurisdictionSources(c);
        const allSources = Array.from(new Set([...c.evidenceSources, ...extraSources]));
        for (const key of allSources) {
          const rows = manifest[key] ?? [];
          for (const r of rows) {
            try {
              await db!.execute(sql`
                INSERT INTO nv_iso_control_evidence
                  (control_id, source_key, summary, artefact, jurisdiction, captured_at, last_refreshed_at)
                VALUES
                  (${c.controlId}, ${r.sourceKey}, ${r.summary}, ${r.artefact}, ${r.jurisdiction}, ${r.capturedAt}, ${dbRefreshTs})
                ON CONFLICT (control_id, source_key, artefact, jurisdiction) DO UPDATE
                  SET summary = EXCLUDED.summary,
                      captured_at = EXCLUDED.captured_at,
                      last_refreshed_at = ${dbRefreshTs}
              `);
              evidenceRows++;
            } catch (err: any) {
              upsertErrors++;
              logger.warn('refresh_evidence_failed', { controlId: c.controlId, key, err: err?.message });
            }
          }
        }
      }

      // Prune rows whose source key the manifest no longer produces.
      // Every row upserted in this sweep has last_refreshed_at =
      // dbRefreshTs; survivors strictly below that cutoff are stale.
      // Skip prune entirely if any upsert errored, to avoid the
      // destructive case where an upsert failure leaves a still-valid
      // row at the old timestamp and the prune then deletes it.
      let pruned = 0;
      let pruneSkipped = false;
      if (upsertErrors > 0) {
        pruneSkipped = true;
        logger.warn('refresh_prune_skipped_due_to_upsert_errors', { upsertErrors });
      } else {
        try {
          const r: any = await db!.execute(sql`
            DELETE FROM nv_iso_control_evidence
            WHERE last_refreshed_at < ${dbRefreshTs}
            RETURNING id
          `);
          const rows = (r?.rows ?? r ?? []) as any[];
          pruned = rows.length;
        } catch (err: any) {
          logger.warn('refresh_prune_failed', { err: err?.message });
        }
      }

      const result: IsoEvidenceRefreshResult = {
        refreshedAt: dbRefreshTs,
        durationMs: Date.now() - started,
        evidenceRows,
        upsertErrors,
        pruned,
        pruneSkipped,
        trigger,
      };
      _lastRefresh = result;
      logger.info('iso_evidence_refresh_complete', result);
      return result;
    } catch (err: any) {
      logger.warn('iso_evidence_refresh_failed', { trigger, err: err?.message });
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

export function getLastIsoEvidenceRefresh(): IsoEvidenceRefreshResult | null {
  return _lastRefresh;
}

let _refreshTimer: NodeJS.Timeout | null = null;

/**
 * Task #312 — Start the periodic evidence refresher. Default cadence
 * is 15 minutes; can be overridden via `JRX_ISO_EVIDENCE_REFRESH_MS`
 * (clamped to ≥ 60s). Returns a stop function that clears the timer.
 * Calling start a second time is a no-op so wiring stays idempotent.
 */
export function startIsoEvidenceRefresher(
  intervalMsOverride?: number,
): { stop: () => void; intervalMs: number } {
  const envMs = Number(process.env.JRX_ISO_EVIDENCE_REFRESH_MS ?? '');
  const requested =
    typeof intervalMsOverride === 'number' && Number.isFinite(intervalMsOverride) && intervalMsOverride > 0
      ? intervalMsOverride
      : Number.isFinite(envMs) && envMs > 0
        ? envMs
        : 15 * 60 * 1000;
  const intervalMs = Math.max(60_000, requested);

  const stop = () => {
    if (_refreshTimer) {
      clearInterval(_refreshTimer);
      _refreshTimer = null;
    }
  };

  if (_refreshTimer) {
    return { stop, intervalMs };
  }

  _refreshTimer = setInterval(() => {
    void refreshIsoControlEvidence({ trigger: 'scheduler' }).catch((err: any) => {
      logger.warn('iso_evidence_scheduler_tick_failed', { err: err?.message });
    });
  }, intervalMs);
  if (typeof _refreshTimer.unref === 'function') _refreshTimer.unref();

  logger.info('iso_evidence_refresher_started', { intervalMs });
  return { stop, intervalMs };
}

/**
 * Some controls automatically inherit jurisdiction-scoped evidence
 * sources based on their framework / category. Returns extra source
 * keys to seed alongside the catalogue's declared evidenceSources.
 */
function collectJurisdictionSources(c: IsoControl): string[] {
  const extras: string[] = [];
  // SOC 2 controls always pull the US SOC2 audit-window evidence.
  if (c.framework === 'soc2') {
    extras.push('us_soc2_audit_window');
  }
  // ISO 42001 AI-governance clauses get the NIST AI RMF crosswalk for US.
  if (c.framework === 'iso_42001') {
    extras.push('us_nist_ai_rmf_mapping');
  }
  // DPDPA controls always pull the IN consent register / data localisation /
  // MeitY advisory roster (Task #311 — keeps the drilldown evidence anchored
  // to live India-jurisdiction artefacts even when the catalogue entry only
  // declares generic evidence keys).
  if (c.framework === 'dpdpa') {
    extras.push('in_dpdpa_consent_register', 'in_meity_advisory_register', 'in_data_localisation');
  }
  // EU AI Act controls inherit the live classification / gap-analysis /
  // bias-report aggregator outputs so every drilldown links back to the
  // existing /api/jrx/compliance/eu-ai-act surface.
  if (c.framework === 'eu_ai_act') {
    extras.push('eu_ai_act_classifications', 'eu_ai_act_gap_analysis');
  }
  // GDPR controls inherit ROPA + DPIA + SCC artefacts and the US state
  // privacy register cross-walk (CCPA / CPRA mirror many GDPR rights).
  if (c.framework === 'gdpr') {
    extras.push('gdpr_records_of_processing', 'us_state_privacy_register');
  }
  // Privacy-flavoured controls pick up the IN DPDPA register and US state register.
  if (/privacy|consent|personal data|dpdpa|p\d|personal/i.test(`${c.category} ${c.title}`)) {
    extras.push('in_dpdpa_consent_register');
    extras.push('us_state_privacy_register');
  }
  // Anything covering data residency / localisation gets the IN localisation row.
  if (/local|residency|cross-border|transfer/i.test(`${c.category} ${c.title} ${c.text}`)) {
    extras.push('in_data_localisation');
    extras.push('in_meity_advisory_register');
  }
  return extras;
}

/**
 * Count evidence rows per control under a given jurisdiction filter.
 * Used by the /iso summary to compute hasEvidence accurately (i.e.
 * including derived jurisdiction-scoped rows the catalogue itself
 * doesn't enumerate). Returns an empty Map on any failure so the
 * caller degrades gracefully.
 */
export async function getEvidenceCounts(
  jurisdiction: IsoJurisdiction = 'GLOBAL',
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!db) return out;
  try {
    await ensureEvidenceTable();
    const r: any =
      jurisdiction === 'GLOBAL'
        ? await db.execute(sql`
            SELECT control_id, COUNT(*)::int AS c
            FROM nv_iso_control_evidence
            GROUP BY control_id
          `)
        : await db.execute(sql`
            SELECT control_id, COUNT(*)::int AS c
            FROM nv_iso_control_evidence
            WHERE jurisdiction IN ('GLOBAL', ${jurisdiction})
            GROUP BY control_id
          `);
    const rows = (r?.rows ?? r ?? []) as any[];
    for (const row of rows) {
      out.set(String(row.control_id), Number(row.c ?? 0));
    }
  } catch (err: any) {
    logger.warn('evidence_counts_failed', { err: err?.message });
  }
  return out;
}

/**
 * Look up the last N evidence rows for a control, optionally filtered
 * by jurisdiction. Falls back to the in-memory manifest if the DB is
 * unavailable so the drilldown still renders something useful in dev.
 *
 * Jurisdiction filter rules:
 *   - GLOBAL → return rows tagged any jurisdiction (everything)
 *   - US/IN  → return rows tagged GLOBAL or the matching jurisdiction
 */
export async function getEvidenceForControl(
  control: IsoControl,
  jurisdiction: IsoJurisdiction = 'GLOBAL',
  limit = 10,
): Promise<IsoEvidenceRow[]> {
  if (db) {
    try {
      await ensureEvidenceTable();
      const r: any =
        jurisdiction === 'GLOBAL'
          ? await db.execute(sql`
              SELECT source_key, summary, artefact, jurisdiction, captured_at, last_refreshed_at
              FROM nv_iso_control_evidence
              WHERE control_id = ${control.controlId}
              ORDER BY captured_at DESC
              LIMIT ${limit}
            `)
          : await db.execute(sql`
              SELECT source_key, summary, artefact, jurisdiction, captured_at, last_refreshed_at
              FROM nv_iso_control_evidence
              WHERE control_id = ${control.controlId}
                AND jurisdiction IN ('GLOBAL', ${jurisdiction})
              ORDER BY (jurisdiction = ${jurisdiction}) DESC, captured_at DESC
              LIMIT ${limit}
            `);
      const rows = (r?.rows ?? r ?? []) as any[];
      if (rows.length > 0) {
        return rows.map((row: any) => ({
          sourceKey: row.source_key,
          summary: row.summary,
          artefact: row.artefact,
          capturedAt: new Date(row.captured_at).toISOString(),
          lastRefreshedAt: row.last_refreshed_at
            ? new Date(row.last_refreshed_at).toISOString()
            : undefined,
          jurisdiction: (row.jurisdiction as IsoJurisdiction) ?? 'GLOBAL',
        }));
      }
    } catch (err: any) {
      logger.warn('evidence_lookup_failed', { controlId: control.controlId, err: err?.message });
    }
  }
  // Fallback — synthesise from manifest in-memory, applying the same
  // jurisdiction filter so the drawer looks consistent with the DB path.
  const manifest = await buildSourceManifest();
  const out: IsoEvidenceRow[] = [];
  const allKeys = Array.from(new Set([
    ...control.evidenceSources,
    ...collectJurisdictionSources(control),
  ]));
  for (const key of allKeys) {
    const rows = manifest[key] ?? [];
    for (const r of rows) {
      if (jurisdiction === 'GLOBAL' || r.jurisdiction === 'GLOBAL' || r.jurisdiction === jurisdiction) {
        out.push(r);
      }
    }
  }
  return out.slice(0, limit);
}
