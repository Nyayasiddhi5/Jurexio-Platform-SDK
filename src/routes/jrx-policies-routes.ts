/**
 * Jurexio Enterprise Platform — Policies API
 * CRUD + assignments + violations.
 * Auth: dualSdkOrJwt (NV-AUTH-HEADER-001 compliant).
 *
 * Mounted at /api/jrx/policies in src/index.ts.
 */

import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { requireRole } from '../middleware/jrx-auth.js';
import { bridgeJwtOrgToSdkContext } from '../middleware/jrx-jwt-org-bridge.js';
import {
  getRbacIdentityFromRequest,
  classifyLayer,
} from '../services/rbac/jrx-customer-org-rbac.js';
import { db as rawDb } from '../db/index.js';
import { requireDb } from '../utils/jrx-type-helpers.js';

const db = requireDb(rawDb);
import { sql as drsql } from 'drizzle-orm';

const router = Router();
router.use(dualSdkOrJwt);
// Task #353: bridge JWT identity → req.sdkContext so per-tenant scoping
// of cam_actions in the drilldown view picks up customer_org_id.
router.use((req, res, next) => { void bridgeJwtOrgToSdkContext(req, res, next); });

const orgFromReq = (req: Request): number => {
  const raw = (req as any).user?.orgId
           ?? (req as any).serviceIdentity?.orgId
           ?? req.headers['x-organization-id']
           ?? '1';
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
};

// task-298 review-fix v4: super-admin override so a platform operator can
// see cross-tenant violations on a baseline policy when needed (?orgScope=ALL).
// Without it, drilldown is strictly scoped to caller org.
type ReqWithIdentity = Request & {
  user?: { role?: string; orgId?: number | string; email?: string };
  serviceIdentity?: { role?: string; orgId?: number | string };
};
const callerRole = (req: Request): string => {
  const r = req as ReqWithIdentity;
  return String(r.user?.role ?? r.serviceIdentity?.role ?? '').toLowerCase();
};
const isSuperAdmin = (req: Request): boolean => {
  const r = callerRole(req);
  return r === 'super_admin' || r === 'superadmin' || r === 'compliance_admin';
};
// task-298 review-fix v8: align scoping defaults with the demo persona.
// A super_admin viewer is platform-wide by definition — when they hit the
// list/drilldown WITHOUT an explicit ?orgScope=tenant, default to cross-
// tenant (no org filter) so seeded US (1000-1099) + IN (1100-1199) rows
// surface against the baseline (org_id=1) policies. Non-super callers
// remain strictly tenant-scoped.
const wantsCrossTenant = (req: Request): boolean => {
  if (!isSuperAdmin(req)) return false;
  const scope = String(req.query.orgScope || '').toUpperCase();
  // Explicit tenant scope (`?orgScope=tenant`/`SELF`) opts the super_admin
  // back into single-tenant mode. Anything else (ALL, US, IN, missing) →
  // cross-tenant for list/drilldown; the per-jurisdiction filtering is
  // handled separately by the `jurisdiction` query param.
  return scope !== 'TENANT' && scope !== 'SELF';
};
const listAggOrgClause = (req: Request, orgId: number) =>
  wantsCrossTenant(req) ? drsql`` : drsql`AND org_id = ${orgId}`;

