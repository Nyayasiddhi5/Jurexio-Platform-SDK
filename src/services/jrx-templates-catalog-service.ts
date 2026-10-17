/**
 * NV-TEMPLATES-CATALOG-001 — Canonical legal templates catalog for NSP / ecosystem.
 *
 * Serves the MVP contract expected by Jurexio Professional platforms:
 *   GET /api/jrx/templates → { data: { templates: [{ id, name, content, ... }] } }
 *
 * Sources (merged, deduped by id):
 *   1. In-process Indian document templates (fields + body)
 *   2. NYS seed JSON packs (practice-area drafts/checklists) when present on disk
 *   3. Generated simple/medium fillers for any IN practice area still thin
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import {
  documentTemplatesService,
  type DocumentTemplate,
} from './nyayavigya-document-templates-service.js';
import {
  bootstrapPlatformCurated,
  enrichTemplateWithReview,
  isPartnerApproved,
  reviewStats,
  type TemplateApprovalStatus,
} from './jrx-templates-sme-review-service.js';
import { resolveTemplateDocumentTypeKey } from '../config/jrx-template-doctype-map.js';
import type { DraftDocumentType } from '../config/jrx-draft-length-registry.js';

const logger = createLogger('./jrx-templates-catalog');

export type TemplateComplexity = 'simple' | 'medium' | 'advanced';

export interface NspTemplateVariable {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  label?: string;
  defaultValue?: string;
  choices?: string[];
}

/** NSP / ecosystem canonical template item. */
export interface NspLegalTemplate {
  id: string;
  name: string;
  title?: string;
  slug?: string;
  content: string;
  body?: string;
  markdown?: string;
  template?: string;
  description: string;
  document_type: string;
  category?: string;
  jurisdiction_code: string;
  tags: string[];
  variables: NspTemplateVariable[];
  version: string;
  complexity: TemplateComplexity;
  external_id?: string;
  source: 'nyv-document' | 'nys-seed' | 'nyv-generated';
  /** Partner DraftDocumentType registry key when slug/title is mappable (NV-TEMPLATE-DOCTYPE-MAP-001). */
  documentTypeKey?: DraftDocumentType;
}

