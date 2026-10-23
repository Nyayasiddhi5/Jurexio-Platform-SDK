// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX Agent Skills Routes v1.0.0
 * JRX-SVC-SKILLS-ROUTES-001
 *
 * Exposes the Skills System Service as a full HTTP REST API.
 * Skills are composable, versioned capability modules that enhance any
 * ROMA L5 agent with specialised legal domain expertise.
 *
 * Mounted at: /api/jrx/skills
 *
 * Endpoints:
 *   GET  /health                       — Skills system health
 *   GET  /                             — List skills (filtered)
 *   GET  /:skillId                     — Get single skill by ID
 *   POST /register                     — Register a custom skill
 *   POST /activate                     — Activate best skills for a context
 *   POST /record-performance           — Record skill performance after use
 *   GET  /marketplace                  — Browse public skills marketplace
 *   GET  /categories                   — List all skill categories
 *   GET  /stats                        — Skill usage statistics
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { skillsSystem } from '../services/skills/skills-system-service.js';
import type { SkillCategory, SkillTier } from '../services/skills/skills-system-service.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-skills-routes');

function userId(req: Request): string {
  return req.user?.userId || req.user?.id || 'anonymous';
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const ActivateSkillsSchema = z.object({
  agentId: z.string().min(1).max(200),
  jurisdiction: z.enum(['IN', 'UK', 'GC', 'EU', 'US', 'SG', 'ALL']).default('IN'),
  practiceArea: z.string().min(1).max(100),
  tier: z.enum(['solo', 'plus', 'pro', 'enterprise']).default('pro'),
  taskType: z.string().min(1).max(200),
  userId: z.string().optional(),
});

const RegisterSkillSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'ID must be lowercase alphanumeric with hyphens'),
  name: z.string().min(2).max(200),
  description: z.string().min(10).max(2000),
  category: z.enum([
    'legal-research', 'document-drafting', 'compliance-checking', 'negotiation',
    'litigation', 'advisory', 'regulatory', 'tax', 'ip-patent',
    'corporate-governance', 'criminal-defense', 'family-law', 'real-estate',
    'arbitration', 'cross-border',
  ]),
  tier: z.enum(['basic', 'professional', 'expert', 'sovereign']).default('basic'),
  version: z.string().default('1.0.0'),
  author: z.string().min(1).max(100),
  jurisdictions: z.array(z.string()).min(1),
  practiceAreas: z.array(z.string()).min(1),
  systemPromptDelta: z.string().min(10).max(50000),
  toolRequirements: z.array(z.string()).default([]),
  slmPreference: z.string().optional(),
  romaLevel: z.enum(['L1', 'L2', 'L3', 'L4', 'L5']).default('L3'),
  tags: z.array(z.string()).default([]),
  isPublic: z.boolean().default(false),
  organizationId: z.string().optional(),
});

const RecordPerformanceSchema = z.object({
  skillId: z.string().min(1),
  jurisdiction: z.string().min(1),
  qualityScore: z.number().min(0).max(100),
  responseTimeMs: z.number().min(0),
  success: z.boolean(),
});