// ── List policies ────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const category = (req.query.category as string) || null;
    const status   = (req.query.status as string) || null;
    // task-298: jurisdiction filter (US|IN|EU|UK|ALL). When omitted the
    // route returns every policy for the org including 'ALL'-tagged ones.
    const jurisdiction = (req.query.jurisdiction as string) || null;
    // task-298 review-fix: date-range filter wired end-to-end.
    //   ?windowDays=N            — counter window for violations_today (1..90, default 1)
    //   ?effectiveSince=ISO-date — only policies with effective_at >= since
    //   ?effectiveUntil=ISO-date — only policies with effective_at <= until
    const windowDays = Math.max(1, Math.min(90, Number(req.query.windowDays || 1)));
    const effectiveSince = (req.query.effectiveSince as string) || null;
    const effectiveUntil = (req.query.effectiveUntil as string) || null;

    const r = await db.execute(drsql`
      SELECT p.id, p.policy_code, p.name, p.category, p.jurisdiction, p.severity,
             p.status, p.owner_team, p.description, p.rules, p.current_version,
             p.effective_at, p.review_at, p.framework_refs, p.last_enforced_at,
             COALESCE(a.assignment_count, 0)::int AS assignment_count,
             COALESCE(v.open_violations, 0)::int AS open_violations,
             COALESCE(t.violations_today, 0)::int AS violations_today
      FROM nv_policies p
      LEFT JOIN (SELECT policy_id, COUNT(*) AS assignment_count
                 FROM nv_policy_assignments GROUP BY policy_id) a ON a.policy_id = p.id
      -- task-298 review-fix v5: tenant-scope the violation aggregates so
      -- baseline policies (org_id=1) don't leak other tenants' breach
      -- counts via the list view. Super_admin/?orgScope=ALL keeps the
      -- platform-wide totals.
      LEFT JOIN (SELECT policy_id, COUNT(*) AS open_violations
                 FROM nv_policy_violations
                 WHERE status = 'open'
                   ${listAggOrgClause(req, orgId)}
                 GROUP BY policy_id) v ON v.policy_id = p.id
      LEFT JOIN (SELECT policy_id, COUNT(*) AS violations_today
                 FROM nv_policy_violations
                 WHERE detected_at > NOW() - (interval '1 day' * ${windowDays})
                   ${listAggOrgClause(req, orgId)}
                 GROUP BY policy_id) t ON t.policy_id = p.id
      -- task-298: tenant policy view = own org rows ∪ platform-baseline (org_id=1).
      WHERE (p.org_id = ${orgId} OR p.org_id = 1)
        ${category ? drsql`AND p.category = ${category}` : drsql``}
        ${status   ? drsql`AND p.status   = ${status}`   : drsql``}
        ${jurisdiction ? drsql`AND (p.jurisdiction = ${jurisdiction} OR p.jurisdiction = 'ALL')` : drsql``}
        ${effectiveSince ? drsql`AND p.effective_at >= ${effectiveSince}::timestamptz` : drsql``}
        ${effectiveUntil ? drsql`AND p.effective_at <= ${effectiveUntil}::timestamptz` : drsql``}
      ORDER BY p.severity DESC, p.policy_code
    `);
    res.json({
      success: true,
      policies: r.rows ?? r,
      window_days: windowDays,
      effective_since: effectiveSince,
      effective_until: effectiveUntil,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Get one policy with versions, assignments, recent violations ─────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const id = Number(req.params.id);
    // task-298: tenant view also reads platform-baseline (org_id=1) rows.
    type PolicyRow = {
      id: number; policy_code: string; name: string; org_id: number;
      jurisdiction: string | null; category: string | null;
      [k: string]: unknown;
    };
    const polR = await db.execute(drsql`
      SELECT * FROM nv_policies WHERE id = ${id} AND (org_id = ${orgId} OR org_id = 1)
    `);
    const policyRows = (polR.rows ?? polR) as unknown as PolicyRow[];
    const policy = policyRows[0];
    if (!policy) return res.status(404).json({ success: false, error: 'policy not found' });

    const versionsR = await db.execute(drsql`
      SELECT version, body_md, changelog, published_by, published_at
      FROM nv_policy_versions WHERE policy_id = ${id} ORDER BY published_at DESC
    `);
    const assignmentsR = await db.execute(drsql`
      SELECT scope_type, scope_value, assigned_by, assigned_at, ack_required, ack_count
      FROM nv_policy_assignments WHERE policy_id = ${id} ORDER BY assigned_at DESC
    `);
    // task-298 review-fix v4: tenant-scope drilldown child datasets.
    // Baseline policies (org_id=1) are visible to every demo tenant, but
    // their violations + CAM events MUST stay org-isolated — otherwise a
    // tenant viewing a baseline DPDPA policy would see other tenants'
    // violation rows. Super_admin/compliance_admin can opt into cross-
    // tenant view via ?orgScope=ALL on a baseline policy.
    // task-298 review-fix v8: align with list-view default — a super_admin
    // viewer drilling into a baseline (org_id=1) policy sees cross-tenant
    // violations + CAM events by default, since those are the rows seeded
    // for the demo (orgs 1000-1099 US, 1100-1199 IN). Tenant callers stay
    // strictly scoped; super_admin can re-enable single-tenant view via
    // ?orgScope=tenant.
    const crossTenant = wantsCrossTenant(req) && Number(policy.org_id) === 1;
    const violOrgClause = crossTenant ? drsql`` : drsql`AND org_id = ${orgId}`;
    // Task #353: when caller has a customer_org_id, AND it onto the cam
    // events JOIN so two firms sharing one platform org_id can't see each
    // other's CAM rows on a baseline policy drilldown.
    // Task #353 — fail-closed for customer_org_admin / customer_user
    // when customerOrgId is missing. Otherwise sibling firms sharing
    // one platform key would see each other's CAM events on a baseline
    // policy drilldown. super_admin / cross-tenant view bypasses.
    const rbacIdentity = getRbacIdentityFromRequest(req);
    const policyLayer = classifyLayer(rbacIdentity);
    let customerOrgClause = drsql``;
    if (!crossTenant && (policyLayer === 'customer_org_admin' || policyLayer === 'customer_user')) {
      customerOrgClause = rbacIdentity.customerOrgId == null
        ? drsql`AND 1 = 0`
        : drsql`AND customer_org_id = ${rbacIdentity.customerOrgId}`;
    } else if (!crossTenant && policyLayer === 'platform_admin' && rbacIdentity.customerOrgId != null) {
      customerOrgClause = drsql`AND customer_org_id = ${rbacIdentity.customerOrgId}`;
    }
    const camOrgClause  = crossTenant
      ? drsql``
      : drsql`AND org_id = ${String(orgId)} ${customerOrgClause}`;

    type ViolationRow = {
      id: number; severity: string; source: string | null; request_id: string | null;
      user_ref: string | null; description: string | null;
      detected_at: string; status: string; resolution_notes: string | null;
      org_id: number | null;
    };
    const violationsR = await db.execute(drsql`
      SELECT id, severity, source, request_id, user_ref, description, detected_at,
             status, resolution_notes, org_id
      FROM nv_policy_violations WHERE policy_id = ${id} ${violOrgClause}
      ORDER BY detected_at DESC LIMIT 50
    `);
    const violations = (violationsR.rows ?? violationsR) as unknown as ViolationRow[];

    // task-298: drilldown also returns CAM events that fired against this
    // policy's framework. Mapping is deterministic from policy_code prefix:
    //   POL-IN-DPDPA-* → framework='dpdpa', controlId starts with the policy code
    //   POL-US-CCPA-*  → framework='ccpa'
    //   POL-US-HIPAA-* → framework='hipaa'
    //   POL-US-FRCP-*  → framework='frcp'
    //   POL-US-SOC2-*  → framework='soc2'
    //   POL-IN-IT-43A  → framework='it_act'
    //   POL-IN-BCI-*   → framework='bci'
    // Plus a fallback match by control_id LIKE policy_code so future
    // CAM writers that tag with the policy code are also picked up.
    const code = String(policy.policy_code ?? '');
    const fw =
      code.startsWith('POL-IN-DPDPA')   ? 'dpdpa'   :
      code.startsWith('POL-US-CCPA')    ? 'ccpa'    :
      code.startsWith('POL-US-HIPAA')   ? 'hipaa'   :
      code.startsWith('POL-US-FRCP')    ? 'frcp'    :
      code.startsWith('POL-US-SOC2')    ? 'soc2'    :
      code.startsWith('POL-IN-IT')      ? 'it_act'  :
      code.startsWith('POL-IN-BCI')     ? 'bci'     :
      code.startsWith('POL-US-ABA')     ? 'aba'     :
      // task-345: VCDPA + CPA + FedRAMP frameworks introduced for the
      // US state-privacy + federal-compliance Console surface.
      code.startsWith('POL-US-VCDPA')   ? 'vcdpa'   :
      code.startsWith('POL-US-CPA')     ? 'cpa'     :
      code.startsWith('POL-US-FEDRAMP') ? 'fedramp' :
      // task-351: state breach-notification regimes (NY SHIELD, IL BIPA,
      // MA 201 CMR 17) added to the US Console policy surface.
      code.startsWith('POL-US-NYSHIELD')   ? 'nyshield' :
      code.startsWith('POL-US-BIPA')       ? 'bipa'     :
      code.startsWith('POL-US-MA201CMR17') ? 'ma201'    :
      null;
    // task-298 review-fix: tighten matching to policy-specific signals only.
    // Drop the broad `framework = fw` fallback (which would pull every CAM
    // event for the entire framework). Match strictly by policy_code in
    // either the control_id or the title/description, plus an exact match
    // on metadata->>'policyCode' for events written by the policy engine.
    const codeWild = code + '%';
    const codeIn   = '%' + code + '%';
    type CamRow = {
      id: number; action_id: string; framework: string | null;
      control_id: string | null; severity: string; status: string;
      title: string; description: string | null;
      triggered_by: string | null; evidence_ref: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string; reviewed_at: string | null; reviewed_by: string | null;
      org_id: string | null;
    };
    let camRows: CamRow[] = [];
    let camDegraded = false;
    let camError: string | null = null;
    try {
      const camR = await db.execute(drsql`
        SELECT id, action_id, framework, control_id, severity, status, title,
               description, triggered_by, evidence_ref, metadata,
               created_at, reviewed_at, reviewed_by, org_id
        FROM nv_cam_actions
        WHERE (control_id LIKE ${codeWild}
            OR title       ILIKE ${codeIn}
            OR description ILIKE ${codeIn}
            OR metadata->>'policyCode' = ${code}
            OR metadata->'policyCodes' ? ${code})
           ${camOrgClause}
        ORDER BY created_at DESC
        LIMIT 50
      `);
      camRows = (camR.rows ?? camR) as unknown as CamRow[];
    } catch (err) {
      camDegraded = true;
      camError = err instanceof Error ? err.message : String(err);
    }

    return res.json({
      success: true,
      policy,
      versions:    versionsR.rows ?? versionsR,
      assignments: assignmentsR.rows ?? assignmentsR,
      violations,
      cam_events: camRows,
      cam_framework: fw,
      degraded: camDegraded ? { cam_events: camError } : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

// ── Create / Update / Delete ─────────────────────────────────────────────────
router.post('/', requireRole('org_admin', 'compliance_officer'), async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const { policy_code, name, category, jurisdiction, severity, status, owner_team,
            description, rules, framework_refs } = req.body ?? {};
    if (!policy_code || !name) return res.status(400).json({ success: false, error: 'policy_code and name are required' });
    const r = await db.execute(drsql`
      INSERT INTO nv_policies
        (org_id, policy_code, name, category, jurisdiction, severity, status, owner_team,
         description, rules, framework_refs)
      VALUES
        (${orgId}, ${policy_code}, ${name}, ${category ?? null}, ${jurisdiction ?? 'ALL'},
         ${severity ?? 'medium'}, ${status ?? 'active'}, ${owner_team ?? null},
         ${description ?? null}, ${JSON.stringify(rules ?? [])}::jsonb,
         ${JSON.stringify(framework_refs ?? [])}::jsonb)
      ON CONFLICT (org_id, policy_code) DO UPDATE SET
        name = EXCLUDED.name, category = EXCLUDED.category, severity = EXCLUDED.severity,
        status = EXCLUDED.status, owner_team = EXCLUDED.owner_team,
        description = EXCLUDED.description, rules = EXCLUDED.rules,
        framework_refs = EXCLUDED.framework_refs, updated_at = NOW()
      RETURNING *
    `);
    return res.json({ success: true, policy: (r.rows ?? r)[0] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', requireRole('org_admin', 'compliance_officer'), async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const id = Number(req.params.id);
    const { name, category, severity, status, owner_team, description, rules, framework_refs } = req.body ?? {};
    const r = await db.execute(drsql`
      UPDATE nv_policies SET
        name = COALESCE(${name}, name),
        category = COALESCE(${category}, category),
        severity = COALESCE(${severity}, severity),
        status   = COALESCE(${status}, status),
        owner_team = COALESCE(${owner_team}, owner_team),
        description = COALESCE(${description}, description),
        rules = COALESCE(${rules ? JSON.stringify(rules) : null}::jsonb, rules),
        framework_refs = COALESCE(${framework_refs ? JSON.stringify(framework_refs) : null}::jsonb, framework_refs),
        updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
      RETURNING *
    `);
    const row = (r.rows ?? r)[0];
    if (!row) return res.status(404).json({ success: false, error: 'policy not found' });
    return res.json({ success: true, policy: row });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', requireRole('org_admin', 'compliance_officer'), async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const id = Number(req.params.id);
    await db.execute(drsql`DELETE FROM nv_policy_violations  WHERE policy_id = ${id}`);
    await db.execute(drsql`DELETE FROM nv_policy_assignments WHERE policy_id = ${id}`);
    await db.execute(drsql`DELETE FROM nv_policy_versions    WHERE policy_id = ${id}`);
    await db.execute(drsql`DELETE FROM nv_policies WHERE id = ${id} AND org_id = ${orgId}`);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Assignments ──────────────────────────────────────────────────────────────
router.post('/:id/assign', requireRole('org_admin', 'compliance_officer'), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { scope_type, scope_value, ack_required } = req.body ?? {};
    if (!scope_type || !scope_value) return res.status(400).json({ success: false, error: 'scope_type and scope_value required' });
    const assignedBy = (req as any).user?.email ?? 'compliance@nyayavigya';
    const r = await db.execute(drsql`
      INSERT INTO nv_policy_assignments (policy_id, scope_type, scope_value, assigned_by, ack_required)
      VALUES (${id}, ${scope_type}, ${scope_value}, ${assignedBy}, ${!!ack_required})
      ON CONFLICT (policy_id, scope_type, scope_value) DO UPDATE SET
        ack_required = EXCLUDED.ack_required, assigned_by = EXCLUDED.assigned_by, assigned_at = NOW()
      RETURNING *
    `);
    return res.json({ success: true, assignment: (r.rows ?? r)[0] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Violations ───────────────────────────────────────────────────────────────
router.get('/:id/violations', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const r = await db.execute(drsql`
      SELECT id, severity, source, request_id, user_ref, description, detected_at, status, resolution_notes
      FROM nv_policy_violations WHERE policy_id = ${id} ORDER BY detected_at DESC LIMIT 200
    `);
    res.json({ success: true, violations: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/violations', requireRole('analyst', 'org_admin', 'compliance_officer'), async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const id = Number(req.params.id);
    const { severity, source, request_id, user_ref, description, metadata } = req.body ?? {};
    const r = await db.execute(drsql`
      INSERT INTO nv_policy_violations
        (policy_id, org_id, severity, source, request_id, user_ref, description, metadata)
      VALUES
        (${id}, ${orgId}, ${severity ?? 'medium'}, ${source ?? null}, ${request_id ?? null},
         ${user_ref ?? null}, ${description ?? null},
         ${JSON.stringify(metadata ?? {})}::jsonb)
      RETURNING *
    `);
    res.json({ success: true, violation: (r.rows ?? r)[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Summary (fast aggregate for dashboard) ───────────────────────────────────
router.get('/_summary', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const r = await db.execute(drsql`
      SELECT
        COUNT(*)::int                                                AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int               AS active,
        COUNT(*) FILTER (WHERE status = 'draft')::int                AS draft,
        COUNT(*) FILTER (WHERE severity = 'critical')::int           AS critical,
        COUNT(*) FILTER (WHERE severity = 'high')::int               AS high,
        (SELECT COUNT(*)::int FROM nv_policy_violations WHERE status = 'open') AS open_violations
      FROM nv_policies WHERE org_id = ${orgId}
    `);
    res.json({ success: true, summary: (r.rows ?? r)[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
