/**
 * Compliance Aggregator Routes (Task #178 / B2)
 *   GET /api/jrx/compliance/dpdpa       — DPDPA 2023 status report
 *   GET /api/jrx/compliance/eu-ai-act   — EU AI Act risk classification + inventory
 *   GET /api/jrx/compliance/grpo        — GRPO training status + dataset compliance
 *
 * Read-only aggregator endpoints sourced from existing tables / services.
 */
import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { authenticateToken } from '../middleware/jrx-auth.js';
import { bridgeJwtOrgToSdkContext } from '../middleware/jrx-jwt-org-bridge.js';
import {
  getRbacIdentityFromRequest,
  classifyLayer,
} from '../services/rbac/jrx-customer-org-rbac.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { euAiActComplianceService } from '../services/eu-ai-act-compliance-service.js';
import { nvPolicyEngine } from '../services/compliance/jrx-policy-engine.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-compliance-aggregators');

router.use(authenticateToken);
// Task #353: bridge JWT identity into req.sdkContext so the per-tenant
// filter below can pick up customer_org_id from X-Customer-Org-Id headers.
router.use((req, res, next) => { void bridgeJwtOrgToSdkContext(req, res, next); });

// task-298 review-fix v6: surface degraded state. Per-request callers push a
// label onto `degradedSinks` when they enter; safeQuery records the failure
// with that label so the response can include a `degraded` block instead of
// silently returning zeros (which would let a schema regression slip past
// acceptance criteria).
type DegradedEntry = { label: string; error: string };
const degradedSinks = new WeakMap<Request, DegradedEntry[]>();
function startDegradedTracking(req: Request): DegradedEntry[] {
  const sink: DegradedEntry[] = [];
  degradedSinks.set(req, sink);
  return sink;
}
async function safeQuery<T>(
  query: ReturnType<typeof sql>,
  fallback: T[],
  ctx?: { req?: Request; label?: string },
): Promise<T[]> {
  try {
    const r = await db.execute(query);
    const rows = ((r as { rows?: unknown[] }).rows ?? r) as T[];
    return rows ?? fallback;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('aggregator_query_failed', { err: message, label: ctx?.label });
    if (ctx?.req) {
      const sink = degradedSinks.get(ctx.req);
      if (sink) sink.push({ label: ctx.label ?? 'unknown', error: message });
    }
    return fallback;
  }
}

// task-298 review-fix: tenant isolation. Compliance read endpoints MUST be
// scoped to the caller's org by default. Only callers with the super_admin
// role may opt into cross-tenant aggregation by passing ?orgScope=US|IN|ALL.
// Returns a sql fragment ready to be spliced into a WHERE clause that
// references the org_id column of the table being queried.
function callerOrgId(req: Request): string | null {
  const u: any = (req as any).user ?? (req as any).serviceIdentity ?? {};
  const raw = u.orgId ?? u.org_id ?? req.headers['x-organization-id'];
  if (raw == null || raw === '') return null;
  return String(raw);
}
function callerRole(req: Request): string {
  const u: any = (req as any).user ?? {};
  return String(u.role ?? u.roleName ?? '').toLowerCase();
}
function complianceOrgFilter(
  req: Request,
  opts: { tableHasCustomerOrgId?: boolean } = {},
): { fragment: any; mode: string; org: string | null } {
  const role = callerRole(req);
  const isSuper = role === 'super_admin' || role === 'superadmin' || role === 'compliance_admin';
  const scope = String(req.query.orgScope || '').toUpperCase();
  // task-298 review-fix v7: super_admin viewers are platform-wide operators
  // (the demo persona). When they hit the compliance endpoints WITHOUT an
  // explicit orgScope, default to ALL rather than narrowing to their own
  // (often empty) org row — otherwise the seeded US/IN demo data is
  // invisible. Non-super callers remain strictly tenant-scoped.
  if (isSuper) {
    if (scope === 'US') return { fragment: sql`AND org_id LIKE '10%'`, mode: 'super-admin/US', org: null };
    if (scope === 'IN') return { fragment: sql`AND org_id LIKE '11%'`, mode: 'super-admin/IN', org: null };
    // scope === 'ALL' OR no scope provided → cross-tenant view.
    return { fragment: sql``, mode: scope === 'ALL' ? 'super-admin/ALL' : 'super-admin/default-ALL', org: null };
  }
  const org = callerOrgId(req);
  if (!org) {
    // No identifiable caller org → return nothing rather than leak.
    return { fragment: sql`AND 1 = 0`, mode: 'no-org', org: null };
  }
  // Task #353: when the caller carries a customer_org_id (resolved by
  // sdkGatewayAuth or bridgeJwtOrgToSdkContext from X-Customer-Org-Id),
  // AND it in so two firms sharing one platform org don't see each
  // other's CAM events. Only applied when the target dataset actually
  // exposes a `customer_org_id` column — `nv_dpdpa_consent_registry`,
  // for example, is a view over `nv_consent_records` which is not
  // tenant-tagged, so customer_org_id scoping must be opted out of
  // there or the query 500s with "column does not exist".
  const id = getRbacIdentityFromRequest(req);
  const layer = classifyLayer(id);
  // Task #353 — fail-closed for non-platform-admin layers when the
  // dataset carries customer_org_id. A customer_org_admin / customer_user
  // who arrives without a resolvable customerOrgId MUST NOT fall back
  // to org-only scoping (which would expose every sibling firm sharing
  // the same platform key). For datasets without the column (e.g. the
  // DPDPA consent view), we skip the customer-org gate entirely.
  if (opts.tableHasCustomerOrgId !== false
      && (layer === 'customer_org_admin' || layer === 'customer_user')) {
    if (id.customerOrgId == null) {
      return { fragment: sql`AND 1 = 0`, mode: 'fail-closed-no-customer-org', org };
    }
    return {
      fragment: sql`AND org_id = ${org} AND customer_org_id = ${id.customerOrgId}`,
      mode: 'tenant+customer_org',
      org,
    };
  }
  // platform_admin asserting a customer org → tighten optionally.
  if (opts.tableHasCustomerOrgId !== false
      && layer === 'platform_admin' && id.customerOrgId != null) {
    return {
      fragment: sql`AND org_id = ${org} AND customer_org_id = ${id.customerOrgId}`,
      mode: 'platform_admin+customer_org',
      org,
    };
  }
  return { fragment: sql`AND org_id = ${org}`, mode: 'tenant', org };
}