// ─── Health ───────────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  try {
    const health = skillsSystem.healthCheck();
    res.json({
      success: true,
      service: 'JRX-SVC-SKILLS-SYSTEM-001',
      version: '1.0.0',
      ...health,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── List Skills ──────────────────────────────────────────────────────────────

router.get('/', authenticateToken, (req: Request, res: Response) => {
  try {
    const { category, jurisdiction, tier, isPublic, orgId } = req.query;
    const filters: any = {};
    if (category) filters.category = category as SkillCategory;
    if (jurisdiction) filters.jurisdiction = jurisdiction as string;
    if (tier) filters.tier = tier as SkillTier;
    if (isPublic !== undefined) filters.isPublic = isPublic === 'true';
    if (orgId) filters.organizationId = orgId as string;

    const skills = skillsSystem.getSkills(filters);
    res.json({
      success: true,
      data: {
        skills: skills.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          category: s.category,
          tier: s.tier,
          version: s.version,
          jurisdictions: s.jurisdictions,
          practiceAreas: s.practiceAreas,
          romaLevel: s.romaLevel,
          tags: s.tags,
          isPublic: s.isPublic,
          metrics: s.metrics,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        total: skills.length,
        filters,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Skill Marketplace (public skills) — MUST be before /:skillId ─────────────

router.get('/marketplace', authenticateToken, (req: Request, res: Response) => {
  try {
    const { category, jurisdiction, tier, search } = req.query;
    const filters: any = { isPublic: true };
    if (category) filters.category = category as SkillCategory;
    if (jurisdiction) filters.jurisdiction = jurisdiction as string;
    if (tier) filters.tier = tier as SkillTier;

    let skills = skillsSystem.getSkills(filters);

    if (search) {
      const q = (search as string).toLowerCase();
      skills = skills.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    const grouped = skills.reduce((acc, s) => {
      if (!acc[s.category]) acc[s.category] = [];
      acc[s.category].push({
        id: s.id,
        name: s.name,
        description: s.description,
        tier: s.tier,
        jurisdictions: s.jurisdictions,
        metrics: s.metrics,
        tags: s.tags,
      });
      return acc;
    }, {} as Record<string, any[]>);

    res.json({
      success: true,
      data: {
        marketplace: {
          totalSkills: skills.length,
          categories: Object.keys(grouped).length,
          byCategory: grouped,
          featured: skills
            .filter(s => s.metrics.averageQualityScore > 80 || s.metrics.usageCount > 100)
            .slice(0, 5)
            .map(s => ({ id: s.id, name: s.name, tier: s.tier, rating: s.metrics.userRating })),
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Get Skill by ID — MUST be after /marketplace ─────────────────────────────

router.get('/:skillId', authenticateToken, (req: Request, res: Response) => {
  try {
    const skill = skillsSystem.getSkill(String(req.params.skillId));
    if (!skill) {
      res.status(404).json({ success: false, error: `Skill not found: ${req.params.skillId}` });
      return;
    }
    res.json({ success: true, data: skill });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Activate Skills for Context ──────────────────────────────────────────────

router.post('/activate', authenticateToken, requireRole('developer', 'org_admin'), (req: Request, res: Response) => {
  try {
    const result = ActivateSkillsSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: result.error.errors });
      return;
    }
    const context = {
      ...result.data,
      userId: result.data.userId || userId(req),
      agentId: result.data.agentId ?? 'default-agent',
      jurisdiction: result.data.jurisdiction ?? 'IN',
      practiceArea: result.data.practiceArea ?? 'general',
      tier: result.data.tier ?? 'pro',
      taskType: result.data.taskType ?? 'general',
    };
    const activation = skillsSystem.activateSkillsForContext(context);
    logger.info('[Skills] Skills activated', {
      agentId: context.agentId,
      activatedCount: activation.activatedSkills.length,
      user: userId(req),
    });
    res.json({
      success: true,
      data: {
        activatedSkills: activation.activatedSkills.map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          tier: s.tier,
          romaLevel: s.romaLevel,
        })),
        composedPromptDelta: activation.composedPromptDelta,
        requiredTools: activation.requiredTools,
        slmBinding: activation.slmBinding,
        estimatedQualityBoost: activation.estimatedQualityBoost,
        activatedCount: activation.activatedSkills.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Register Custom Skill ────────────────────────────────────────────────────

router.post('/register', authenticateToken, requireRole('org_admin'), (req: Request, res: Response) => {
  try {
    const result = RegisterSkillSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: result.error.errors });
      return;
    }

    const existing = skillsSystem.getSkill(result.data.id);
    if (existing) {
      res.status(409).json({ success: false, error: `Skill with ID '${result.data.id}' already exists` });
      return;
    }

    const skill = skillsSystem.registerSkill(result.data as any);
    logger.info('[Skills] Custom skill registered', { id: skill.id, author: skill.author, user: userId(req) });
    res.status(201).json({
      success: true,
      data: skill,
      message: `Skill '${skill.name}' registered successfully`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Record Skill Performance ──────────────────────────────────────────────────

router.post('/record-performance', authenticateToken, (req: Request, res: Response) => {
  try {
    const result = RecordPerformanceSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: result.error.errors });
      return;
    }
    const { skillId, jurisdiction, qualityScore, responseTimeMs, success } = result.data;
    const skill = skillsSystem.getSkill(skillId);
    if (!skill) {
      res.status(404).json({ success: false, error: `Skill not found: ${skillId}` });
      return;
    }
    skillsSystem.recordSkillPerformance(skillId, jurisdiction, qualityScore, responseTimeMs, success);
    res.json({ success: true, message: 'Performance recorded', skillId });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Skill Categories ─────────────────────────────────────────────────────────

router.get('/meta/categories', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      categories: [
        { id: 'legal-research', name: 'Legal Research', description: 'Case law retrieval, statute interpretation' },
        { id: 'document-drafting', name: 'Document Drafting', description: 'Contract, pleading, notice generation' },
        { id: 'compliance-checking', name: 'Compliance Checking', description: 'Jurisdiction-specific compliance rules' },
        { id: 'negotiation', name: 'Negotiation', description: 'Settlement, mediation, arbitration guidance' },
        { id: 'litigation', name: 'Litigation', description: 'Court procedure, evidence, trial strategy' },
        { id: 'advisory', name: 'Advisory', description: 'Client counselling, risk assessment' },
        { id: 'regulatory', name: 'Regulatory', description: 'Filing, compliance, reporting' },
        { id: 'tax', name: 'Tax', description: 'GST, Income Tax, Customs, International Tax' },
        { id: 'ip-patent', name: 'IP & Patent', description: 'Trademarks, patents, copyright, trade secrets' },
        { id: 'corporate-governance', name: 'Corporate Governance', description: 'Board matters, SEBI, Companies Act' },
        { id: 'criminal-defense', name: 'Criminal Defense', description: 'BNS 2023, BNSS 2023, bail, evidence, trial strategy' },
        { id: 'family-law', name: 'Family Law', description: 'Divorce, custody, maintenance, adoption' },
        { id: 'real-estate', name: 'Real Estate', description: 'Property, RERA, title, conveyancing' },
        { id: 'arbitration', name: 'Arbitration', description: 'SIAC, ICC, UNCITRAL, domestic arbitration' },
        { id: 'cross-border', name: 'Cross-Border', description: 'Multi-jurisdiction, international trade, treaties' },
      ],
      tiers: [
        { id: 'basic', name: 'Basic', description: 'Essential skills, free tier' },
        { id: 'professional', name: 'Professional', description: 'Advanced skills, Pro/Enterprise' },
        { id: 'expert', name: 'Expert', description: 'Specialist skills, Enterprise only' },
        { id: 'sovereign', name: 'Sovereign', description: 'Government/Ministry grade, JRX-MIN only' },
      ],
    },
  });
});

// ─── Skill Statistics ─────────────────────────────────────────────────────────

router.get('/meta/stats', authenticateToken, (_req: Request, res: Response) => {
  try {
    const all = skillsSystem.getSkills();
    const byCategory = all.reduce((acc, s) => {
      acc[s.category] = (acc[s.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const byTier = all.reduce((acc, s) => {
      acc[s.tier] = (acc[s.tier] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const totalUsage = all.reduce((sum, s) => sum + s.metrics.usageCount, 0);
    const avgQuality = all.length > 0
      ? all.reduce((sum, s) => sum + s.metrics.averageQualityScore, 0) / all.length
      : 0;

    res.json({
      success: true,
      data: {
        totalSkills: all.length,
        publicSkills: all.filter(s => s.isPublic).length,
        coreSkills: all.filter(s => s.author === 'jurexio-core').length,
        customSkills: all.filter(s => s.author !== 'jurexio-core').length,
        totalUsage,
        avgQualityScore: Math.round(avgQuality * 10) / 10,
        byCategory,
        byTier,
        topSkills: all
          .sort((a, b) => b.metrics.usageCount - a.metrics.usageCount)
          .slice(0, 10)
          .map(s => ({ id: s.id, name: s.name, usageCount: s.metrics.usageCount, avgQuality: Math.round(s.metrics.averageQualityScore) })),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

export default router;
