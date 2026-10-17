/**
 * nv-statutes-routes.ts (2026-05-13)
 *
 * Read-only statute browser feeding the Console Knowledge → Statutes & Citations page.
 *   GET /api/jrx/statutes               — paged + jurisdiction/practice_area/q filter
 *   GET /api/jrx/statutes/_summary      — counts by jurisdiction + practice area
 *   GET /api/jrx/statutes/:id           — full section + related sections
 *
 * Auth: dualSdkOrJwt (canonical NV-AUTH-HEADER-001).
 */
import { Router, Request, Response } from 'express';
import { sql as drsql } from 'drizzle-orm';
import { db as rawDb } from '../db/index.js';
import { requireDb } from '../utils/jrx-type-helpers.js';

const db = requireDb(rawDb);
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { createLogger } from '../utils/logger.js';
import { safeError, sendApiError } from '../utils/jrx-api-error.js';

const logger = createLogger('./jrx-statutes-routes');
const router = Router();
router.use(dualSdkOrJwt);

function rows(r: unknown): any[] { return (r as { rows?: any[] })?.rows ?? (Array.isArray(r) ? r as any[] : []); }

router.get('/_summary', async (_req: Request, res: Response) => {
  try {
    const [byJur, byArea, totalRow] = await Promise.all([
      db.execute(drsql`SELECT jurisdiction, COUNT(*)::int AS c FROM nv_statutes GROUP BY jurisdiction ORDER BY 1`),
      db.execute(drsql`SELECT COALESCE(practice_area,'unspecified') AS practice_area, COUNT(*)::int AS c FROM nv_statutes GROUP BY practice_area ORDER BY c DESC LIMIT 25`),
      db.execute(drsql`SELECT COUNT(*)::int AS c FROM nv_statutes WHERE is_repealed = false`),
    ]);
    res.json({
      success: true,
      total: Number(rows(totalRow)[0]?.c ?? 0),
      by_jurisdiction: rows(byJur).map((r: any) => ({ jurisdiction: r.jurisdiction, count: Number(r.c) })),
      by_practice_area: rows(byArea).map((r: any) => ({ practice_area: r.practice_area, count: Number(r.c) })),
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    logger.warn('statutes_summary_failed', { err: e?.message });
    res.json({ success: true, total: 0, by_jurisdiction: [], by_practice_area: [] });
  }
});

router.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10));
  const jurisdiction = req.query.jurisdiction ? String(req.query.jurisdiction).toUpperCase() : null;
  const practiceArea = req.query.practice_area ? String(req.query.practice_area) : null;
  const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;

  try {
    const data = await db.execute(drsql`
      SELECT id, act_short_title, act_title, jurisdiction, section_number, section_title,
             LEFT(section_text, 600) AS section_excerpt, practice_area, keywords,
             effective_date, amended_date, is_repealed,
             COALESCE(updated_at, created_at) AS changed_at
      FROM nv_statutes
      WHERE is_repealed = false
        AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
        AND (${practiceArea}::text IS NULL OR practice_area = ${practiceArea})
        AND (${q}::text IS NULL OR LOWER(act_title) LIKE ${q} OR LOWER(section_title) LIKE ${q} OR LOWER(section_text) LIKE ${q})
      ORDER BY jurisdiction, act_short_title, section_number
      LIMIT ${limit} OFFSET ${offset}
    `);
    const total = await db.execute(drsql`
      SELECT COUNT(*)::int AS c FROM nv_statutes
      WHERE is_repealed = false
        AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
        AND (${practiceArea}::text IS NULL OR practice_area = ${practiceArea})
        AND (${q}::text IS NULL OR LOWER(act_title) LIKE ${q} OR LOWER(section_title) LIKE ${q} OR LOWER(section_text) LIKE ${q})
    `);
    res.json({
      success: true,
      statutes: rows(data),
      paging: { limit, offset, returned: rows(data).length, total: Number(rows(total)[0]?.c ?? 0) },
      filter: { jurisdiction, practice_area: practiceArea, q: req.query.q ?? null },
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    logger.warn('statutes_list_failed', { err: e?.message });
    res.json({ success: true, statutes: [], paging: { limit, offset, returned: 0, total: 0 } });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  const rawQuery = String(req.query.query ?? req.query.q ?? '').trim();
  if (!rawQuery) {
    sendApiError(res, 'QUERY_REQUIRED');
    return;
  }
  const jurisdiction = req.query.jurisdiction ? String(req.query.jurisdiction).toUpperCase() : undefined;
  const practiceArea = req.query.practice_area
    ? String(req.query.practice_area)
    : req.query.practiceArea
      ? String(req.query.practiceArea)
      : undefined;
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10)));

  try {
    const { searchStatutes } = await import('../services/jrx-statute-seeding-service.js');
    let results = await searchStatutes(rawQuery, jurisdiction, practiceArea, limit);

    // When Knowledge Plane is on, merge/prefer NYS statute hits (federated SoT)
    let nysMerged = false;
    try {
      const { isNyvFeatureOn } = await import('../config/jrx-feature-flags.js');
      if (isNyvFeatureOn('nysKnowledgePlane')) {
        const { nysKnowledgeRequest, isNysKnowledgeConfigured } = await import(
          '../services/jrx-nys-knowledge-client.js'
        );
        if (isNysKnowledgeConfigured()) {
          const nys = await nysKnowledgeRequest<{ results?: any[] }>({
            method: 'GET',
            path: '/statutes/search',
            query: {
              q: rawQuery,
              jurisdiction: jurisdiction || 'IN',
              limit,
            },
          });
          if (nys.ok && Array.isArray(nys.data?.results) && nys.data.results.length > 0) {
            nysMerged = true;
            const mapped = nys.data.results.map((s: any) => ({
              act_title: s.title || s.heading || s.code,
              act_short_title: s.code,
              jurisdiction: jurisdiction || 'IN',
              section_number: s.section,
              section_title: s.title || s.heading,
              section_preview: String(s.text || s.content || '').slice(0, 500),
              practice_area: practiceArea,
              keywords: [],
              rank: typeof s.score === 'number' ? s.score : 0.85,
              matchType: 'nys',
              source: 'nys',
            }));
            // Prefer NYS when local empty; otherwise prepend unique NYS hits
            if (results.length === 0) {
              results = mapped;
            } else {
              const keys = new Set(
                results.map((r: any) => `${r.act_short_title}:${r.section_number}`.toLowerCase()),
              );
              for (const m of mapped) {
                const k = `${m.act_short_title}:${m.section_number}`.toLowerCase();
                if (!keys.has(k)) results.unshift(m);
              }
              results = results.slice(0, limit);
            }
          }
        }
      }
    } catch {
      /* fail-soft — local results still returned */
    }

    res.json({
      success: true,
      results,
      data: { results, total: results.length, query: rawQuery, jurisdiction: jurisdiction ?? 'all' },
      query: rawQuery,
      jurisdiction: jurisdiction ?? 'all',
      nysMerged,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    logger.warn('statutes_search_failed', { err: e?.message });
    safeError(res, e, 500);
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  if (!/^\d+$/.test(id)) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'invalid_id' });
    return;
  }
  try {
    const data = await db.execute(drsql`SELECT * FROM nv_statutes WHERE id = ${Number(id)} LIMIT 1`);
    const row = rows(data)[0];
    if (!row) { sendApiError(res, 'NOT_FOUND'); return; }
    res.json({ success: true, statute: row, generatedAt: new Date().toISOString() });
  } catch (e: any) {
    logger.warn('statute_get_failed', { err: e?.message });
    safeError(res, e, 500);
  }
});

export default router;