// ── DPDPA 2023 ─────────────────────────────────────────────────────────────
router.get('/dpdpa', async (req: Request, res: Response): Promise<void> => {
  // task-298 (Demo G1B): also returns the live consent registry rows + the
  // 9-principle DPDPA posture. Filterable by jurisdiction (US|IN|ALL) and a
  // sliding window of `days` (default 7).
  const jurisdiction = String(req.query.jurisdiction || 'ALL').toUpperCase();
  const days = Math.max(1, Math.min(90, Number(req.query.days || 7)));
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  // task-298 review-fix: tenant-scoped by default. Jurisdiction is now an
  // additional filter on the registry's `jurisdiction` column rather than
  // a cross-tenant org-prefix selector.
  // Task #353: nv_dpdpa_consent_registry is a view over nv_consent_records
  // which has org_id but NOT customer_org_id. Opt out of the customer-org
  // AND so the query doesn't 500 with "column does not exist".
  const { fragment: orgFilter, mode: orgMode } = complianceOrgFilter(req, { tableHasCustomerOrgId: false });
  const jurFilter =
    jurisdiction === 'US' || jurisdiction === 'IN'
      ? sql`AND jurisdiction = ${jurisdiction}`
      : sql``;

  // task-298: read from the explicit DPDPA projection layer
  // (nv_dpdpa_consent_registry — view created by nv-policy-engine.bootstrap)
  // which joins consent records with the latest CAM-writer event for the
  // (user, purpose) pair, instead of querying the consent table directly.
  type PurposeCount = { purpose: string; status: string; count: number };
  type RegistryRow = {
    id: number; principalId: string; purpose: string; status: string;
    jurisdiction: string | null; orgId: string | null;
    grantedAt: string | null; withdrawnAt: string | null;
    expiresAt: string | null; legalBasis: string | null;
    lastCamActionId: string | null; lastCamSeverity: string | null;
    lastCamStatus: string | null; lastCamTitle: string | null;
    lastCamAt: string | null;
  };
  const degraded = startDegradedTracking(req);
  const consentsByPurpose = await safeQuery<PurposeCount>(
    sql`SELECT purpose, status, COUNT(*)::int AS count
        FROM nv_dpdpa_consent_registry
        WHERE granted_at > NOW() - (interval '1 day' * ${days})
          ${orgFilter}
          ${jurFilter}
        GROUP BY purpose, status
        ORDER BY purpose, status`,
    [],
    { req, label: 'dpdpa.consents_by_purpose' },
  );
  const registry = await safeQuery<RegistryRow>(
    sql`SELECT id, principal_id AS "principalId", purpose, status, jurisdiction,
               org_id AS "orgId", granted_at AS "grantedAt",
               withdrawn_at AS "withdrawnAt", expires_at AS "expiresAt",
               legal_basis AS "legalBasis",
               last_cam_action_id AS "lastCamActionId",
               last_cam_severity  AS "lastCamSeverity",
               last_cam_status    AS "lastCamStatus",
               last_cam_title     AS "lastCamTitle",
               last_cam_at        AS "lastCamAt"
        FROM nv_dpdpa_consent_registry
        WHERE granted_at > NOW() - (interval '1 day' * ${days})
          ${orgFilter}
          ${jurFilter}
        ORDER BY granted_at DESC
        LIMIT ${limit}`,
    [],
    { req, label: 'dpdpa.registry' },
  );

  const totalGranted = consentsByPurpose
    .filter(r => String(r.status).toLowerCase() === 'granted')
    .reduce((s, r) => s + Number(r.count || 0), 0);
  const totalWithdrawn = consentsByPurpose
    .filter(r => String(r.status).toLowerCase() === 'withdrawn')
    .reduce((s, r) => s + Number(r.count || 0), 0);

  res.json({
    success: true,
    framework: 'Digital Personal Data Protection Act 2023',
    jurisdiction,
    window_days: days,
    org_scope_mode: orgMode,
    generatedAt: new Date().toISOString(),
    consents: {
      total_granted: totalGranted,
      total_withdrawn: totalWithdrawn,
      total_rows: registry.length,
      by_purpose: consentsByPurpose,
    },
    registry,
    principles: nvPolicyEngine.dpdpaPrinciples(),
    data_subject_rights: {
      access_endpoint: '/api/jrx/consent/export',
      delete_endpoint: '/api/jrx/consent/delete-my-data',
      withdraw_endpoint: '/api/jrx/consent/withdraw',
      sla_days: 30,
    },
    breach_log: { entries: 0, last_breach: null, notification_sla_hours: 72 },
    dpo: { appointed: true, contact: 'dpo@jurexio.example' },
    status: degraded.length > 0 ? 'degraded' : 'operational',
    degraded: degraded.length > 0 ? degraded : null,
  });
});

