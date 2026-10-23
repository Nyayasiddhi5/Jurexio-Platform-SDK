// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * SkillShop™ REST Routes — /api/jrx/skillshop/*
 * Legal Skills Marketplace | Jurexio Enterprise Platform 312
 *
 * ENDPOINTS:
 *   GET    /skills                   List/search skill catalogue
 *   GET    /skills/:skillId          Get skill detail
 *   POST   /skills/:skillId/install  Install skill for org
 *   DELETE /skills/:skillId/install  Uninstall skill
 *   GET    /installed                List installed skills for org
 *   GET    /categories               List skill categories
 *   GET    /stats                    Service stats
 *   POST   /publish                  Submit skill for review (publisher)
 *   GET    /publisher/:publisherId   Publisher profile + published skills
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import logger from '../utils/logger.js';

const router = Router();
router.use(authenticateToken as any);

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type SkillTier = 'free' | 'pro' | 'enterprise';
type SkillStatus = 'active' | 'pending_review' | 'deprecated';

interface Skill {
  skillId: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  version: string;
  tier: SkillTier;
  price?: number;
  publisher: { name: string; verified: boolean; badge?: string };
  rating: number;
  reviewCount: number;
  installCount: number;
  tags: string[];
  compatiblePatterns: string[];
  jurisdictions: string[];
  isFeatured?: boolean;
  isNew?: boolean;
  lastUpdated: string;
  status: SkillStatus;
  changelog?: string;
  docsUrl?: string;
}

