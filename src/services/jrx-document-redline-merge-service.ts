/**
 * NV-DOCPIPE-MRH-001 — Document merge / redline / highlight support service.
 * ───────────────────────────────────────────────────────────────────────────
 * Deterministic primitives (line diff, clause merge, highlight-span mapping)
 * plus a safety-ring LLM summary for material redline changes. Composed by the
 * /api/jrx/documents {merge,redline,highlight} routes. All LLM access routes
 * through callJurexio (NV-LLM-001 compliant).
 */
import { callJurexio } from './jrx-client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-doc-redline-merge');

// ── Line diff (LCS) ──────────────────────────────────────────────────────────
export type DiffOp = 'equal' | 'add' | 'del';
export interface DiffSegment { op: DiffOp; text: string; aLine?: number; bLine?: number; }

/** Myers-style LCS line diff producing track-changes segments. */
export function diffLines(a: string, b: string): { segments: DiffSegment[]; stats: { added: number; removed: number; unchanged: number } } {
  const A = a.replace(/\r\n/g, '\n').split('\n');
  const B = b.replace(/\r\n/g, '\n').split('\n');
  const n = A.length;
  const m = B.length;
  // LCS DP table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      segments.push({ op: 'equal', text: A[i], aLine: i + 1, bLine: j + 1 });
      unchanged++; i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      segments.push({ op: 'del', text: A[i], aLine: i + 1 });
      removed++; i++;
    } else {
      segments.push({ op: 'add', text: B[j], bLine: j + 1 });
      added++; j++;
    }
  }
  while (i < n) { segments.push({ op: 'del', text: A[i], aLine: i + 1 }); removed++; i++; }
  while (j < m) { segments.push({ op: 'add', text: B[j], bLine: j + 1 }); added++; j++; }
  return { segments, stats: { added, removed, unchanged } };
}

/** Compact unified-diff style string for quick display. */
export function renderUnified(segments: DiffSegment[]): string {
  return segments
    .map((s) => (s.op === 'equal' ? `  ${s.text}` : s.op === 'add' ? `+ ${s.text}` : `- ${s.text}`))
    .join('\n');
}

// ── Material-change semantic summary (safety-ring LLM) ────────────────────────
export interface MaterialChange { category: string; severity: 'High' | 'Medium' | 'Low'; description: string; }

export async function semanticRedlineSummary(
  documentA: string,
  documentB: string,
  opts: { jurisdiction?: string } = {},
): Promise<{ summary: string; materialChanges: MaterialChange[] }> {
  const a = documentA.substring(0, 8000);
  const b = documentB.substring(0, 8000);
  try {
    const result = await callJurexio(
      'legal-doc-comparator',
      `You are a contract redline expert. Compare the ORIGINAL and REVISED versions of a legal document and identify the materially significant changes (not cosmetic edits). Reply with ONLY JSON:
{"summary":"<2-3 sentence plain-language summary of what materially changed>","materialChanges":[{"category":"<e.g. Liability, Payment, Term, Termination, IP, Governing Law, Confidentiality>","severity":"<High|Medium|Low>","description":"<what changed and why it matters>"}]}
Return an empty materialChanges array if only cosmetic changes exist.`,
      `ORIGINAL:\n${a}\n\nREVISED:\n${b}`,
      { maxTokens: 2000, tier: 'elite', jurisdiction: opts.jurisdiction || 'india', taskType: 'document-compare' },
    );
    const match = result.content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        summary: String(parsed.summary || ''),
        materialChanges: Array.isArray(parsed.materialChanges) ? parsed.materialChanges : [],
      };
    }
  } catch (e: any) {
    logger.warn(`semantic_redline_summary_failed: ${e?.message || e}`);
  }
  return { summary: '', materialChanges: [] };
}

// ── Highlight-span mapping ────────────────────────────────────────────────────
export interface HighlightSpan {
  start: number;
  end: number;
  kind: 'risk' | 'clause' | 'privacy' | 'missing_term';
  severity: string;
  label: string;
  note?: string;
  recommendation?: string;
}

