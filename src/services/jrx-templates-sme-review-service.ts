/**
 * NV-TEMPLATES-SME-REVIEW-001 — SME legal-review pipeline for partner templates.
 *
 * Approval statuses:
 *   unreviewed        — in comprehensive pool, not yet reviewed
 *   platform_curated  — NYV India curated court/practice forms (pre-SME)
 *   sme_approved      — SME attested for ecosystem partners
 *   sme_rejected      — rejected (hidden from partner approved catalog)
 *   changes_requested — returned to authoring with notes
 *
 * Persistence: JSON under src/data/jrx-legal-templates/sme-reviews.json
 * (ships in gateway image; writable when process has FS access).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import type { NspLegalTemplate } from './jrx-templates-catalog-service.js';

const logger = createLogger('./jrx-templates-sme-review');

export type TemplateApprovalStatus =
  | 'unreviewed'
  | 'platform_curated'
  | 'sme_approved'
  | 'sme_rejected'
  | 'changes_requested';

export interface TemplateSmeRubric {
  legalAccuracy: number; // 0–1
  proceduralCompleteness: number;
  citationGrounding: number;
  draftingQuality: number;
  overall: number;
}

export interface TemplateSmeReviewRecord {
  templateId: string;
  status: TemplateApprovalStatus;
  reviewerId?: string;
  reviewerRole?: string;
  notes?: string;
  rubric?: TemplateSmeRubric;
  jurisdiction_code?: string;
  reviewedAt?: string;
  updatedAt: string;
  bootstrapReason?: string;
}

interface ReviewStoreFile {
  version: 1;
  updatedAt: string;
  reviews: Record<string, TemplateSmeReviewRecord>;
}

const APPROVED_STATUSES: TemplateApprovalStatus[] = ['sme_approved', 'platform_curated'];

function resolveStorePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../data/jrx-legal-templates/sme-reviews.json'),
    path.resolve(process.cwd(), 'src/data/jrx-legal-templates/sme-reviews.json'),
    path.resolve(process.cwd(), 'dist/data/jrx-legal-templates/sme-reviews.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.dirname(p))) return p;
  }
  return candidates[0];
}

let cache: ReviewStoreFile | null = null;

function emptyStore(): ReviewStoreFile {
  return { version: 1, updatedAt: new Date().toISOString(), reviews: {} };
}

function loadStore(): ReviewStoreFile {
  if (cache) return cache;
  const p = resolveStorePath();
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as ReviewStoreFile;
      if (raw?.reviews && typeof raw.reviews === 'object') {
        cache = raw;
        return cache;
      }
    }
  } catch (err) {
    logger.warn('failed to load sme-reviews.json', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  cache = emptyStore();
  return cache;
}

function persistStore(store: ReviewStoreFile): void {
  store.updatedAt = new Date().toISOString();
  cache = store;
  const p = resolveStorePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    logger.warn('sme-reviews persist failed (in-memory only)', {
      path: p,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function getReview(templateId: string): TemplateSmeReviewRecord | null {
  return loadStore().reviews[templateId] || null;
}

export function listReviews(filter?: {
  status?: TemplateApprovalStatus;
  limit?: number;
}): TemplateSmeReviewRecord[] {
  const all = Object.values(loadStore().reviews);
  let rows = all;
  if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const limit = Math.min(2000, Math.max(1, filter?.limit || 500));
  return rows.slice(0, limit);
}

export function isPartnerApproved(status?: TemplateApprovalStatus | null): boolean {
  return !!status && APPROVED_STATUSES.includes(status);
}

export function submitSmeReview(input: {
  templateId: string;
  status: TemplateApprovalStatus;
  reviewerId?: string;
  reviewerRole?: string;
  notes?: string;
  rubric?: Partial<TemplateSmeRubric>;
  jurisdiction_code?: string;
}): TemplateSmeReviewRecord {
  const allowed: TemplateApprovalStatus[] = [
    'unreviewed',
    'platform_curated',
    'sme_approved',
    'sme_rejected',
    'changes_requested',
  ];
  if (!allowed.includes(input.status)) {
    throw new Error(`invalid status: ${input.status}`);
  }
  const store = loadStore();
  const prev = store.reviews[input.templateId];
  let rubric: TemplateSmeRubric | undefined;
  if (input.rubric) {
    const legalAccuracy = clamp01(input.rubric.legalAccuracy ?? 0);
    const proceduralCompleteness = clamp01(input.rubric.proceduralCompleteness ?? 0);
    const citationGrounding = clamp01(input.rubric.citationGrounding ?? 0);
    const draftingQuality = clamp01(input.rubric.draftingQuality ?? 0);
    const overall =
      input.rubric.overall != null
        ? clamp01(input.rubric.overall)
        : clamp01(
            (legalAccuracy + proceduralCompleteness + citationGrounding + draftingQuality) / 4,
          );
    rubric = {
      legalAccuracy,
      proceduralCompleteness,
      citationGrounding,
      draftingQuality,
      overall,
    };
    if (input.status === 'sme_approved' && overall < 0.75) {
      throw new Error('sme_approved requires rubric.overall >= 0.75');
    }
  } else if (input.status === 'sme_approved') {
    throw new Error('sme_approved requires a rubric with overall >= 0.75');
  }

  const now = new Date().toISOString();
  const record: TemplateSmeReviewRecord = {
    templateId: input.templateId,
    status: input.status,
    reviewerId: input.reviewerId || prev?.reviewerId,
    reviewerRole: input.reviewerRole || prev?.reviewerRole || 'sme',
    notes: input.notes ?? prev?.notes,
    rubric: rubric || prev?.rubric,
    jurisdiction_code: input.jurisdiction_code || prev?.jurisdiction_code || 'IN',
    reviewedAt: ['sme_approved', 'sme_rejected', 'changes_requested'].includes(input.status)
      ? now
      : prev?.reviewedAt,
    updatedAt: now,
    bootstrapReason: prev?.bootstrapReason,
  };
  store.reviews[input.templateId] = record;
  persistStore(store);
  logger.info('template SME review recorded', {
    templateId: record.templateId,
    status: record.status,
    overall: record.rubric?.overall,
  });
  return record;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Bootstrap platform_curated for curated India document templates + a diverse
 * seed sample so partners have an approved set before full SME pass.
 */
