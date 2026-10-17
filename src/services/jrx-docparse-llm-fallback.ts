/**
 * NV-DOCPARSE-LLM-FALLBACK-001 — optional low-confidence recovery pass for the
 * deterministic docparse adapter.
 *
 * The @jurexio/docparse engine and the heuristic/OCR tiers stay the SSoT primary
 * (docparse is deliberately "no LLM in the default path"). When — and only when —
 * that deterministic result is degraded / partial (absent or low-confidence
 * fields), this helper runs ONE cheap tool-schema (Zod) extraction pass through
 * the safety ring (realLLMService.executeRequest → orchestrateLLM, NV-LLM-001),
 * pinned to Amazon Nova Micro (cheapest Bedrock text rail, ap-south-1 residency).
 *
 * Guarantees:
 *   - Enhancement only: gated behind JRX_F_DOCPARSE_LLM_FALLBACK (default OFF).
 *   - Fills ONLY absent / low-confidence field keys; never overwrites a confident
 *     deterministic value (confidence >= CONFIDENT_THRESHOLD).
 *   - Never invents facts: the model is instructed to return a field only when it
 *     is present verbatim, and the output is Zod-validated + length-bounded.
 *   - Fully fail-soft: any flag-off / no-gap / LLM / parse / validation error
 *     returns the original deterministic result unchanged.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { isNyvFeatureOn } from '../config/jrx-feature-flags.js';
import type { CourtDocField } from './jrx-court-document-fields.js';
import type { DocparseAdapterResult } from './jrx-docparse-adapter-service.js';

const logger = createLogger('./jrx-docparse-llm-fallback');

/** A deterministic value at/above this confidence is authoritative — never overwritten. */
const CONFIDENT_THRESHOLD = 0.7;
/** Confidence stamped on an LLM-recovered field (below deterministic RESOLVED 0.88). */
const LLM_FIELD_CONFIDENCE = 0.6;
const MAX_DOC_CHARS = 12_000;
const MAX_FIELD_VALUE_CHARS = 400;
const NOVA_MICRO_PRIMARY = 'apac.amazon.nova-micro-v1:0';

/**
 * Tool schema (Zod) for the recoverable court-document fields. Keys mirror the
 * deterministic `CourtDocField.key` space in nv-court-document-fields /
 * nv-docparse-adapter-service so merges are 1:1 and no new field taxonomy is born.
 */
const FIELD_SCHEMA = z
  .object({
    cnr: z.string().optional(),
    court: z.string().optional(),
    case_type: z.string().optional(),
    case_year: z.string().optional(),
    filing_number: z.string().optional(),
    fir_number: z.string().optional(),
    police_station: z.string().optional(),
    statutes_invoked: z.string().optional(),
    petitioner: z.string().optional(),
    respondent: z.string().optional(),
    advocate: z.string().optional(),
    document_type: z.string().optional(),
  })
  .partial();

type ExtractedFields = z.infer<typeof FIELD_SCHEMA>;

const FIELD_LABELS: Record<keyof ExtractedFields, string> = {
  cnr: 'CNR',
  court: 'Court',
  case_type: 'Case type',
  case_year: 'Case year',
  filing_number: 'Filing number',
  fir_number: 'FIR number',
  police_station: 'Police station',
  statutes_invoked: 'Statutes / sections invoked',
  petitioner: 'Petitioner',
  respondent: 'Respondent',
  advocate: 'Advocate',
  document_type: 'Document type',
};

const ALL_KEYS = Object.keys(FIELD_LABELS) as Array<keyof ExtractedFields>;

function isIndianLegalJurisdiction(jurisdiction?: string): boolean {
  const j = (jurisdiction || 'IN').toUpperCase();
  return j === 'IN' || j.startsWith('IN-') || j === 'INDIA';
}

/**
 * Which recoverable keys are still missing or weak in the deterministic result.
 * A key is a target when it is absent from `fields`, present but below the
 * confident threshold, or explicitly listed in docparse's low-confidence / absent
 * / conflict sets.
 */
function computeTargetKeys(result: DocparseAdapterResult): Array<keyof ExtractedFields> {
  const byKey = new Map(result.fields.map((f) => [f.key, f]));
  const flagged = new Set<string>([
    ...(result.docparseMeta?.absentFields ?? []),
    ...(result.docparseMeta?.lowConfidenceFields ?? []),
    ...(result.docparseMeta?.conflictFields ?? []),
  ]);
  const targets: Array<keyof ExtractedFields> = [];
  for (const key of ALL_KEYS) {
    const existing = byKey.get(key);
    if (!existing) {
      targets.push(key);
      continue;
    }
    if (existing.confidence < CONFIDENT_THRESHOLD || flagged.has(key)) {
      targets.push(key);
    }
  }
  return targets;
}

function buildPrompt(text: string, targets: Array<keyof ExtractedFields>): string {
  const wanted = targets.map((k) => `- ${k} (${FIELD_LABELS[k]})`).join('\n');
  return [
    'You are extracting metadata from an Indian court document.',
    'Return ONLY the fields listed below that appear VERBATIM in the text.',
    'Omit any field you cannot find. Never guess, infer, translate, or fabricate a value.',
    'Return strict minified JSON with only the requested keys (string values).',
    '',
    'Fields still needed:',
    wanted,
    '',
    'Document text:',
    text.slice(0, MAX_DOC_CHARS),
  ].join('\n');
}

