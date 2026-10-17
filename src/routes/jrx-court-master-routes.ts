/**
 * NV-COURT-MASTER-P0-001 — Partner jurisdiction cascade lookup routes.
 * Mount: /api/jrx/v1/sdk/jurisdiction/*
 * Auth: dualSdkOrJwt (same SDK key surface as the CNR partner routes).
 *
 * eCourts/NSP-style cascade for matter-intake dropdowns:
 *   GET /court-types                                   → sc | hc | dc
 *   GET /states?courtType=hc|dc|sc                     → states/benches for a tier
 *   GET /districts?courtType=dc&state=                 → districts (DC focus, P0)
 *   GET /complexes?courtType=dc&state=&district=       → court complexes (DC, P0)
 *   GET /case-types?courtType=&state=                  → case-type code → display
 *
 * Static reference data only — every response carries claimEcourts:false.
 * Ref: NSP-CASE-SEARCH-INTEGRATION-2026-09.md §18.
 */
import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { partnerIndiaScopeMiddleware } from '../middleware/jrx-partner-india-scope.js';
import { createLogger } from '../utils/logger.js';
import { partnerSafeMessage } from '../utils/jrx-partner-safe-message.js';
import {
  COURT_TYPES,
  getCourtMasterProvider,
  parseCourtType,
  type CourtMasterProvider,
} from '../services/jrx-court-master-lookup.js';

const router = Router();
const logger = createLogger('./jrx-court-master-routes');

router.use(dualSdkOrJwt);
router.use(partnerIndiaScopeMiddleware);

function ensureProvider(res: Response): CourtMasterProvider | null {
  const provider = getCourtMasterProvider();
  if (!provider) {
    res.status(503).json({
      success: false,
      claimEcourts: false,
      error: {
        code: 'COURT_MASTER_UNAVAILABLE',
        message: partnerSafeMessage.caseLookupUnavailable,
        retryable: true,
      },
    });
    return null;
  }
  return provider;
}

function queryString(req: Request, key: string): string {
  const v = req.query[key];
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return '';
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    claimEcourts: false,
    error: { code: 'BAD_REQUEST', message },
  });
}

function ok(res: Response, data: unknown): void {
  res.status(200).json({
    success: true,
    claimEcourts: false,
    source: 'nyv_court_master',
    data,
  });
}

function fail(res: Response, err: unknown): void {
  logger.warn('[court-master] lookup failed', {
    err: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({
    success: false,
    claimEcourts: false,
    error: { code: 'COURT_MASTER_FAILED', message: partnerSafeMessage.caseLookupUnavailable },
  });
}

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      product: 'Jurisdiction court master',
      code: 'court-master-lookup',
      claimEcourts: false,
      status: getCourtMasterProvider() ? 'ready' : 'db_unconfigured',
      courtTypes: COURT_TYPES.map((c) => c.code),
    },
  });
});

/** GET /court-types → sc | hc | dc */
router.get('/court-types', async (_req, res) => {
  const provider = ensureProvider(res);
  if (!provider) return;
  try {
    const data = await provider.listCourtTypes();
    ok(res, { courtTypes: data, count: data.length });
  } catch (err) {
    fail(res, err);
  }
});

/** GET /states?courtType=hc|dc|sc */
router.get('/states', async (req, res) => {
  const courtType = parseCourtType(queryString(req, 'courtType'));
  if (!courtType) return badRequest(res, 'courtType is required (sc | hc | dc)');
  const provider = ensureProvider(res);
  if (!provider) return;
  try {
    const data = await provider.listStates(courtType);
    ok(res, { courtType, states: data, count: data.length });
  } catch (err) {
    fail(res, err);
  }
});

/** GET /districts?courtType=dc&state= */
router.get('/districts', async (req, res) => {
  const courtType = parseCourtType(queryString(req, 'courtType'));
  if (!courtType) return badRequest(res, 'courtType is required (sc | hc | dc)');
  const state = queryString(req, 'state');
  if (!state) return badRequest(res, 'state is required (state code or name)');
  const provider = ensureProvider(res);
  if (!provider) return;
  try {
    const data = await provider.listDistricts(courtType, state);
    ok(res, { courtType, state, districts: data, count: data.length });
  } catch (err) {
    fail(res, err);
  }
});

/** GET /complexes?courtType=dc&state=&district= (P0 DC focus) */
router.get('/complexes', async (req, res) => {
  const courtType = parseCourtType(queryString(req, 'courtType'));
  if (!courtType) return badRequest(res, 'courtType is required (sc | hc | dc)');
  const state = queryString(req, 'state');
  if (!state) return badRequest(res, 'state is required (state code or name)');
  const district = queryString(req, 'district');
  if (!district) return badRequest(res, 'district is required (district code or name)');
  const provider = ensureProvider(res);
  if (!provider) return;
  try {
    const data = await provider.listComplexes(courtType, state, district);
    ok(res, { courtType, state, district, complexes: data, count: data.length });
  } catch (err) {
    fail(res, err);
  }
});

/** GET /case-types?courtType=&state= (optional state) */
router.get('/case-types', async (req, res) => {
  const courtType = parseCourtType(queryString(req, 'courtType'));
  if (!courtType) return badRequest(res, 'courtType is required (sc | hc | dc)');
  const state = queryString(req, 'state');
  const provider = ensureProvider(res);
  if (!provider) return;
  try {
    const data = await provider.listCaseTypes(courtType, state || undefined);
    ok(res, { courtType, state: state || null, caseTypes: data, count: data.length });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