/** Map an analysis result onto character offsets within the source text. */
export function computeHighlightSpans(text: string, analysis: any): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  const findOffset = (needle?: string): [number, number] | null => {
    if (!needle) return null;
    const probe = needle.trim().slice(0, 120);
    if (probe.length < 6) return null;
    const idx = text.indexOf(probe);
    if (idx < 0) return null;
    return [idx, idx + probe.length];
  };

  for (const r of analysis?.risks ?? []) {
    const off = findOffset(r.clauseReference) || findOffset(r.description);
    if (off) {
      spans.push({ start: off[0], end: off[1], kind: 'risk', severity: r.level || 'Medium', label: r.type || 'Risk', note: r.description, recommendation: r.recommendation });
    }
  }
  for (const c of analysis?.clauses ?? []) {
    const off = findOffset(c.content);
    if (off) {
      spans.push({ start: off[0], end: off[1], kind: 'clause', severity: c.importance || 'Medium', label: c.type || 'Clause' });
    }
  }
  for (const p of analysis?.privacyAlerts ?? []) {
    const off = findOffset(p.excerpt);
    if (off) {
      spans.push({ start: off[0], end: off[1], kind: 'privacy', severity: p.severity || 'Medium', label: p.alertType || 'Privacy', recommendation: p.recommendation });
    }
  }
  for (const t of analysis?.missingTerms ?? []) {
    // missing terms have no offset (they're absent) — surface as zero-width markers at doc start
    spans.push({ start: 0, end: 0, kind: 'missing_term', severity: t.importance || 'Medium', label: t.term, note: t.suggestion });
  }
  return spans.sort((x, y) => x.start - y.start);
}

// ── Deterministic clause merge ────────────────────────────────────────────────
export interface MergeInputDoc { title?: string; text: string; }
export interface MergeConflict { clauseKey: string; sources: string[]; variants: string[]; }
export interface MergeResult {
  merged: string;
  sections: { title: string; paragraphs: number }[];
  conflicts: MergeConflict[];
  dedupedCount: number;
  stats: { documents: number; paragraphs: number; uniqueParagraphs: number };
}

const CLAUSE_KEYWORDS = [
  'termination', 'governing law', 'jurisdiction', 'payment', 'confidentiality',
  'indemnification', 'indemnity', 'liability', 'warranty', 'dispute resolution',
  'arbitration', 'force majeure', 'intellectual property', 'non-compete', 'notice',
];

function normalizePara(p: string): string {
  return p.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim();
}

function clauseKeyFor(p: string): string | null {
  const lower = p.toLowerCase();
  for (const kw of CLAUSE_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

/** Merge multiple documents deterministically with dedupe + conflict detection. */
export function mergeDocuments(docs: MergeInputDoc[], opts: { dedupeClauses?: boolean } = {}): MergeResult {
  const dedupe = opts.dedupeClauses !== false;
  const seen = new Set<string>();
  const outParts: string[] = [];
  const sections: { title: string; paragraphs: number }[] = [];
  let dedupedCount = 0;
  let totalParas = 0;

  // clauseKey -> [{ source, normalized, raw }]
  const clauseMap = new Map<string, { source: string; normalized: string; raw: string }[]>();

  docs.forEach((doc, di) => {
    const title = (doc.title || `Document ${di + 1}`).trim();
    const paras = doc.text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let kept = 0;
    const body: string[] = [];
    for (const p of paras) {
      totalParas++;
      const norm = normalizePara(p);
      if (dedupe && seen.has(norm)) { dedupedCount++; continue; }
      seen.add(norm);
      kept++;
      body.push(p);
      const ck = clauseKeyFor(p);
      if (ck) {
        const arr = clauseMap.get(ck) || [];
        arr.push({ source: title, normalized: norm, raw: p });
        clauseMap.set(ck, arr);
      }
    }
    outParts.push(`## ${title}\n\n${body.join('\n\n')}`);
    sections.push({ title, paragraphs: kept });
  });

  // conflict = same clause keyword appearing in >1 source with differing normalized text
  const conflicts: MergeConflict[] = [];
  for (const [ck, entries] of clauseMap.entries()) {
    const distinctSources = new Set(entries.map((e) => e.source));
    const distinctVariants = new Set(entries.map((e) => e.normalized));
    if (distinctSources.size > 1 && distinctVariants.size > 1) {
      conflicts.push({
        clauseKey: ck,
        sources: Array.from(distinctSources),
        variants: entries.map((e) => e.raw.slice(0, 200)),
      });
    }
  }

  return {
    merged: outParts.join('\n\n---\n\n'),
    sections,
    conflicts,
    dedupedCount,
    stats: { documents: docs.length, paragraphs: totalParas, uniqueParagraphs: seen.size },
  };
}