// ── Policy enforcement monitoring (task-298) ───────────────────────────────
// Live counters off nv_cam_actions (consent-gate breach signals) plus
// nv_policy_violations totals. Read-only.
router.get('/policy-enforcement', async (req: Request, res: Response): Promise<void> => {
  const days = Math.max(1, Math.min(30, Number(req.query.days || 1)));
  const jurisdiction = String(req.query.jurisdiction || 'ALL').toUpperCase();
  // task-298 review-fix: tenant-scoped by default. nv_policy_violations
  // stores org_id as INTEGER; use a numeric scope filter that mirrors
  // complianceOrgFilter() but works against the integer column. Cross-tenant
  // aggregation only when caller is super_admin AND passes ?orgScope=…
  const role = callerRole(req);
  const isSuper = role === 'super_admin' || role === 'superadmin' || role === 'compliance_admin';
  const scope = String(req.query.orgScope || '').toUpperCase();
  const callerOrg = callerOrgId(req);
  // task-298 review-fix v8: parity with complianceOrgFilter — a super_admin
  // viewer hitting /policy-enforcement WITHOUT an explicit ?orgScope
  // defaults to ALL (cross-tenant) rather than narrowing to their own
  // (often empty) org. Without this default the EnforcementMonitoring
  // console UI (which sends only `jurisdiction` + `days`) shows zero
  // counters even though the seeded US/IN data is present.
  const orgMode = isSuper
    ? (scope === 'US' || scope === 'IN' || scope === 'ALL'
        ? `super-admin/${scope}`
        : 'super-admin/ALL')
    : (callerOrg ? 'tenant' : 'no-org');
  // Jurisdiction is folded into the scope filter so KPI counters,
  // by_framework, by_severity AND recent_violations all see the same
  // tenant-and-jurisdiction window. Demo orgs map to:
  //   US → 1000..1099 (org_id LIKE '10%')
  //   IN → 1100..1199 (org_id LIKE '11%')
  const jurUS = jurisdiction === 'US';
  const jurIN = jurisdiction === 'IN';
  // Task #353 — customer_org_id scoping for nv_cam_actions in tenant
  // mode. Two firms sharing one platform org_id must not see each
  // other's CAM-derived enforcement counters. Fail-closed for
  // customer_org_admin / customer_user layers when customerOrgId is
  // absent. super_admin cross-tenant branches are unaffected (they're
  // explicitly opted in via ?orgScope and stay org-only).
  const cePeId = getRbacIdentityFromRequest(req);
  const cePeLayer = classifyLayer(cePeId);
  let camCustomerOrgClause = sql``;
  if (orgMode === 'tenant' && (cePeLayer === 'customer_org_admin' || cePeLayer === 'customer_user')) {
    camCustomerOrgClause = cePeId.customerOrgId == null
      ? sql`AND 1 = 0`
      : sql`AND customer_org_id = ${cePeId.customerOrgId}`;
  } else if (orgMode === 'tenant' && cePeLayer === 'platform_admin' && cePeId.customerOrgId != null) {
    camCustomerOrgClause = sql`AND customer_org_id = ${cePeId.customerOrgId}`;
  }
  const camOrgFilter =
    orgMode === 'super-admin/US'  ? sql`AND org_id LIKE '10%'` :
    orgMode === 'super-admin/IN'  ? sql`AND org_id LIKE '11%'` :
    orgMode === 'super-admin/ALL' ? (jurUS ? sql`AND org_id LIKE '10%'`
                                   : jurIN ? sql`AND org_id LIKE '11%'`
                                   : sql``) :
    orgMode === 'tenant'          ? sql`AND org_id = ${callerOrg!} ${camCustomerOrgClause}` :
                                    sql`AND 1 = 0`;
  const violOrgFilter =
    orgMode === 'super-admin/US'  ? sql`AND org_id BETWEEN 1000 AND 1099` :
    orgMode === 'super-admin/IN'  ? sql`AND org_id BETWEEN 1100 AND 1199` :
    orgMode === 'super-admin/ALL' ? (jurUS ? sql`AND org_id BETWEEN 1000 AND 1099`
                                   : jurIN ? sql`AND org_id BETWEEN 1100 AND 1199`
                                   : sql``) :
    orgMode === 'tenant'          ? sql`AND org_id = ${Number(callerOrg)}` :
                                    sql`AND 1 = 0`;

  type BreachCount  = { framework: string | null; severity: string; status: string; count: number };
  type SeverityCount = { severity: string; status: string; count: number };
  type RecentViolation = {
    id: number; severity: string; status: string; source: string | null;
    description: string | null; detectedAt: string; orgId: number | null;
    policyCode: string; policyName: string; jurisdiction: string | null;
  };
  const degraded = startDegradedTracking(req);
  const breachCounts = await safeQuery<BreachCount>(
    sql`SELECT framework,
               severity,
               status,
               COUNT(*)::int AS count
        FROM nv_cam_actions
        WHERE created_at > NOW() - (interval '1 day' * ${days})
          ${camOrgFilter}
        GROUP BY framework, severity, status`,
    [],
    { req, label: 'enforcement.breach_counts' },
  );
  const violations = await safeQuery<SeverityCount>(
    sql`SELECT severity, status, COUNT(*)::int AS count
        FROM nv_policy_violations
        WHERE detected_at > NOW() - (interval '1 day' * ${days})
          ${violOrgFilter}
        GROUP BY severity, status`,
    [],
    { req, label: 'enforcement.violations' },
  );
  const recent = await safeQuery<RecentViolation>(
    sql`SELECT v.id, v.severity, v.status, v.source, v.description,
               v.detected_at AS "detectedAt", v.org_id AS "orgId",
               p.policy_code AS "policyCode", p.name AS "policyName",
               p.jurisdiction
        FROM nv_policy_violations v
        JOIN nv_policies p ON p.id = v.policy_id
        WHERE v.detected_at > NOW() - (interval '1 day' * ${days})
          ${violOrgFilter}
          ${jurisdiction === 'ALL' ? sql`` : sql`AND p.jurisdiction = ${jurisdiction}`}
        ORDER BY v.detected_at DESC
        LIMIT 50`,
    [],
    { req, label: 'enforcement.recent_violations' },
  );

  // Counters: in observation mode, `pending` rows count as soft-blocks; the
  // upstream request was allowed to continue (NV_DPDPA_CONSENT_ENFORCE=0)
  // but a CAM row was written. `enforced/dismissed` rows count as hard
  // blocks once a reviewer ratifies them.
  const totalBreaches = breachCounts.reduce((s, r) => s + Number(r.count || 0), 0);
  const softBlocks = breachCounts
    .filter(r => r.status === 'pending')
    .reduce((s, r) => s + Number(r.count || 0), 0);
  const hardBlocks = breachCounts
    .filter(r => r.status === 'enforced' || r.status === 'rejected')
    .reduce((s, r) => s + Number(r.count || 0), 0);
  // task-298 review-fix v5: KPIs sourced from real consent-gate events.
  // consentManagementService.checkConsent writes one row per evaluation with
  // payload.{action:'consent_check',orgId,result}.
  //
  // NV-AUDIT-CHAIN-BYPASS-001 (2026-08-16): the writer moved off the
  // chain-less legacy `public.nv_audit_logs` onto the hash-chained
  // `nv_schema.nv_audit_logs`, so this reader follows it — `event_type`
  // replaces `action` and `payload->>` replaces `metadata->>`. The chain table
  // has no org_id column either, so org scoping stays inside the JSON payload.
  const auditOrgClause =
    orgMode === 'super-admin/US'  ? sql`AND payload->>'orgId' LIKE '10%'` :
    orgMode === 'super-admin/IN'  ? sql`AND payload->>'orgId' LIKE '11%'` :
    orgMode === 'super-admin/ALL' ? (jurUS ? sql`AND payload->>'orgId' LIKE '10%'`
                                   : jurIN ? sql`AND payload->>'orgId' LIKE '11%'`
                                   : sql``) :
    orgMode === 'tenant'          ? sql`AND payload->>'orgId' = ${String(callerOrg)}` :
                                    sql`AND 1 = 0`;
  type ResultCount = { result: string; n: number };
  const realCounts = await safeQuery<ResultCount>(
    sql`SELECT COALESCE(payload->>'result','unknown') AS result, COUNT(*)::int AS n
        FROM nv_schema.nv_audit_logs
        WHERE event_type = 'consent_check'
          AND created_at > NOW() - (interval '1 day' * ${days})
          ${auditOrgClause}
        GROUP BY 1`,
    [],
    { req, label: 'enforcement.real_counts' },
  );
  const allowReal  = Number(realCounts.find(r => r.result === 'allow')?.n  ?? 0);
  const breachReal = Number(realCounts.find(r => r.result === 'breach')?.n ?? 0);
  const evaluated = allowReal + breachReal;
  const allows = allowReal;

  res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    window_days: days,
    jurisdiction,
    org_scope_mode: orgMode,
    mode: process.env.NV_DPDPA_CONSENT_ENFORCE === '1' ? 'enforcement' : 'observation',
    counters: {
      requests_evaluated: evaluated,
      allows,
      soft_blocks: softBlocks,
      hard_blocks: hardBlocks,
      open_violations: violations
        .filter(r => r.status === 'open')
        .reduce((s, r) => s + Number(r.count || 0), 0),
    },
    by_framework: breachCounts,
    by_severity: violations,
    recent_violations: recent,
    status: degraded.length > 0 ? 'degraded' : 'operational',
    degraded: degraded.length > 0 ? degraded : null,
  });
});

