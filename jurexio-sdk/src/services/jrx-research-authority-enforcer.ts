/**
 * NV-RESEARCH-AUTHORITY-ENFORCE-001 — when RAG/citation verification delivered
 * authorities but the model omitted locatable case citations from the research
 * body, append a deterministic AUTHORITIES block from retrieved metadata only.
 */

import { countLocatableAuthorities } from '../utils/jrx-authority-body-detection.js';
import {
  parseAuthoritiesFromContextBlock,
  sourcesFromRagContext,
  type RetrievedSourceLine,
} from './jrx-sources-consulted-enforcer.js';
import { countDeliveredAuthorities } from '../orchestration/jrx-orchestration-response-contract.js';

export const RESEARCH_AUTHORITIES_HEADING = '**AUTHORITIES**';

const AUTHORITIES_SECTION_RE = /\*\*AUTHORITIES\*\*|^AUTHORITIES\s*:?\s*$/im;

export function isLegalResearchTaskType(taskType?: string): boolean {
  return /^legal[_-]?research$/i.test(String(taskType || '').trim());
}

export function hasResearchAuthoritiesSection(content: string): boolean {
  return AUTHORITIES_SECTION_RE.test(String(content || ''));
}

function normalizeCaseTitle(title: string): string {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .replace(/\bVERSUS\b/gi, 'versus')
    .trim();
}

/** Format one authority so counsel-grade locators can find it in the body. */
export function formatLocatableAuthorityLine(source: RetrievedSourceLine): string | null {
  const name = normalizeCaseTitle(source.name);
  const citation = String(source.citation || '').trim();
  if (!name) return null;

  const hasPartyPair = /\bversus\b|\bv\.?\s/i.test(name);
  if (citation && hasPartyPair) {
    return `- ${name}, ${citation}`;
  }
  if (citation && !hasPartyPair) {
    return `- ${name} — ${citation}`;
  }
  if (hasPartyPair) return `- ${name}`;
  return null;
}

function isDeliveredCaseAuthority(line: RetrievedSourceLine): boolean {
  return formatLocatableAuthorityLine(line) !== null
    || countLocatableAuthorities(`${line.name} ${line.citation || ''}`.trim()) > 0;
}

export function sourcesFromCitationsEnvelope(citations: unknown): RetrievedSourceLine[] {
  if (!citations || typeof citations !== 'object') return [];
  const root = citations as Record<string, unknown>;
  const details = Array.isArray(root.details)
    ? root.details
    : Array.isArray(root.citations)
      ? root.citations
      : [];
  const out: RetrievedSourceLine[] = [];
  for (const item of details) {
    if (item == null) continue;
    if (typeof item === 'string') {
      const t = item.trim();
      if (!t) continue;
      const line = { name: t };
      if (isDeliveredCaseAuthority(line)) out.push(line);
      continue;
    }
    if (typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = String(o.title || o.ref || o.text || o.citation || '').trim();
    const cite = String(o.citation || o.ref || o.authorityRef || '').trim();
    if (!name) continue;
    const line = { name, citation: cite || undefined };
    if (isDeliveredCaseAuthority(line)) out.push(line);
  }
  return out;
}

export function mergeRetrievedAuthoritySources(opts: {
  retrievedSources?: RetrievedSourceLine[];
  contextBlock?: string;
  ragContext?: {
    chunks?: Array<{ title?: string; authorityRef?: string; citationRef?: string; content?: string }>;
  } | null;
  citations?: unknown;
}): RetrievedSourceLine[] {
  const merged: RetrievedSourceLine[] = [];
  const seen = new Set<string>();

  const push = (lines: RetrievedSourceLine[]) => {
    for (const line of lines) {
      const key = `${line.name}|${line.citation || ''}`.toLowerCase();
      if (!line.name?.trim() || seen.has(key)) continue;
      seen.add(key);
      merged.push(line);
    }
  };

  if (opts.retrievedSources?.length) push(opts.retrievedSources);
  if (opts.contextBlock) push(parseAuthoritiesFromContextBlock(opts.contextBlock));
  if (opts.ragContext) push(sourcesFromRagContext(opts.ragContext));
  if (opts.citations) push(sourcesFromCitationsEnvelope(opts.citations));

  return merged.slice(0, 12);
}

export function buildResearchAuthoritiesBlock(sources: RetrievedSourceLine[]): string {
  const lines = sources
    .map((s) => formatLocatableAuthorityLine(s))
    .filter((l): l is string => !!l);
  if (!lines.length) return '';
  return ['', RESEARCH_AUTHORITIES_HEADING, ...lines].join('\n');
}

export interface EnforceResearchAuthoritiesOpts {
  taskType?: string;
  minLocatable?: number;
  retrievedSources?: RetrievedSourceLine[];
  contextBlock?: string;
  ragContext?: {
    chunks?: Array<{ title?: string; authorityRef?: string; citationRef?: string; content?: string }>;
  } | null;
  citations?: unknown;
}

export function enforceResearchAuthorities(
  content: string,
  opts: EnforceResearchAuthoritiesOpts = {},
): { content: string; appended: boolean; locatableBefore: number; locatableAfter: number } {
  const text = String(content || '');
  if (!text.trim() || !isLegalResearchTaskType(opts.taskType)) {
    return { content: text, appended: false, locatableBefore: 0, locatableAfter: 0 };
  }

  const minLocatable = opts.minLocatable ?? 1;
  const locatableBefore = countLocatableAuthorities(text);
  if (locatableBefore >= minLocatable || hasResearchAuthoritiesSection(text)) {
    return { content: text, appended: false, locatableBefore, locatableAfter: locatableBefore };
  }

  const delivered = countDeliveredAuthorities(opts.citations);
  const sources = mergeRetrievedAuthoritySources(opts);
  if (!sources.length && delivered === 0) {
    return { content: text, appended: false, locatableBefore, locatableAfter: locatableBefore };
  }

  const block = buildResearchAuthoritiesBlock(sources);
  if (!block.trim()) {
    return { content: text, appended: false, locatableBefore, locatableAfter: locatableBefore };
  }

  const out = `${text.trim()}\n${block}`;
  const locatableAfter = countLocatableAuthorities(out);
  if (locatableAfter <= locatableBefore) {
    return { content: text, appended: false, locatableBefore, locatableAfter: locatableBefore };
  }

  return { content: out, appended: true, locatableBefore, locatableAfter };
}
