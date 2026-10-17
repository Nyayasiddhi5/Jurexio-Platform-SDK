/**
 * Per-Org Console Layout Routes (Phase 5 — Session-15 v13, 2026-05-11)
 *
 * Closes Phase 5 in:
 *   - docs/audit/feature-matrix-and-status-2026-05-11.md §1 / §3
 *   - docs/audit/console-cpo-audit-2026-05-11.md (Phase 5 row)
 *
 * Endpoints (all JWT-auth via the canonical `authenticateToken`):
 *   GET    /api/jrx/admin/org-console-layout/_self/effective
 *            → any authenticated user → returns effective overlay for the
 *              caller's bound org (falls back to platform-default object
 *              when no row exists).
 *   GET    /api/jrx/admin/org-console-layout/:orgId
 *            → org_admin for own org, super_admin for any org → returns the
 *              raw overlay row or the platform default if none.
 *   PUT    /api/jrx/admin/org-console-layout/:orgId
 *            → org_admin for own org, super_admin for any org → upserts.
 *   DELETE /api/jrx/admin/org-console-layout/:orgId
 *            → super_admin only → removes the overlay (back to default).
 *
 * Storage: `nv_org_console_layout` table per `drizzle/0008_org_console_layout.sql`
 * and `shared/schema.ts` (Task #214 — schema-first; runtime CREATE TABLE
 * removed so the table appears in Drizzle introspection / `npm run db:parity`
 * and prod RDS picks it up via the migration, not on first request).
 *
 * Architecture compliance:
 *   - NV-ARCH-001: read/write metadata only — no LLM emission, no bypass.
 *   - NV-AUTH-HEADER-001: not applicable (JWT, not SDK key).
 *   - NV-NAMING-001: file prefix `nv-`, single new file under src/routes/.
 *   - NV-DB-SCRIPT-001: uses runtime `db` (driver-aware) — not a script.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-org-console-layout');
const router = Router();

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PATH_RE = /^\/[A-Za-z0-9/_-]{0,200}$/;

interface ConsoleLayoutRow {
  orgId: string;
  displayName: string | null;
  brandPrimaryHex: string | null;
  brandAccentHex: string | null;
  logoUrl: string | null;
  defaultLanding: string | null;
  sidebarSections: Record<string, boolean>;
  hiddenRoutes: string[];
  featureOverrides: Record<string, boolean>;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  isDefault: boolean;
}

const PLATFORM_DEFAULT: Omit<ConsoleLayoutRow, 'orgId'> = {
  displayName: null,
  brandPrimaryHex: null,
  brandAccentHex: null,
  logoUrl: null,
  defaultLanding: null,
  sidebarSections: {},
  hiddenRoutes: [],
  featureOverrides: {},
  notes: null,
  updatedBy: null,
  updatedAt: null,
  createdAt: null,
  isDefault: true,
};

// NB (Task #214): the previous bootstrap-on-demand `CREATE TABLE IF NOT EXISTS`
// has been removed. The table is now defined in `shared/schema.ts` as
// `nvOrgConsoleLayout` and shipped via `drizzle/0008_org_console_layout.sql`.
// On a fresh dev box, run `npm run migrate` (or `db:push`) once. Prod RDS
// picks it up during the next schema sync.

function rowToLayout(row: any, orgId: string): ConsoleLayoutRow {
  return {
    orgId,
    displayName: row.display_name ?? row.displayName ?? null,
    brandPrimaryHex: row.brand_primary_hex ?? row.brandPrimaryHex ?? null,
    brandAccentHex: row.brand_accent_hex ?? row.brandAccentHex ?? null,
    logoUrl: row.logo_url ?? row.logoUrl ?? null,
    defaultLanding: row.default_landing ?? row.defaultLanding ?? null,
    sidebarSections: row.sidebar_sections ?? row.sidebarSections ?? {},
    hiddenRoutes: row.hidden_routes ?? row.hiddenRoutes ?? [],
    featureOverrides: row.feature_overrides ?? row.featureOverrides ?? {},
    notes: row.notes ?? null,
    updatedBy: row.updated_by ?? row.updatedBy ?? null,
    updatedAt: row.updated_at?.toString() ?? row.updatedAt ?? null,
    createdAt: row.created_at?.toString() ?? row.createdAt ?? null,
    isDefault: false,
  };
}

function defaultLayout(orgId: string): ConsoleLayoutRow {
  return { ...PLATFORM_DEFAULT, orgId, isDefault: true };
}

function callerOrgId(req: Request): string | null {
  const u: any = (req as any).user || {};
  const v = u.organizationId ?? u.organization_id ?? u.orgId ?? u.org_id ?? null;
  return v == null ? null : String(v);
}
function callerRole(req: Request): string {
  return String(((req as any).user || {}).role || 'user');
}

function canEditOrg(req: Request, orgId: string): boolean {
  const role = callerRole(req);
  if (role === 'super_admin') return true;
  if (role === 'org_admin') return callerOrgId(req) === orgId;
  return false;
}

// ── Validation ─────────────────────────────────────────────────────────────
function validatePayload(body: any): { ok: true; payload: Partial<ConsoleLayoutRow> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const out: Partial<ConsoleLayoutRow> = {};
  if (body.displayName != null) {
    if (typeof body.displayName !== 'string' || body.displayName.length > 120) return { ok: false, error: 'displayName must be string ≤ 120 chars' };
    out.displayName = body.displayName;
  }
  for (const k of ['brandPrimaryHex', 'brandAccentHex'] as const) {
    if (body[k] != null) {
      if (typeof body[k] !== 'string' || !HEX_RE.test(body[k])) return { ok: false, error: `${k} must be #RRGGBB hex` };
      out[k] = body[k];
    }
  }
  if (body.logoUrl != null) {
    if (typeof body.logoUrl !== 'string' || body.logoUrl.length > 1024) return { ok: false, error: 'logoUrl must be string ≤ 1024 chars' };
    if (body.logoUrl && !/^https?:\/\//i.test(body.logoUrl)) return { ok: false, error: 'logoUrl must start with http(s)://' };
    out.logoUrl = body.logoUrl;
  }
  if (body.defaultLanding != null) {
    if (typeof body.defaultLanding !== 'string' || !PATH_RE.test(body.defaultLanding)) return { ok: false, error: 'defaultLanding must be a path like /chat-hub' };
    out.defaultLanding = body.defaultLanding;
  }
  if (body.sidebarSections != null) {
    if (typeof body.sidebarSections !== 'object' || Array.isArray(body.sidebarSections)) return { ok: false, error: 'sidebarSections must be an object map' };
    const map: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(body.sidebarSections)) {
      if (typeof k !== 'string' || k.length > 64) return { ok: false, error: 'sidebarSections keys must be string ≤ 64 chars' };
      if (typeof v !== 'boolean') return { ok: false, error: `sidebarSections.${k} must be boolean` };
      map[k] = v;
    }
    out.sidebarSections = map;
  }
  if (body.hiddenRoutes != null) {
    if (!Array.isArray(body.hiddenRoutes)) return { ok: false, error: 'hiddenRoutes must be an array' };
    const arr: string[] = [];
    for (const p of body.hiddenRoutes) {
      if (typeof p !== 'string' || !PATH_RE.test(p)) return { ok: false, error: `hiddenRoutes contains invalid path: ${p}` };
      arr.push(p);
    }
    out.hiddenRoutes = arr;
  }
  if (body.featureOverrides != null) {
    if (typeof body.featureOverrides !== 'object' || Array.isArray(body.featureOverrides)) return { ok: false, error: 'featureOverrides must be an object map' };
    const map: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(body.featureOverrides)) {
      if (typeof k !== 'string' || k.length > 96) return { ok: false, error: 'featureOverrides keys must be string ≤ 96 chars' };
      if (typeof v !== 'boolean') return { ok: false, error: `featureOverrides.${k} must be boolean` };
      map[k] = v;
    }
    out.featureOverrides = map;
  }
  if (body.notes != null) {
    if (typeof body.notes !== 'string' || body.notes.length > 2000) return { ok: false, error: 'notes must be string ≤ 2000 chars' };
    out.notes = body.notes;
  }
  return { ok: true, payload: out };
}

// ── GET /_self/effective — any authenticated user ────────────────────────
router.get('/_self/effective', authenticateToken, async (req: Request, res: Response) => {
  try {
    const orgId = callerOrgId(req);
    if (!orgId) {
      // No bound org → return defaults so the SPA still renders.
      res.json({ success: true, data: defaultLayout('') });
      return;
    }
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const layout = await req.withTenant!(async (tx) => {
      const result = await tx.execute(sql`
        SELECT * FROM nv_org_console_layout WHERE org_id = ${orgId} LIMIT 1
      `);
      const rows: any[] = (result as any).rows ?? result ?? [];
      return rows.length ? rowToLayout(rows[0], orgId) : defaultLayout(orgId);
    });
    res.json({ success: true, data: layout });
  } catch (err: any) {
    logger.error({ err }, 'GET /_self/effective failed');
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ── GET /:orgId — org_admin own / super_admin any ────────────────────────
router.get('/:orgId', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const orgId = String(req.params.orgId || '').trim();
    if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
    if (!canEditOrg(req, orgId)) {
      res.status(403).json({ success: false, error: 'org_admin may only access their own org; super_admin can access any.' });
      return;
    }
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const layout = await req.withTenant!(async (tx) => {
      const result = await tx.execute(sql`
        SELECT * FROM nv_org_console_layout WHERE org_id = ${orgId} LIMIT 1
      `);
      const rows: any[] = (result as any).rows ?? result ?? [];
      return rows.length ? rowToLayout(rows[0], orgId) : defaultLayout(orgId);
    });
    res.json({ success: true, data: layout });
  } catch (err: any) {
    logger.error({ err, orgId: req.params.orgId }, 'GET /:orgId failed');
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ── PUT /:orgId — upsert ────────────────────────────────────────────────
router.put('/:orgId', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const orgId = String(req.params.orgId || '').trim();
    if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
    if (!canEditOrg(req, orgId)) {
      res.status(403).json({ success: false, error: 'org_admin may only edit their own org; super_admin can edit any.' });
      return;
    }
    const validation = validatePayload(req.body);
    if (!validation.ok) { res.status(400).json({ success: false, error: validation.error }); return; }
    const p = validation.payload;
    const u: any = (req as any).user || {};
    const actor = String(u.id ?? u.userId ?? u.email ?? 'unknown');
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const saved = await req.withTenant!(async (tx) => {
      await tx.execute(sql`
        INSERT INTO nv_org_console_layout (
          org_id, display_name, brand_primary_hex, brand_accent_hex, logo_url,
          default_landing, sidebar_sections, hidden_routes, feature_overrides,
          notes, updated_by, updated_at, created_at
        ) VALUES (
          ${orgId},
          ${p.displayName ?? null},
          ${p.brandPrimaryHex ?? null},
          ${p.brandAccentHex ?? null},
          ${p.logoUrl ?? null},
          ${p.defaultLanding ?? null},
          ${JSON.stringify(p.sidebarSections ?? {})}::jsonb,
          ${JSON.stringify(p.hiddenRoutes ?? [])}::jsonb,
          ${JSON.stringify(p.featureOverrides ?? {})}::jsonb,
          ${p.notes ?? null},
          ${actor},
          NOW(),
          NOW()
        )
        ON CONFLICT (org_id) DO UPDATE SET
          display_name      = EXCLUDED.display_name,
          brand_primary_hex = EXCLUDED.brand_primary_hex,
          brand_accent_hex  = EXCLUDED.brand_accent_hex,
          logo_url          = EXCLUDED.logo_url,
          default_landing   = EXCLUDED.default_landing,
          sidebar_sections  = EXCLUDED.sidebar_sections,
          hidden_routes     = EXCLUDED.hidden_routes,
          feature_overrides = EXCLUDED.feature_overrides,
          notes             = EXCLUDED.notes,
          updated_by        = EXCLUDED.updated_by,
          updated_at        = NOW()
      `);
      const result = await tx.execute(sql`
        SELECT * FROM nv_org_console_layout WHERE org_id = ${orgId} LIMIT 1
      `);
      const rows: any[] = (result as any).rows ?? result ?? [];
      return rows.length ? rowToLayout(rows[0], orgId) : defaultLayout(orgId);
    });
    res.json({ success: true, data: saved });
  } catch (err: any) {
    logger.error({ err, orgId: req.params.orgId }, 'PUT /:orgId failed');
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ── DELETE /:orgId — super_admin only ───────────────────────────────────
router.delete('/:orgId', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const orgId = String(req.params.orgId || '').trim();
    if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    await req.withTenant!(async (tx) => {
      await tx.execute(sql`DELETE FROM nv_org_console_layout WHERE org_id = ${orgId}`);
    });
    res.json({ success: true, data: { orgId, deleted: true } });
  } catch (err: any) {
    logger.error({ err, orgId: req.params.orgId }, 'DELETE /:orgId failed');
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

export default router;
