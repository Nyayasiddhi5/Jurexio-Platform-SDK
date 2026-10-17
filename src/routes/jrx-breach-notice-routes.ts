/**
 * Jurexio Enterprise Platform — Breach Notice API (task-356).
 *
 * Closes the loop on US state breach-notification: file an incident,
 * draft per-state notices (NY SHIELD §899-aa, MA c.93H §3, IL BIPA),
 * route to the Compliance owner queue, dispatch outbound, persist
 * the audit trail. Backed by `jrx-breach-notice-service`.
 *
 * Routes (all dualSdkOrJwt-gated, NV-AUTH-HEADER-001 compliant):
 *   POST /api/jrx/compliance/breach            — file an incident
 *   GET  /api/jrx/compliance/breach/:id        — read incident + notices
 *   GET  /api/jrx/compliance/breach            — list incidents (org-scoped)
 *
 * NV-NAMING-001 / NV-WIRING-001 / NV-AUTH-HEADER-001 compliant.
 */
import { Router, type Request, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { db } from '../db/index.js';
import {
  fileBreachIncident,
  getBreachIncident,
  type BreachIncidentInput,
} from '../services/compliance/jrx-breach-notice-service.js';

const router = Router();
router.use(dualSdkOrJwt);

const orgFromReq = (req: Request): string => {
  const raw = (req as any).user?.orgId
           ?? (req as any).user?.organizationId
           ?? (req as any).serviceIdentity?.orgId
           ?? req.headers['x-organization-id']
           ?? '1';
  return String(raw);
};

// ── POST /api/jrx/compliance/breach — file an incident ──────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const body = req.body ?? {};
    // SECURITY: orgId is sourced from the authenticated identity, never
    // from the request body. A caller-supplied `orgId` would let one
    // tenant file statutory notices (and CAM actions, and audit-chain
    // events) on behalf of another. If a body.orgId is present and does
    // NOT match the auth-context org, reject with 403.
    const bodyOrg = body.orgId ?? body.org_id;
    if (bodyOrg !== undefined && bodyOrg !== null && String(bodyOrg) !== orgId) {
      return res.status(403).json({
        success: false,
        code: 'BREACH_ORG_MISMATCH',
        error: 'orgId in request body does not match the authenticated organisation',
      });
    }
    const input: BreachIncidentInput = {
      incidentId: String(body.incidentId ?? body.incident_id ?? '').trim(),
      orgId,
      discoveredAt: String(body.discoveredAt ?? body.discovered_at ?? new Date().toISOString()),
      occurredAt: body.occurredAt ?? body.occurred_at ?? undefined,
      natureOfBreach: String(body.natureOfBreach ?? body.nature_of_breach ?? ''),
      dataCategories: Array.isArray(body.dataCategories) ? body.dataCategories
                     : Array.isArray(body.data_categories) ? body.data_categories
                     : [],
      affectedResidents: Array.isArray(body.affectedResidents) ? body.affectedResidents
                        : Array.isArray(body.affected_residents) ? body.affected_residents
                        : [],
      containmentSummary: body.containmentSummary ?? body.containment_summary,
      encryptionStatus: body.encryptionStatus ?? body.encryption_status,
      estimatedCostUSD: body.estimatedCostUSD ?? body.estimated_cost_usd,
      bipaCulpability: body.bipaCulpability ?? body.bipa_culpability,
      contact: body.contact ?? { name: '', email: '' },
      filedBy: (req as any).user?.email ?? (req as any).user?.id ?? body.filedBy ?? null,
    };
    if (!input.incidentId) {
      return res.status(400).json({ success: false, code: 'BREACH_INCIDENT_ID_REQUIRED', error: 'incidentId is required' });
    }
    if (!input.natureOfBreach) {
      return res.status(400).json({ success: false, code: 'BREACH_NATURE_REQUIRED', error: 'natureOfBreach is required' });
    }
    if (!input.affectedResidents.length) {
      return res.status(400).json({ success: false, code: 'BREACH_AFFECTED_RESIDENTS_REQUIRED', error: 'affectedResidents must be a non-empty array' });
    }
    if (!input.contact?.name || !input.contact?.email) {
      return res.status(400).json({ success: false, code: 'BREACH_CONTACT_REQUIRED', error: 'contact.name and contact.email are required' });
    }
    const out = await fileBreachIncident(input);
    return res.status(201).json({ success: true, ...out });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? String(err) });
  }
});

// ── GET /api/jrx/compliance/breach/:id — read incident + notices ────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const orgId = orgFromReq(req);
    const out = await getBreachIncident(String(req.params.id), orgId);
    if (!out || !out.incident) {
      return res.status(404).json({ success: false, code: 'BREACH_INCIDENT_NOT_FOUND' });
    }
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? String(err) });
  }
});

// ── GET /api/jrx/compliance/breach — list incidents (org-scoped) ────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!db) return res.json({ success: true, incidents: [] });
    const orgId = orgFromReq(req);
    const r: any = await db.execute(sql`
      SELECT i.incident_id, i.org_id, i.discovered_at, i.occurred_at,
             i.nature_of_breach, i.data_categories, i.affected_residents,
             i.encryption_status, i.created_at,
             (SELECT COUNT(*)::int FROM nv_breach_notices n WHERE n.org_id = i.org_id AND n.incident_id = i.incident_id) AS notice_count,
             (SELECT COUNT(*)::int FROM nv_breach_notices n WHERE n.org_id = i.org_id AND n.incident_id = i.incident_id AND n.delivery_status IN ('sent','queued')) AS dispatched_count,
             (SELECT COUNT(*)::int FROM nv_bipa_damage_records b WHERE b.org_id = i.org_id AND b.incident_id = i.incident_id) AS bipa_record_count
      FROM nv_breach_incidents i
      WHERE i.org_id = ${orgId}
      ORDER BY i.created_at DESC
      LIMIT 200
    `);
    return res.json({ success: true, incidents: r.rows ?? r });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? String(err) });
  }
});

export default router;