export function bootstrapPlatformCurated(
  templates: NspLegalTemplate[],
  opts?: { maxSeeds?: number; perCategory?: number },
): { created: number; skipped: number; totalApproved: number } {
  const store = loadStore();
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  // Partner India catalog fill: raise seed budget; pick longest N per category
  // (real seed content only — never invent legal text).
  const maxSeeds = opts?.maxSeeds ?? 80;
  const perCategory = Math.max(1, opts?.perCategory ?? 2);

  for (const t of templates) {
    if (t.source !== 'nyv-document') continue;
    // Curated IN court forms + multi-domain GLOBAL packs
    if (t.jurisdiction_code !== 'IN' && t.jurisdiction_code !== 'GLOBAL') continue;
    if (t.jurisdiction_code === 'GLOBAL' && !t.id.startsWith('domain-')) continue;
    if (store.reviews[t.id]) {
      skipped += 1;
      continue;
    }
    store.reviews[t.id] = {
      templateId: t.id,
      status: 'platform_curated',
      reviewerRole: 'platform',
      notes: 'NYV curated India court/practice form — SME attestation still recommended.',
      jurisdiction_code: 'IN',
      updatedAt: now,
      bootstrapReason: 'nyv-document-curated',
      rubric: {
        legalAccuracy: 0.85,
        proceduralCompleteness: 0.85,
        citationGrounding: 0.8,
        draftingQuality: 0.85,
        overall: 0.84,
      },
    };
    created += 1;
  }

  const byCategory = new Map<string, NspLegalTemplate[]>();
  for (const t of templates) {
    if (t.source !== 'nys-seed' || t.jurisdiction_code !== 'IN') continue;
    if (store.reviews[t.id]) continue;
    // Skip thin parity stubs — prefer substantive seeds for partner catalog
    if (String(t.content || '').length < 1200) continue;
    const cat = (t.document_type || t.category || 'general').toLowerCase();
    const list = byCategory.get(cat) || [];
    list.push(t);
    byCategory.set(cat, list);
  }
  let seedCount = 0;
  for (const [, list] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (seedCount >= maxSeeds) break;
    list.sort((a, b) => b.content.length - a.content.length);
    for (const pick of list.slice(0, perCategory)) {
      if (seedCount >= maxSeeds) break;
      if (!pick || store.reviews[pick.id]) continue;
      store.reviews[pick.id] = {
        templateId: pick.id,
        status: 'platform_curated',
        reviewerRole: 'platform',
        notes: 'Bootstrap curated from longest IN seed in category — pending SME re-attestation.',
        jurisdiction_code: 'IN',
        updatedAt: now,
        bootstrapReason: `category:${pick.document_type || pick.category}`,
        rubric: {
          legalAccuracy: 0.8,
          proceduralCompleteness: 0.78,
          citationGrounding: 0.75,
          draftingQuality: 0.8,
          overall: 0.78,
        },
      };
      created += 1;
      seedCount += 1;
    }
  }

  persistStore(store);
  const totalApproved = Object.values(store.reviews).filter((r) =>
    isPartnerApproved(r.status),
  ).length;
  logger.info('bootstrap platform_curated complete', { created, skipped, totalApproved, seedCount, maxSeeds, perCategory });
  return { created, skipped, totalApproved };
}

export function enrichTemplateWithReview<T extends NspLegalTemplate>(
  t: T,
): T & {
  approval_status: TemplateApprovalStatus;
  sme_review: TemplateSmeReviewRecord | null;
  partner_approved: boolean;
} {
  const review = getReview(t.id);
  const approval_status = review?.status || 'unreviewed';
  return {
    ...t,
    approval_status,
    sme_review: review,
    partner_approved: isPartnerApproved(approval_status),
  };
}

export function reviewStats(): {
  unreviewed: number;
  platform_curated: number;
  sme_approved: number;
  sme_rejected: number;
  changes_requested: number;
  partner_approved: number;
} {
  const counts = {
    unreviewed: 0,
    platform_curated: 0,
    sme_approved: 0,
    sme_rejected: 0,
    changes_requested: 0,
    partner_approved: 0,
  };
  for (const r of Object.values(loadStore().reviews)) {
    if (r.status in counts) (counts as any)[r.status] += 1;
    if (isPartnerApproved(r.status)) counts.partner_approved += 1;
  }
  return counts;
}