export interface TemplatesCatalogQuery {
  jurisdiction?: string;
  category?: string;
  document_type?: string;
  complexity?: TemplateComplexity | string;
  q?: string;
  kind?: string;
  /** Partner default is comprehensive IN-only (medium+). Pass true to include simple/generated. */
  includeSimple?: boolean;
  includeGenerated?: boolean;
  /** Escape hatch: include non-IN rows (US seeds). Default false for ecosystem partners. */
  includeNonIndia?: boolean;
  /**
   * Default true for partner catalog — only platform_curated + sme_approved.
   * Pass false to include unreviewed comprehensive drafts (SME queue context).
   */
  approvedOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** Minimum body length for partner “comprehensive” catalog (chars). Aligns with medium complexity floor. */
const PARTNER_MIN_CONTENT_CHARS = 1200;

const IN_PRACTICE_AREAS = [
  'civil',
  'criminal',
  'constitutional',
  'corporate',
  'commercial',
  'litigation',
  'arbitration',
  'family',
  'employment',
  'property',
  'compliance',
  'consumer',
  'banking',
  'insolvency',
  'privacy',
  'ip',
  'estate',
] as const;

let cached: NspLegalTemplate[] | null = null;

function normalizeJurisdiction(raw?: string): string {
  const j = String(raw || 'IN').trim().toUpperCase();
  if (j === 'INDIA' || j === 'INDIAN') return 'IN';
  if (j === 'GCC') return 'GC';
  return j || 'IN';
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function mapDocFields(t: DocumentTemplate): NspTemplateVariable[] {
  return (t.fields || []).map((f) => ({
    name: f.id,
    type: f.type,
    required: !!f.required,
    description: f.label,
    label: f.label,
    defaultValue: f.defaultValue,
    choices: f.options,
  }));
}

function complexityFromContent(content: string, tags: string[]): TemplateComplexity {
  if (tags.includes('simple') || tags.includes('complexity:simple')) return 'simple';
  if (tags.includes('medium') || tags.includes('complexity:medium')) return 'medium';
  if (tags.includes('advanced') || tags.includes('complexity:advanced')) return 'advanced';
  const len = content.length;
  if (len < 1200) return 'simple';
  if (len < 4500) return 'medium';
  return 'advanced';
}

function attachDocumentTypeKey(row: NspLegalTemplate): NspLegalTemplate {
  const key = resolveTemplateDocumentTypeKey({
    slug: row.slug,
    name: row.name,
    title: row.title,
    category: row.category,
    document_type: row.document_type,
    tags: row.tags,
  });
  return key ? { ...row, documentTypeKey: key } : row;
}

function fromDocumentTemplate(t: DocumentTemplate): NspLegalTemplate {
  const content = t.template || '';
  const tags = [
    'IN',
    t.category,
    t.subcategory || '',
    `complexity:${complexityFromContent(content, [])}`,
  ].filter(Boolean);
  const complexity = complexityFromContent(content, tags);
  const slug = slugify(t.id || t.name);
  return attachDocumentTypeKey({
    id: t.id,
    external_id: t.id,
    name: t.name,
    title: t.name,
    slug,
    content,
    body: content,
    markdown: content,
    template: content,
    description: t.description,
    document_type: t.category,
    category: t.category,
    jurisdiction_code: normalizeJurisdiction(t.jurisdiction),
    tags,
    variables: mapDocFields(t),
    version: t.version || '1.0.0',
    complexity,
    source: 'nyv-document',
  });
}

function finalizeTemplate(row: NspLegalTemplate): NspLegalTemplate {
  return attachDocumentTypeKey(row);
}

interface NysSeedRow {
  kind?: string;
  slug?: string;
  title?: string;
  category?: string;
  jurisdiction?: string;
  description?: string;
  tags?: string[];
  body?: string;
}

function fromNysSeed(row: NysSeedRow): NspLegalTemplate | null {
  const content = String(row.body || '').trim();
  if (!content || content.length < 40) return null;
  const id = `nys-${row.slug || slugify(row.title || 'template')}`;
  const name = String(row.title || row.slug || id);
  const tags = [
    ...(Array.isArray(row.tags) ? row.tags : []),
    row.kind || 'template',
    row.category || '',
  ].filter(Boolean);
  const complexity = complexityFromContent(content, tags);
  return finalizeTemplate({
    id,
    external_id: id,
    name,
    title: name,
    slug: row.slug || slugify(name),
    content,
    body: content,
    markdown: content,
    template: content,
    description: String(row.description || name),
    document_type: String(row.category || 'general'),
    category: String(row.category || 'general'),
    jurisdiction_code: normalizeJurisdiction(row.jurisdiction),
    tags,
    variables: extractPlaceholders(content),
    version: '1.0.0',
    complexity,
    source: 'nys-seed',
  });
}

function extractPlaceholders(content: string): NspTemplateVariable[] {
  const found = new Set<string>();
  const re = /\[([A-Z][A-Z0-9_ /-]{1,60})\]|\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const raw = (m[2] || m[1] || '').trim();
    if (!raw) continue;
    const name = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (name.length < 2 || name.length > 48) continue;
    found.add(name);
  }
  return [...found].slice(0, 40).map((name) => ({
    name,
    type: 'text',
    required: false,
    description: name.replace(/_/g, ' '),
    label: name.replace(/_/g, ' '),
  }));
}

function resolveNysSeedDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled with gateway image (NV-TEMPLATES-API-001) — preferred for EC2
    path.resolve(here, '../data/jrx-legal-templates'),
    path.resolve(process.cwd(), 'src/data/jrx-legal-templates'),
    path.resolve(process.cwd(), 'dist/data/jrx-legal-templates'),
    // Monorepo / local NYS tree
    path.resolve(here, '../../jrx-search/artifacts/api-server/data'),
    path.resolve(process.cwd(), 'jrx-search/artifacts/api-server/data'),
    path.resolve(process.cwd(), '../jrx-search/artifacts/api-server/data'),
  ];
  return candidates.filter((d) => {
    try {
      return fs.existsSync(d);
    } catch {
      return false;
    }
  });
}