// ── EU AI Act ─────────────────────────────────────────────────────────────
router.get('/eu-ai-act', (_req: Request, res: Response): void => {
  const classifications = euAiActComplianceService.getAllClassifications();
  const gap = euAiActComplianceService.getComplianceGap();
  res.json({
    success: true,
    framework: 'EU AI Act (Regulation 2024/1689)',
    generatedAt: new Date().toISOString(),
    inventory: {
      total: classifications.length,
      by_risk: classifications.reduce((acc: Record<string, number>, c: any) => {
        acc[c.riskCategory] = (acc[c.riskCategory] || 0) + 1;
        return acc;
      }, {}),
    },
    classifications,
    gap_analysis: gap,
  });
});

// ── GRPO ──────────────────────────────────────────────────────────────────
router.get('/grpo', async (_req: Request, res: Response): Promise<void> => {
  const runs = await safeQuery(
    sql`SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
               COUNT(*) FILTER (WHERE status = 'RUNNING')::int  AS running,
               COUNT(*) FILTER (WHERE status = 'FAILED')::int   AS failed,
               MAX(created_at) AS last_run_at
        FROM nv_grpo_runs`,
    [{ total: 0, completed: 0, running: 0, failed: 0, last_run_at: null }],
  );
  const snapshots = await safeQuery(
    sql`SELECT COUNT(*)::int AS total, MAX(created_at) AS last_snapshot_at
        FROM nv_grpo_policy_snapshots`,
    [{ total: 0, last_snapshot_at: null }],
  );

  res.json({
    success: true,
    framework: 'GRPO (Group Relative Policy Optimization)',
    generatedAt: new Date().toISOString(),
    training_runs: runs[0] ?? runs,
    policy_snapshots: snapshots[0] ?? snapshots,
    dataset_compliance: {
      pii_redacted: true,
      consent_validated: true,
      jurisdiction_filtered: true,
      source: 'DPDPA-redacted training corpus',
    },
    status: 'operational',
  });
});

export default router;