function coerceField(value: unknown): string {
  if (value == null) return '';
  return String(value).trim().slice(0, MAX_FIELD_VALUE_CHARS);
}

function safeJsonObject(raw: string): Record<string, unknown> | null {
  const direct = tryParse(raw);
  if (direct) return direct;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    const p = tryParse(fenced[1]);
    if (p) return p;
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return tryParse(raw.slice(first, last + 1));
  }
  return null;
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s.trim());
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function novaMicroExtract(
  prompt: string,
): Promise<ExtractedFields | null> {
  const budgetMs = Number(process.env.NYV_DOCPARSE_LLM_FALLBACK_BUDGET_MS || 12_000);
  /* NV-LLM-001 + no-inline-imports exception (documented): real-llm-service is a
   * heavy module that (transitively) imports the router which imports config; a
   * top-level import here creates a load-time cycle. Every safety-ring leaf
   * service (e.g. nv-draft-structure-checker) uses this same dynamic import. */
  const { realLLMService } = await import('./real-llm-service.js');

  const llmPromise = realLLMService.executeRequest({
    id: randomUUID(),
    userId: 'system',
    prompt,
    systemPrompt:
      'You are a precise Indian legal document field extractor. Output valid minified JSON only. Never invent facts, parties, citations, or numbers.',
    model: NOVA_MICRO_PRIMARY,
    maxTokens: 1_024,
    temperature: 0,
    tier: 'plus',
    taskKind: 'extraction',
    jurisdiction: 'IN',
    expectJson: true,
    maxCostUsd: Number(process.env.NYV_DOCPARSE_LLM_FALLBACK_MAX_COST_USD || 0.02),
    requirements: {
      complexity: 'simple',
      domain: 'analytical',
      priority: 'low',
      costBudget: 'minimal',
      responseTime: 'fastest',
      qualityLevel: 'standard',
    },
    fallbackLevels: 1,
    timestamp: new Date(),
  } as Parameters<typeof realLLMService.executeRequest>[0]);

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), budgetMs);
  });
  const resp = await Promise.race([llmPromise, timeoutPromise]);
  if (!resp?.content) {
    logger.warn('[NV-DOCPARSE-LLM-FALLBACK-001] Nova Micro pass returned no content (timeout/empty)');
    return null;
  }
  const obj = safeJsonObject(String(resp.content));
  if (!obj) return null;
  const parsed = FIELD_SCHEMA.safeParse(obj);
  return parsed.success ? parsed.data : null;
}

/**
 * Apply the optional Nova-Micro low-confidence recovery pass to a docparse result.
 * Returns the original result unchanged whenever the flag is off, the jurisdiction
 * is non-Indian, there is nothing to recover, or anything fails.
 */
export async function applyDocparseLlmFallback(
  result: DocparseAdapterResult,
  ctx: { text?: string; jurisdiction?: string },
): Promise<DocparseAdapterResult> {
  try {
    if (!isNyvFeatureOn('docparseLlmFallback')) return result;
    if (!isIndianLegalJurisdiction(ctx.jurisdiction)) return result;
    const text = String(ctx.text || '').trim();
    if (text.length < 40) return result;

    const targets = computeTargetKeys(result);
    if (targets.length === 0) return result;

    const extracted = await novaMicroExtract(buildPrompt(text, targets));
    if (!extracted) return result;

    const byKey = new Map(result.fields.map((f) => [f.key, f]));
    const recovered: string[] = [];
    const mergedFields: CourtDocField[] = [...result.fields];

    for (const key of targets) {
      const value = coerceField(extracted[key]);
      if (!value) continue;
      const existing = byKey.get(key);
      // Never overwrite a confident deterministic value.
      if (existing && existing.confidence >= CONFIDENT_THRESHOLD) continue;
      const field: CourtDocField = {
        key,
        label: FIELD_LABELS[key],
        value,
        confidence: LLM_FIELD_CONFIDENCE,
        source: 'llm',
      };
      if (existing) {
        const idx = mergedFields.findIndex((f) => f.key === key);
        if (idx >= 0) mergedFields[idx] = field;
      } else {
        mergedFields.push(field);
      }
      recovered.push(key);
    }

    if (recovered.length === 0) return result;

    const recoveredSet = new Set(recovered);
    const prunedAbsent = (result.docparseMeta?.absentFields ?? []).filter((k) => !recoveredSet.has(k));
    const prunedLow = (result.docparseMeta?.lowConfidenceFields ?? []).filter((k) => !recoveredSet.has(k));

    logger.info('[NV-DOCPARSE-LLM-FALLBACK-001] recovered fields via Nova Micro', {
      recovered,
      count: recovered.length,
    });

    return {
      ...result,
      fields: mergedFields,
      fieldCount: mergedFields.length,
      docparseMeta: {
        ...result.docparseMeta,
        absentFields: prunedAbsent,
        lowConfidenceFields: prunedLow,
        llmFallbackApplied: true,
        llmFallbackModel: NOVA_MICRO_PRIMARY,
        llmFallbackFields: recovered,
      },
    };
  } catch (err) {
    logger.warn('[NV-DOCPARSE-LLM-FALLBACK-001] fallback skipped', {
      err: err instanceof Error ? err.message : String(err),
    });
    return result;
  }
}