function isIndiaSeedFile(file: string): boolean {
  const f = file.toLowerCase();
  // Explicit US packs are never loaded for the partner catalog.
  if (f.includes('-us-') || f.includes('_us_') || f.includes('us-catalog') || f.includes('us-expansion') || f.includes('us-filing')) {
    return false;
  }
  return true;
}

/** Multi-domain scaffold templates (GLOBAL) — finance / healthcare / general ops. */
function loadDomainPackTemplates(): NspLegalTemplate[] {
  const out: NspLegalTemplate[] = [];
  for (const dir of resolveNysSeedDirs()) {
    const file = 'seed-templates-domain-packs-2026-07.json';
    const abs = path.join(dir, file);
    if (!fs.existsSync(abs)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(abs, 'utf8')) as Array<Record<string, unknown>>;
      if (!Array.isArray(raw)) continue;
      for (const row of raw) {
        const id = String(row.id || '');
        const content = String(row.content || row.body || '');
        if (!id || content.length < 400) continue;
        out.push({
          id,
          name: String(row.title || id),
          title: String(row.title || id),
          content,
          body: content,
          description: String(row.title || id),
          document_type: String(row.document_type || row.category || 'general'),
          category: String(row.category || 'general'),
          jurisdiction_code: String(row.jurisdiction_code || 'GLOBAL').toUpperCase(),
          tags: [String(row.category || 'general'), 'domain-pack', String(row.jurisdiction_code || 'GLOBAL')],
          variables: [],
          version: '2026.07',
          complexity: content.length >= 1200 ? 'medium' : 'simple',
          source: 'nyv-document',
        });
      }
      logger.info('loaded multi-domain template pack', { dir, count: out.length });
      break;
    } catch (err) {
      logger.warn('failed to load domain pack templates', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

function isDomainPackComprehensive(t: NspLegalTemplate): boolean {
  if (!t.id.startsWith('domain-')) return false;
  if (t.source === 'nyv-generated') return false;
  return (t.content || '').length >= 800;
}

function loadNysSeeds(): NspLegalTemplate[] {
  const out: NspLegalTemplate[] = [];
  for (const dir of resolveNysSeedDirs()) {
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith('seed-templates') && f.endsWith('.json') && isIndiaSeedFile(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as NysSeedRow[];
        if (!Array.isArray(raw)) continue;
        for (const row of raw) {
          if (row.kind && row.kind !== 'template' && row.kind !== 'checklist') continue;
          const mapped = fromNysSeed(row);
          // India-only at load time (seed-templates.json may still contain US rows).
          if (!mapped || mapped.jurisdiction_code !== 'IN') continue;
          out.push(mapped);
        }
      } catch (err) {
        logger.warn('failed to load NYS template seed', {
          file,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (out.length) {
      logger.info('loaded NYS template seeds (IN only)', { dir, count: out.length, files: files.length });
      break;
    }
  }
  return out;
}

/**
 * Partner ecosystem catalog: India-only, comprehensive drafts (no generated fillers,
 * no short/simple samples). These are practitioner drafting aids — NOT sealed /
 * court-certified SC/HC forms unless a future corpus carries that provenance.
 */
function isPartnerComprehensive(t: NspLegalTemplate): boolean {
  if (t.jurisdiction_code !== 'IN') return false;
  if (t.source === 'nyv-generated') return false;
  if (t.complexity === 'simple') return false;
  // Curated India document templates (FIR, vakalatnama, SC/HC petitions, etc.) always qualify when medium+.
  if (t.source === 'nyv-document') return true;
  if ((t.content || '').length < PARTNER_MIN_CONTENT_CHARS) return false;
  const blob = `${t.name} ${t.description} ${(t.tags || []).join(' ')}`.toLowerCase();
  if (/\b(sample|placeholder|lorem|demo|stub|generated)\b/.test(blob)) return false;
  return true;
}

function buildCatalog(): NspLegalTemplate[] {
  const byId = new Map<string, NspLegalTemplate>();

  for (const t of documentTemplatesService.getAllTemplates()) {
    const mapped = fromDocumentTemplate(t);
    if (mapped.jurisdiction_code === 'IN') byId.set(mapped.id, mapped);
  }

  for (const t of loadNysSeeds()) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }

  for (const t of loadDomainPackTemplates()) {
    byId.set(t.id, t);
  }

  // Do NOT inject generated simple/medium fillers into the partner catalog.
  const merged = [...byId.values()].filter((t) => isPartnerComprehensive(t) || isDomainPackComprehensive(t));

  merged.sort((a, b) => {
    const ca = a.complexity === 'advanced' ? 0 : 1;
    const cb = b.complexity === 'advanced' ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });
  logger.info('templates catalog built (IN comprehensive + domain packs)', {
    total: merged.length,
    document: merged.filter((t) => t.source === 'nyv-document').length,
    nys: merged.filter((t) => t.source === 'nys-seed').length,
    domainPacks: merged.filter((t) => t.id.startsWith('domain-')).length,
    advanced: merged.filter((t) => t.complexity === 'advanced').length,
    medium: merged.filter((t) => t.complexity === 'medium').length,
    minChars: PARTNER_MIN_CONTENT_CHARS,
  });
  return merged;
}

let bootstrapDone = false;

function ensureReviewBootstrap(): void {
  if (bootstrapDone) return;
  bootstrapDone = true;
  try {
    const all = cached || buildCatalog();
    bootstrapPlatformCurated(all, { maxSeeds: 80, perCategory: 2 });
  } catch (err) {
    logger.warn('SME review bootstrap failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function getTemplatesCatalog(forceReload = false): NspLegalTemplate[] {
  if (!cached || forceReload) {
    cached = buildCatalog();
    bootstrapDone = false;
  }
  ensureReviewBootstrap();
  return cached;
}

export type NspLegalTemplateWithReview = NspLegalTemplate & {
  approval_status: TemplateApprovalStatus;
  partner_approved: boolean;
};

export function queryTemplatesCatalog(q: TemplatesCatalogQuery = {}): {
  templates: NspLegalTemplateWithReview[];
  total: number;
  categories: string[];
} {
  const all = getTemplatesCatalog();
  const jurisdiction = q.includeNonIndia && q.jurisdiction
    ? normalizeJurisdiction(q.jurisdiction)
    : normalizeJurisdiction(q.jurisdiction || 'IN');
  const category = (q.category || q.document_type || '').toLowerCase().trim();
  const complexity = (q.complexity || '').toLowerCase().trim() as TemplateComplexity | '';
  const search = (q.q || '').toLowerCase().trim();
  const kind = (q.kind || '').toLowerCase().trim();
  const approvedOnly = q.approvedOnly !== false;

  let filtered = all.filter((t) => {
    const isDomainPack = t.id.startsWith('domain-');
    if (!q.includeNonIndia && t.jurisdiction_code !== 'IN' && !isDomainPack) return false;
    if (jurisdiction && jurisdiction !== 'ALL' && t.jurisdiction_code !== jurisdiction) {
      // Domain packs are GLOBAL — allow when caller asks for a domain category
      if (!(isDomainPack && (jurisdiction === 'GLOBAL' || category))) return false;
    }
    if (!q.includeGenerated && t.source === 'nyv-generated') return false;
    if (!q.includeSimple && t.complexity === 'simple' && !isDomainPack) return false;
    if (!q.includeSimple && t.source !== 'nyv-document' && (t.content || '').length < PARTNER_MIN_CONTENT_CHARS) {
      return false;
    }
    if (category) {
      const blob = `${t.document_type} ${t.category} ${t.tags.join(' ')}`.toLowerCase();
      if (!blob.includes(category)) return false;
    }
    if (complexity && t.complexity !== complexity) return false;
    if (kind === 'checklist' && !t.tags.includes('checklist')) return false;
    if (kind === 'template' && t.tags.includes('checklist')) return false;
    if (search) {
      const blob = `${t.name} ${t.description} ${t.document_type} ${t.content}`.toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });

  const enriched = filtered.map((t) => enrichTemplateWithReview(t));
  const forPartner = approvedOnly
    ? enriched.filter((t) => isPartnerApproved(t.approval_status))
    : enriched;

  const offset = Math.max(0, Number(q.offset) || 0);
  const limit = Math.min(2000, Math.max(1, Number(q.limit) || 500));
  const total = forPartner.length;
  const page = forPartner.slice(offset, offset + limit);

  const categories = [...new Set(all.map((t) => t.document_type).filter(Boolean))].sort();
  return { templates: page, total, categories };
}

export function getTemplateById(
  id: string,
  opts?: { indiaOnly?: boolean },
): NspLegalTemplateWithReview | null {
  const all = getTemplatesCatalog();
  const needle = String(id || '').trim();
  // NV-BNSS-EXTERNAL-ID-001: accept NSP bnss_* keys as aliases for nys-in-bnss-*
  const bnssAlias =
    /^bnss[_-]/i.test(needle)
      ? needle.replace(/^bnss[_-]/i, 'nys-in-bnss-').replace(/_/g, '-')
      : null;
  const hit = all.find(
    (t) =>
      t.id === needle
      || t.slug === needle
      || t.external_id === needle
      || (bnssAlias && (t.id === bnssAlias || t.slug === bnssAlias || t.external_id === bnssAlias))
      || (bnssAlias && t.id?.endsWith(needle.replace(/^bnss[_-]/i, '')))
      || (!!needle && t.external_id === `bnss_${needle.replace(/^nys-in-bnss-/i, '').replace(/-/g, '_')}`),
  );
  if (!hit) return null;
  if (opts?.indiaOnly && hit.jurisdiction_code !== 'IN') return null;
  const enriched = enrichTemplateWithReview(hit);
  // Dual-write external_id for NSP Route A parity when catalog id is nys-in-bnss-*
  if (enriched && /^nys-in-bnss-/i.test(enriched.id) && !/^bnss_/i.test(String(enriched.external_id || ''))) {
    const slug = enriched.id.replace(/^nys-in-bnss-/i, '').replace(/-/g, '_');
    return { ...enriched, external_id: `bnss_${slug}`, aliases: [`bnss_${slug}`, enriched.id] } as any;
  }
  return enriched;
}

export function fillTemplate(
  id: string,
  variables: Record<string, unknown>,
  opts?: { indiaOnly?: boolean },
): { content: string; template: NspLegalTemplateWithReview } | null {
  const template = getTemplateById(id, opts);
  if (!template) return null;
  let content = template.content;
  content = content.replace(/\{\{\s*current_date\s*\}\}/gi, new Date().toLocaleDateString('en-IN'));
  for (const [key, value] of Object.entries(variables || {})) {
    const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    content = content.replace(re, value == null ? '' : String(value));
  }
  content = content.replace(/\{\{[^}]+\}\}/g, '_______________');
  return { content, template };
}

export function nspCatalogEnvelope(q: TemplatesCatalogQuery = {}) {
  const { templates, total, categories } = queryTemplatesCatalog(q);
  const stats = reviewStats();
  const approvedOnly = q.approvedOnly !== false;
  return {
    success: true,
    data: {
      templates,
      total,
      categories,
      practiceAreas: [...IN_PRACTICE_AREAS],
      jurisdiction_code: 'IN',
      quality: approvedOnly ? 'approved' : 'comprehensive',
      approvedOnly,
      reviewStats: stats,
      provenance:
        'India templates with platform_curated / sme_approved status. Drafting aids for counsel — not sealed SC/HC certified forms. Counsel remains responsible for filing-ready accuracy.',
      generatedAt: new Date().toISOString(),
    },
  };
}
