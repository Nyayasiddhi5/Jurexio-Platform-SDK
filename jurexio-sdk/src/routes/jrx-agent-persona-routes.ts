// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX-SVC-PERSONA Routes — /api/jrx/personas/*
 */

import { Router, Request, Response } from 'express';
import { agentPersonaService, type Platform, type TimeOfDay } from '../services/agent-persona-service.js';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(authenticate as any);

// ── GET /api/jrx/personas/ — list all base personas ────────────────────────────
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const personas = agentPersonaService.listAllPersonas().map(p => ({
      agentKey: p.agentKey,
      name: p.name,
      specialty: p.specialty,
      jurisdiction: p.jurisdiction,
      practiceArea: p.practiceArea,
      responseStyle: p.responseStyle,
      traits: p.traits,
      values: p.values,
      currentMood: p.moods[agentPersonaService.getCurrentTimeOfDay()],
    }));
    res.json({ success: true, personas, total: personas.length, currentTimeOfDay: agentPersonaService.getCurrentTimeOfDay() });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to list personas.', error: err.message });
  }
});

// ── GET /api/jrx/personas/:agentKey ───────────────────────────────────────────
router.get('/:agentKey', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    // NV-UAT-DEFAULT-ORG-001 (task #335): dev / E2E-bypass replaces the
    // legacy 'default' fallback with platform-baseline org_id=1.
    const orgId = user?.orgId || user?.organizationId ||
      ((process.env.NODE_ENV !== 'production') ? '1' : 'default');
    const { agentKey } = req.params;

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const persona = await agentPersonaService.getPersona(agentKey, orgId);
    const timeOfDay = agentPersonaService.getCurrentTimeOfDay();
    const currentMood = persona.moods[timeOfDay];
    const systemPrompt = agentPersonaService.buildPersonaSystemPrompt(persona, timeOfDay);

    res.json({
      success: true,
      persona,
      currentTimeOfDay: timeOfDay,
      currentMood,
      systemPromptPreview: systemPrompt.substring(0, 500) + '...',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get persona.', error: err.message });
  }
});

// ── PUT /api/jrx/personas/:agentKey — override persona for org ─────────────────
// NV-RBAC-GAP-001: org-wide persona override is a manager/admin action (it
// changes agent behaviour for the whole org) — gate above the default authed user.
router.put('/:agentKey', requireRole('manager', 'org_admin') as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    // NV-UAT-DEFAULT-ORG-001 (task #335): dev / E2E-bypass replaces the
    // legacy 'default' fallback with platform-baseline org_id=1.
    const orgId = user?.orgId || user?.organizationId ||
      ((process.env.NODE_ENV !== 'production') ? '1' : 'default');
    const { agentKey } = req.params;
    const overrides = req.body;

    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      res.status(400).json({ success: false, message: 'Request body must be a JSON object with persona overrides.' });
      return;
    }

    const allowedFields = ['name', 'intro', 'lore', 'values', 'traits', 'filteringRules', 'responseStyle', 'moods', 'postExamples', 'platformSettings'];
    const invalidFields = Object.keys(overrides).filter(k => !allowedFields.includes(k));
    if (invalidFields.length > 0) {
      res.status(400).json({ success: false, message: `Invalid override fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}` });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    await agentPersonaService.savePersonaOverride(agentKey, orgId, overrides);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const updatedPersona = await agentPersonaService.getPersona(agentKey, orgId);

    res.json({ success: true, message: `Persona override saved for agent ${agentKey}.`, persona: updatedPersona });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to save persona override.', error: err.message });
  }
});

// ── POST /api/jrx/personas/generate-post — time-of-day aware content ───────────
router.post('/generate-post', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    // NV-UAT-DEFAULT-ORG-001 (task #335): dev / E2E-bypass replaces the
    // legacy 'default' fallback with platform-baseline org_id=1.
    const orgId = user?.orgId || user?.organizationId ||
      ((process.env.NODE_ENV !== 'production') ? '1' : 'default');
    const { agentKey, platform = 'portal', timeOfDay } = req.body;

    if (!agentKey) {
      res.status(400).json({ success: false, message: 'agentKey is required.' });
      return;
    }

    const validPlatforms: Platform[] = ['whatsapp', 'email', 'portal', 'api'];
    const validTimeOfDay: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

    if (!validPlatforms.includes(platform)) {
      res.status(400).json({ success: false, message: `platform must be one of: ${validPlatforms.join(', ')}` });
      return;
    }
    if (timeOfDay && !validTimeOfDay.includes(timeOfDay)) {
      res.status(400).json({ success: false, message: `timeOfDay must be one of: ${validTimeOfDay.join(', ')}` });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const post = await agentPersonaService.generatePersonaPost(agentKey, orgId, platform as Platform, timeOfDay as TimeOfDay | undefined);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const persona = await agentPersonaService.getPersona(agentKey, orgId);
    const effectiveTimeOfDay = timeOfDay || agentPersonaService.getCurrentTimeOfDay();

    res.json({
      success: true,
      post,
      agentKey,
      agentName: persona.name,
      platform,
      timeOfDay: effectiveTimeOfDay,
      mood: persona.moods[effectiveTimeOfDay as TimeOfDay],
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to generate post.', error: err.message });
  }
});

// ── GET /api/jrx/personas/:agentKey/system-prompt ─────────────────────────────
router.get('/:agentKey/system-prompt', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    // NV-UAT-DEFAULT-ORG-001 (task #335): dev / E2E-bypass replaces the
    // legacy 'default' fallback with platform-baseline org_id=1.
    const orgId = user?.orgId || user?.organizationId ||
      ((process.env.NODE_ENV !== 'production') ? '1' : 'default');
    const { agentKey } = req.params;
    const timeOfDay = (req.query.timeOfDay as TimeOfDay) || agentPersonaService.getCurrentTimeOfDay();

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const persona = await agentPersonaService.getPersona(agentKey, orgId);
    const systemPrompt = agentPersonaService.buildPersonaSystemPrompt(persona, timeOfDay);

    res.json({ success: true, agentKey, personaName: persona.name, timeOfDay, systemPrompt });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to build system prompt.', error: err.message });
  }
});

export default router;