interface InstalledSkill {
  installId: string;
  orgId: string;
  skillId: string;
  skillName: string;
  version: string;
  installedAt: string;
  installedBy: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STORE (production: replace with DB table nv_schema.nv_skillshop_*)
// ─────────────────────────────────────────────────────────────────────────────

const SKILL_CATALOGUE: Skill[] = [
  { skillId: 'sk-legal-research-pro', name: 'Legal Research Pro', tagline: 'AI-powered case law research across 6 jurisdictions', description: 'Deep-search over Supreme Court, High Court, tribunal and foreign court databases using semantic vector search. Auto-citations, relevance scoring, and PDF export.', category: 'Research', version: '2.1.0', tier: 'pro', price: 1299, publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.8, reviewCount: 312, installCount: 4820, tags: ['case-law', 'citations', 'semantic-search'], compatiblePatterns: ['P01', 'P03', 'P12'], jurisdictions: ['IN', 'UK', 'US', 'EU', 'SG', 'GC'], isFeatured: true, lastUpdated: '2025-04-01', status: 'active', docsUrl: 'https://docs.jurexio.com/skills/legal-research-pro' },
  { skillId: 'sk-contract-drafter', name: 'Contract Drafter AI', tagline: 'Generate jurisdiction-compliant contracts in seconds', description: 'Templates for 200+ contract types: NDA, MSA, Employment, Lease, SPA, SHA, Term Sheet, and more. Auto-fills boilerplate, highlights negotiation points.', category: 'Drafting', version: '3.0.2', tier: 'pro', price: 999, publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.7, reviewCount: 248, installCount: 3940, tags: ['contracts', 'templates', 'drafting'], compatiblePatterns: ['P02', 'P05', 'P11'], jurisdictions: ['IN', 'UK', 'US'], isFeatured: true, lastUpdated: '2025-03-28', status: 'active' },
  { skillId: 'sk-dpdpa-compliance', name: 'DPDPA Compliance Suite', tagline: 'End-to-end DPDPA 2023 & GDPR compliance toolkit', description: 'Privacy notices, consent management, DPIA templates, breach notification workflows, and real-time compliance scoring for Indian data protection law.', category: 'Compliance', version: '1.4.1', tier: 'enterprise', price: 2499, publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.9, reviewCount: 187, installCount: 1820, tags: ['dpdpa', 'gdpr', 'privacy', 'data-protection'], compatiblePatterns: ['P06', 'P07', 'P18'], jurisdictions: ['IN', 'EU'], isFeatured: true, lastUpdated: '2025-04-02', status: 'active' },
  { skillId: 'sk-court-filing-assistant', name: 'Court Filing Assistant', tagline: 'Prepare, validate and track eCourt filings', description: 'Integrates with eCourts API. Generates cause lists, validates pleading format, tracks filing deadlines, and sends court date reminders.', category: 'Litigation', version: '2.3.0', tier: 'pro', price: 1599, publisher: { name: 'LexTech India', verified: true }, rating: 4.6, reviewCount: 142, installCount: 2380, tags: ['ecourts', 'filings', 'deadlines'], compatiblePatterns: ['P09', 'P13'], jurisdictions: ['IN'], lastUpdated: '2025-03-15', status: 'active' },
  { skillId: 'sk-gst-legal-analyzer', name: 'GST Legal Analyzer', tagline: 'GST disputes, notices, and advisory — AI-powered', description: 'Analyze GST show-cause notices, draft replies, check ITC eligibility, identify classification errors, and generate GST audit reports.', category: 'Compliance', version: '1.8.0', tier: 'pro', price: 1199, publisher: { name: 'TaxLegal AI', verified: true }, rating: 4.7, reviewCount: 203, installCount: 3120, tags: ['gst', 'taxation', 'notices', 'itc'], compatiblePatterns: ['P07', 'P18', 'P22'], jurisdictions: ['IN'], isNew: false, lastUpdated: '2025-03-20', status: 'active' },
  { skillId: 'sk-arbitration-toolkit', name: 'Arbitration Toolkit', tagline: 'Complete international arbitration practice support', description: 'Clause drafting, institution selector (SIAC/LCIA/ICC/DIAC/MCIA), award analysis, enforcement strategy, and timeline prediction for arbitration matters.', category: 'Litigation', version: '1.5.0', tier: 'enterprise', price: 2999, publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.8, reviewCount: 98, installCount: 1040, tags: ['arbitration', 'siac', 'lcia', 'icc', 'enforcement'], compatiblePatterns: ['P10', 'P13', 'P16'], jurisdictions: ['IN', 'UK', 'SG', 'GC'], lastUpdated: '2025-03-10', status: 'active' },
  { skillId: 'sk-ip-watch', name: 'IP Watch & Strategy', tagline: 'Trademark, patent, copyright — protect your IP', description: 'Prior art search, trademark clearance, patent claims drafting, copyright registration guidance, and IP portfolio management for Indian and international filings.', category: 'Corporate', version: '2.0.1', tier: 'pro', price: 1399, publisher: { name: 'IPLegal Tech', verified: false }, rating: 4.5, reviewCount: 164, installCount: 2640, tags: ['trademark', 'patent', 'copyright', 'ip'], compatiblePatterns: ['P11', 'P12'], jurisdictions: ['IN', 'US', 'EU'], lastUpdated: '2025-02-28', status: 'active' },
  { skillId: 'sk-voice-legal-assistant', name: 'Voice Legal Assistant', tagline: 'Multilingual voice interface for legal queries in 22 Indian languages', description: 'Powered by Sarvam AI. Supports Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Odia, Punjabi, Urdu, and 11 more Indian languages.', category: 'Voice', version: '1.2.0', tier: 'pro', price: 799, publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.6, reviewCount: 219, installCount: 3720, tags: ['voice', 'multilingual', 'sarvam', 'indic-languages'], compatiblePatterns: ['P08', 'P20'], jurisdictions: ['IN'], isNew: true, lastUpdated: '2025-04-01', status: 'active' },
  { skillId: 'sk-legal-analytics-dashboard', name: 'Legal Analytics Dashboard', tagline: 'Matter KPIs, team performance, and cost analytics', description: 'Visualise matter status, billable hours, outcome rates, client satisfaction scores, and cost-to-outcome ratios. Integrates with HRMS and billing systems.', category: 'Analytics', version: '1.3.0', tier: 'enterprise', price: 3499, publisher: { name: 'LexMetrics', verified: true }, rating: 4.7, reviewCount: 76, installCount: 820, tags: ['analytics', 'dashboards', 'kpi', 'billing'], compatiblePatterns: ['P04', 'P21'], jurisdictions: ['IN', 'UK', 'US', 'EU', 'SG', 'GC'], lastUpdated: '2025-03-05', status: 'active' },
  { skillId: 'sk-free-statute-lookup', name: 'Statute Lookup (Free)', tagline: 'Free instant access to Indian statutes and bare acts', description: 'Searches India Code, IndKanoon, and official gazette for statutes, rules, regulations, and notifications. Free tier — no API key required.', category: 'Research', version: '1.0.4', tier: 'free', publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.4, reviewCount: 521, installCount: 12400, tags: ['statutes', 'bare-acts', 'india-code', 'free'], compatiblePatterns: ['P01', 'P03'], jurisdictions: ['IN'], lastUpdated: '2025-04-01', status: 'active' },
  { skillId: 'sk-due-diligence-pro', name: 'Due Diligence Pro', tagline: 'M&A, PE, and debt due diligence automation', description: 'Automated red-flag identification in VDR documents, legal risk matrix generation, MCA21 corporate registry lookup, and DD report drafting.', category: 'Corporate', version: '2.2.0', tier: 'enterprise', price: 4999, publisher: { name: 'CorpLegal AI', verified: true }, rating: 4.9, reviewCount: 52, installCount: 640, tags: ['due-diligence', 'ma', 'corporate', 'vdr', 'mca21'], compatiblePatterns: ['P02', 'P06', 'P17'], jurisdictions: ['IN', 'UK', 'SG'], isFeatured: true, lastUpdated: '2025-03-25', status: 'active' },
  { skillId: 'sk-employment-law-kit', name: 'Employment Law Kit', tagline: 'HR-legal compliance: contracts, policies, disputes', description: 'Model employment agreements, POSH policy templates, termination letter generator, Labour Code compliance checker, and dismissal risk analyser.', category: 'Compliance', version: '1.6.0', tier: 'pro', price: 899, publisher: { name: 'HRLegal India', verified: false }, rating: 4.3, reviewCount: 187, installCount: 2180, tags: ['employment', 'posh', 'labour-code', 'hr'], compatiblePatterns: ['P07', 'P11'], jurisdictions: ['IN'], lastUpdated: '2025-02-15', status: 'active' },
  { skillId: 'sk-jurisdiction-routing', name: 'Jurisdiction Router', tagline: 'Automatic jurisdiction detection and forum selection', description: 'Analyses parties, governing law, and dispute type to recommend optimal jurisdiction and court. Flags choice-of-law issues and cross-border enforcement complexity.', category: 'Jurisdiction', version: '2.0.0', tier: 'pro', price: 699, publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.6, reviewCount: 134, installCount: 1980, tags: ['jurisdiction', 'forum-selection', 'governing-law'], compatiblePatterns: ['P05', 'P10'], jurisdictions: ['IN', 'UK', 'US', 'EU', 'SG', 'GC'], isNew: true, lastUpdated: '2025-04-03', status: 'active' },
  { skillId: 'sk-api-integration-hub', name: 'API Integration Hub', tagline: 'Connect legal databases, court APIs, and enterprise systems', description: 'Pre-built connectors for IndKanoon, eCourts, MCA21, SEBI EDGAR, GSTN, Tally, SAP, and Salesforce. One-click OAuth and API key management.', category: 'Integration', version: '1.1.0', tier: 'enterprise', price: 5999, publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.8, reviewCount: 41, installCount: 520, tags: ['api', 'integrations', 'ecourts', 'mca21', 'gstn'], compatiblePatterns: ['P01', 'P07', 'P18', 'P22'], jurisdictions: ['IN', 'UK', 'US', 'EU', 'SG', 'GC'], lastUpdated: '2025-03-30', status: 'active' },
  { skillId: 'sk-real-estate-legal', name: 'Real Estate Legal Suite', tagline: 'RERA compliance, title search, and property contracts', description: 'RERA registration verification, title due diligence checklist, sale deed and lease deed generator, stamp duty calculator (all Indian states), and property registration guidance.', category: 'Jurisdiction', version: '1.4.0', tier: 'pro', price: 1099, publisher: { name: 'PropLegal India', verified: false }, rating: 4.4, reviewCount: 223, installCount: 2920, tags: ['rera', 'property', 'title', 'stamp-duty'], compatiblePatterns: ['P11', 'P05'], jurisdictions: ['IN'], lastUpdated: '2025-02-20', status: 'active' },
  { skillId: 'sk-startup-legal-pack', name: 'Startup Legal Pack', tagline: 'Everything a startup needs from incorporation to funding', description: 'Incorporation documents, founder agreements, ESOP policy, term sheet review, SAFE/CCPS templates, SEBI AIF compliance, and investor rights checklist.', category: 'Corporate', version: '2.1.0', tier: 'free', publisher: { name: 'Jurexio Labs', verified: true, badge: 'Official' }, rating: 4.7, reviewCount: 445, installCount: 8760, tags: ['startup', 'esop', 'funding', 'incorporation', 'free'], compatiblePatterns: ['P02', 'P06', 'P11', 'P17'], jurisdictions: ['IN', 'SG', 'US'], isNew: true, lastUpdated: '2025-04-04', status: 'active' },
];

const installStore = new Map<string, InstalledSkill[]>();

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getOrgId(req: Request): string {
  const user = req.user as any;
  return String(user?.orgId ?? user?.org_id ?? '1');
}

function getOrgInstalls(orgId: string): InstalledSkill[] {
  return installStore.get(orgId) ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── LIST SKILLS ───────────────────────────────────────────────────────────────
router.get('/skills', (req: Request, res: Response) => {
  try {
    const { q, category, tier, jurisdiction, sort, page, limit: limitQ } = req.query;
    let skills = [...SKILL_CATALOGUE];

    if (q) {
      const term = String(q).toLowerCase();
      skills = skills.filter(s =>
        s.name.toLowerCase().includes(term) ||
        s.tagline.toLowerCase().includes(term) ||
        s.tags.some(t => t.includes(term)) ||
        s.category.toLowerCase().includes(term)
      );
    }
    if (category) skills = skills.filter(s => s.category === String(category));
    if (tier) skills = skills.filter(s => s.tier === String(tier));
    if (jurisdiction) skills = skills.filter(s => s.jurisdictions.includes(String(jurisdiction)));

    if (sort === 'rating') skills.sort((a, b) => b.rating - a.rating);
    else if (sort === 'installs') skills.sort((a, b) => b.installCount - a.installCount);
    else if (sort === 'newest') skills.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
    else if (sort === 'price_asc') skills.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    else if (sort === 'price_desc') skills.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));

    const pageNum = parseInt(String(page ?? '1'), 10);
    const pageSize = Math.min(parseInt(String(limitQ ?? '20'), 10), 100);
    const total = skills.length;
    const paginated = skills.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    const orgInstalls = getOrgInstalls(getOrgId(req));
    const installedIds = new Set(orgInstalls.filter(i => i.enabled).map(i => i.skillId));
    const enriched = paginated.map(s => ({ ...s, isInstalled: installedIds.has(s.skillId) }));

    res.json({ success: true, skills: enriched, total, page: pageNum, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── GET SKILL ─────────────────────────────────────────────────────────────────
router.get('/skills/:skillId', (req: Request, res: Response) => {
  const skill = SKILL_CATALOGUE.find(s => s.skillId === req.params.skillId);
  if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  const installed = getOrgInstalls(getOrgId(req)).find(i => i.skillId === req.params.skillId && i.enabled);
  res.json({ success: true, skill: { ...skill, isInstalled: !!installed, installInfo: installed ?? null } });
});

// ── INSTALL SKILL ─────────────────────────────────────────────────────────────
router.post('/skills/:skillId/install', async (req: Request, res: Response) => {
  try {
    const { skillId } = req.params;
    const skill = SKILL_CATALOGUE.find(s => s.skillId === skillId);
    if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
    if (skill.status !== 'active') { res.status(409).json({ success: false, error: `Skill is ${skill.status} and cannot be installed` }); return; }

    const orgId = getOrgId(req);
    const userId = String((req.user as any)?.userId ?? (req.user as any)?.id ?? 'unknown');

    const installs = getOrgInstalls(orgId);
    const existing = installs.find(i => i.skillId === skillId);
    if (existing?.enabled) { res.status(409).json({ success: false, error: 'Skill already installed' }); return; }

    const schema = z.object({ config: z.record(z.unknown()).optional() });
    const input = schema.parse(req.body);

    const installRecord: InstalledSkill = {
      installId: `INSTALL-${crypto.randomUUID().substring(0, 8)}`,
      orgId,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      skillId,
      skillName: skill.name,
      version: skill.version,
      installedAt: new Date().toISOString(),
      installedBy: userId,
      enabled: true,
      config: input.config ?? {},
    };

    installs.push(installRecord);
    installStore.set(orgId, installs);

    logger.info('[SkillShop] Skill installed', { orgId, skillId, skillName: skill.name, installId: installRecord.installId });

    res.status(201).json({ success: true, install: installRecord, message: `${skill.name} installed successfully` });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── UNINSTALL SKILL ───────────────────────────────────────────────────────────
router.delete('/skills/:skillId/install', (req: Request, res: Response) => {
  const { skillId } = req.params;
  const orgId = getOrgId(req);
  const installs = getOrgInstalls(orgId);
  const idx = installs.findIndex(i => i.skillId === skillId && i.enabled);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Skill not installed' }); return; }
  installs[idx].enabled = false;
  installStore.set(orgId, installs);
  logger.info('[SkillShop] Skill uninstalled', { orgId, skillId });
  res.json({ success: true, message: 'Skill uninstalled successfully' });
});

// ── LIST INSTALLED ────────────────────────────────────────────────────────────
router.get('/installed', (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const installs = getOrgInstalls(orgId).filter(i => i.enabled);
  const enriched = installs.map(i => ({
    ...i,
    skill: SKILL_CATALOGUE.find(s => s.skillId === i.skillId) ?? null,
  }));
  res.json({ success: true, installed: enriched, total: enriched.length });
});

// ── CATEGORIES ────────────────────────────────────────────────────────────────
router.get('/categories', (_req: Request, res: Response) => {
  const counts = SKILL_CATALOGUE.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + 1;
    return acc;
  }, {});
  const categories = Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  res.json({ success: true, categories, total: categories.length });
});

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/stats', (_req: Request, res: Response) => {
  const totalInstalls = SKILL_CATALOGUE.reduce((s, k) => s + k.installCount, 0);
  const avgRating = Math.round(SKILL_CATALOGUE.reduce((s, k) => s + k.rating, 0) / SKILL_CATALOGUE.length * 10) / 10;
  const byTier = SKILL_CATALOGUE.reduce<Record<string, number>>((acc, s) => { acc[s.tier] = (acc[s.tier] ?? 0) + 1; return acc; }, {});
  res.json({
    success: true,
    stats: {
      totalSkills: SKILL_CATALOGUE.length,
      totalInstalls,
      avgRating,
      activeSkills: SKILL_CATALOGUE.filter(s => s.status === 'active').length,
      featuredSkills: SKILL_CATALOGUE.filter(s => s.isFeatured).length,
      newSkills: SKILL_CATALOGUE.filter(s => s.isNew).length,
      byTier,
      publishers: 8,
      verifiedPublishers: 5,
    },
  });
});

// ── PUBLISH SKILL (Submit for Review) ─────────────────────────────────────────
router.post('/publish', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(3).max(80),
      tagline: z.string().min(10).max(160),
      description: z.string().min(50).max(2000),
      category: z.enum(['Research', 'Drafting', 'Compliance', 'Litigation', 'Corporate', 'Voice', 'Analytics', 'Jurisdiction', 'Integration']),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      tier: z.enum(['free', 'pro', 'enterprise']),
      price: z.number().int().min(0).optional(),
      tags: z.array(z.string().max(30)).max(10).optional(),
      compatiblePatterns: z.array(z.string()).max(10).optional(),
      jurisdictions: z.array(z.enum(['IN', 'UK', 'US', 'EU', 'SG', 'GC'])).min(1),
      repoUrl: z.string().url().optional(),
      docsUrl: z.string().url().optional(),
    });
    const input = schema.parse(req.body);
    const user = req.user as any;
    const submissionId = `SKILL-SUBMIT-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

    logger.info('[SkillShop] Skill submission received', { submissionId, name: input.name, tier: input.tier, publisher: user?.email });

    res.status(202).json({
      success: true,
      submissionId,
      message: 'Skill submitted for review. Our team will evaluate within 3–5 business days.',
      status: 'pending_review',
      estimatedReviewDate: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
      guidelines: 'https://docs.jurexio.com/skillshop/publisher-guidelines',
    });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── PUBLISHER PROFILE ─────────────────────────────────────────────────────────
router.get('/publisher/:publisherName', (req: Request, res: Response) => {
  const publisherName = decodeURIComponent(String(req.params.publisherName));
  const publishedSkills = SKILL_CATALOGUE.filter(s => s.publisher.name === publisherName);
  if (!publishedSkills.length) { res.status(404).json({ success: false, error: 'Publisher not found' }); return; }
  const pub = publishedSkills[0].publisher;
  const totalInstalls = publishedSkills.reduce((s, k) => s + k.installCount, 0);
  const avgRating = Math.round(publishedSkills.reduce((s, k) => s + k.rating, 0) / publishedSkills.length * 10) / 10;
  res.json({
    success: true,
    publisher: {
      name: pub.name,
      verified: pub.verified,
      badge: pub.badge,
      totalSkills: publishedSkills.length,
      totalInstalls,
      avgRating,
      skills: publishedSkills,
    },
  });
});

export default router;
