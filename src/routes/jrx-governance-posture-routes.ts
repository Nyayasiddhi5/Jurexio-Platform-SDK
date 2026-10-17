/**
 * Jurexio Enterprise Platform — Governance Posture API (read-only aggregator)
 *
 * Powers the Console Dashboard tiles + the Governance & Compliance pages.
 * Aggregates compliance frameworks, controls, evidence, internal-security
 * controls, key rotations, certificates, and data-governance records.
 *
 * Auth: dualSdkOrJwt.
 * Mount: /api/jrx/governance
 */

import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { requireRole } from '../middleware/jrx-auth.js';
import { db as rawDb } from '../db/index.js';
import { requireDb } from '../utils/jrx-type-helpers.js';

const db = requireDb(rawDb);
import { sql as drsql } from 'drizzle-orm';

const router = Router();
router.use(dualSdkOrJwt);

const orgFromReq = (req: Request): number => {
  const raw = (req as any).user?.orgId
           ?? (req as any).serviceIdentity?.orgId
           ?? req.headers['x-organization-id']
           ?? '1';
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
};

// ── Headline posture (one call powers the dashboard hero) ────────────────────
router.get('/posture', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);

    const fw = await db.execute(drsql`
      SELECT COUNT(*)::int                              AS total_frameworks,
             COUNT(*) FILTER (WHERE active)::int        AS active_frameworks,
             COUNT(DISTINCT jurisdiction)::int          AS jurisdictions,
             SUM(total_controls)::int                   AS total_controls
      FROM nv_compliance_frameworks
    `);
    const ev = await db.execute(drsql`
      SELECT
        COUNT(*)::int                                              AS evidenced_controls,
        COUNT(*) FILTER (WHERE status = 'compliant')::int          AS compliant,
        COUNT(*) FILTER (WHERE status = 'partial')::int            AS partial,
        COUNT(*) FILTER (WHERE status = 'gap')::int                AS gap,
        COUNT(*) FILTER (WHERE status = 'not_applicable')::int     AS not_applicable
      FROM nv_compliance_evidence WHERE org_id = ${orgId}
    `);
    const isc = await db.execute(drsql`
      SELECT COUNT(*)::int                                  AS total,
             COUNT(*) FILTER (WHERE status = 'active')::int AS active,
             COUNT(*) FILTER (WHERE status = 'planned')::int AS planned,
             COUNT(DISTINCT category)::int                   AS categories
      FROM nv_internal_security_controls
    `);
    const pol = await db.execute(drsql`
      SELECT COUNT(*)::int                                  AS total,
             COUNT(*) FILTER (WHERE status = 'active')::int AS active,
             (SELECT COUNT(*)::int FROM nv_policy_violations WHERE status = 'open') AS open_violations
      FROM nv_policies WHERE org_id = ${orgId}
    `);
    const certs = await db.execute(drsql`
      SELECT COUNT(*)::int                                              AS total,
             COUNT(*) FILTER (WHERE valid_to > NOW() + interval '30 days')::int AS healthy,
             COUNT(*) FILTER (WHERE valid_to BETWEEN NOW() AND NOW() + interval '30 days')::int AS expiring,
             COUNT(*) FILTER (WHERE valid_to < NOW())::int              AS expired
      FROM nv_certificates
    `);
    const rot = await db.execute(drsql`
      SELECT COUNT(*)::int                                                 AS total,
             COUNT(*) FILTER (WHERE rotation_at > NOW() - interval '90 days')::int AS recent_90d,
             MAX(rotation_at)                                              AS latest_rotation
      FROM nv_security_key_rotations
    `);

    const fwRow   = (fw.rows ?? fw)[0]   ?? {};
    const evRow   = (ev.rows ?? ev)[0]   ?? {};
    const iscRow  = (isc.rows ?? isc)[0] ?? {};
    const polRow  = (pol.rows ?? pol)[0] ?? {};
    const certsRow= (certs.rows ?? certs)[0] ?? {};
    const rotRow  = (rot.rows ?? rot)[0] ?? {};

    const totalEv = Number(evRow.evidenced_controls ?? 0);
    const score   = totalEv > 0
      ? Math.round(((Number(evRow.compliant) + 0.5 * Number(evRow.partial)) / totalEv) * 10000) / 100
      : 0;

    res.json({
      success: true,
      posture: {
        score_pct: score,
        frameworks: {
          total: Number(fwRow.total_frameworks ?? 0),
          active: Number(fwRow.active_frameworks ?? 0),
          jurisdictions: Number(fwRow.jurisdictions ?? 0),
        },
        controls: {
          catalog_total: Number(fwRow.total_controls ?? 0),
          evidenced: totalEv,
          compliant: Number(evRow.compliant ?? 0),
          partial: Number(evRow.partial ?? 0),
          gap: Number(evRow.gap ?? 0),
          not_applicable: Number(evRow.not_applicable ?? 0),
        },
        internal_security: {
          total: Number(iscRow.total ?? 0),
          active: Number(iscRow.active ?? 0),
          planned: Number(iscRow.planned ?? 0),
          categories: Number(iscRow.categories ?? 0),
        },
        policies: {
          total: Number(polRow.total ?? 0),
          active: Number(polRow.active ?? 0),
          open_violations: Number(polRow.open_violations ?? 0),
        },
        certificates: {
          total: Number(certsRow.total ?? 0),
          healthy: Number(certsRow.healthy ?? 0),
          expiring_30d: Number(certsRow.expiring ?? 0),
          expired: Number(certsRow.expired ?? 0),
        },
        key_rotations: {
          total: Number(rotRow.total ?? 0),
          recent_90d: Number(rotRow.recent_90d ?? 0),
          latest_rotation: rotRow.latest_rotation,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Frameworks list ──────────────────────────────────────────────────────────
router.get('/frameworks', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const jurisdiction = (req.query.jurisdiction as string) || null;

    const r = await db.execute(drsql`
      SELECT f.framework_code, f.name, f.jurisdiction, f.authority, f.version, f.category,
             f.description, f.total_controls, f.effective_from, f.references,
             COALESCE(e.evidenced, 0)::int AS evidenced,
             COALESCE(e.compliant, 0)::int AS compliant,
             COALESCE(e.partial, 0)::int   AS partial,
             COALESCE(e.gap, 0)::int       AS gap,
             CASE WHEN COALESCE(e.evidenced,0) > 0
                  THEN ROUND(((e.compliant + 0.5*e.partial)::numeric / e.evidenced) * 100, 2)
                  ELSE 0 END AS score_pct,
             a.last_assessed_at
      FROM nv_compliance_frameworks f
      LEFT JOIN (
        SELECT framework_code,
               COUNT(*) AS evidenced,
               COUNT(*) FILTER (WHERE status='compliant') AS compliant,
               COUNT(*) FILTER (WHERE status='partial')   AS partial,
               COUNT(*) FILTER (WHERE status='gap')       AS gap,
               MAX(last_assessed_at) AS last_assessed_at
        FROM nv_compliance_evidence WHERE org_id = ${orgId}
        GROUP BY framework_code
      ) e ON e.framework_code = f.framework_code
      LEFT JOIN (
        SELECT framework_code, MAX(generated_at) AS last_assessed_at
        FROM nv_compliance_assessments WHERE org_id = ${orgId} GROUP BY framework_code
      ) a ON a.framework_code = f.framework_code
      WHERE f.active
        ${jurisdiction ? drsql`AND (f.jurisdiction = ${jurisdiction} OR f.jurisdiction = 'ALL')` : drsql``}
      ORDER BY f.jurisdiction, f.name
    `);
    res.json({ success: true, frameworks: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Controls under a framework ───────────────────────────────────────────────
router.get('/frameworks/:code/controls', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const code = String(req.params.code);
    const r = await db.execute(drsql`
      SELECT c.control_code, c.title, c.category, c.severity, c.description,
             c.requirement_text, c.automation_level, c.evidence_source, c.sort_order,
             e.status, e.evidence_type, e.evidence_summary, e.metric_value,
             e.owner_team, e.last_assessed_at, e.next_review_at
      FROM nv_compliance_controls c
      LEFT JOIN nv_compliance_evidence e
             ON e.framework_code = c.framework_code
            AND e.control_code   = c.control_code
            AND e.org_id         = ${orgId}
      WHERE c.framework_code = ${code}
      ORDER BY c.sort_order, c.control_code
    `);
    res.json({ success: true, framework: code, controls: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Internal-security catalog ────────────────────────────────────────────────
router.get('/internal-security', requireRole('org_admin'), async (_req: Request, res: Response) => {
  try {
    const r = await db.execute(drsql`
      SELECT control_code, category, title, description, status, maturity, owner_team,
             frequency, framework_refs, last_verified_at, next_review_at
      FROM nv_internal_security_controls
      ORDER BY category, control_code
    `);
    res.json({ success: true, controls: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/internal-security/categories', async (_req: Request, res: Response) => {
  try {
    const r = await db.execute(drsql`
      SELECT category, COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'active')::int AS active,
             COUNT(*) FILTER (WHERE status = 'planned')::int AS planned
      FROM nv_internal_security_controls GROUP BY category ORDER BY category
    `);
    res.json({ success: true, categories: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Certificates + key rotations + datasets ──────────────────────────────────
router.get('/certificates', async (_req: Request, res: Response) => {
  try {
    const r = await db.execute(drsql`
      SELECT name, scope, issuer, subject, fingerprint, valid_from, valid_to,
             auto_renew, status, last_check_at,
             EXTRACT(EPOCH FROM (valid_to - NOW())) / 86400 AS days_to_expiry
      FROM nv_certificates ORDER BY valid_to ASC
    `);
    res.json({ success: true, certificates: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/key-rotations', requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 500);
    const r = await db.execute(drsql`
      SELECT key_kind, key_label, rotation_at, rotated_by, next_rotation_at, status, notes
      FROM nv_security_key_rotations ORDER BY rotation_at DESC LIMIT ${limit}
    `);
    res.json({ success: true, rotations: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/datasets', requireRole('org_admin'), async (_req: Request, res: Response) => {
  try {
    const r = await db.execute(drsql`
      SELECT dataset_name, classification, jurisdiction, retention_days,
             encryption_at_rest, encryption_in_transit, pii_categories,
             owner_team, storage_location, last_audit_at
      FROM nv_data_governance_records ORDER BY classification DESC, dataset_name
    `);
    res.json({ success: true, datasets: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Per-jurisdiction roll-up (for dashboard map / chip strip) ────────────────
router.get('/by-jurisdiction', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const r = await db.execute(drsql`
      SELECT f.jurisdiction,
             COUNT(DISTINCT f.framework_code)::int AS frameworks,
             COALESCE(SUM(f.total_controls), 0)::int AS controls,
             COALESCE(SUM(CASE WHEN e.status='compliant' THEN 1 ELSE 0 END), 0)::int AS compliant
      FROM nv_compliance_frameworks f
      LEFT JOIN nv_compliance_evidence e
             ON e.framework_code = f.framework_code AND e.org_id = ${orgId}
      WHERE f.active
      GROUP BY f.jurisdiction
      ORDER BY f.jurisdiction
    `);
    res.json({ success: true, jurisdictions: r.rows ?? r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Gate 8 — JRX Bar Council guardrails (live in safety-pipeline + nv-client).
router.get('/gate8/status', async (_req: Request, res: Response) => {
  try {
    const { jrxGuardrailsService } = await import('../services/jrx/jrx-guardrails.js');
    res.json({
      success: true,
      data: {
        gate: 8,
        name: 'JRX Bar Council Guardrails',
        wiredIn: ['safety-pipeline.ts', './jrx-client.ts'],
        routes: {
          gate8Status: '/api/jrx/governance/gate8/status',
          auditChainVerify: '/api/jrx/audit/chain/verify',
          piiVaultStatus: '/api/jrx/phase5/security/pii-vault/status',
        },
        sampleEvaluation: await jrxGuardrailsService.evaluate({
          requestId: 'gate8-status-probe',
          jurisdiction: 'IN',
          agentId: 'A-134',
          responseText: 'Governance status probe — no legal advice rendered.',
        }),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
