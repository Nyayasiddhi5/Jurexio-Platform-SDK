/**
 * NV-SOURCES-CONSULTED-001 — enforce SOURCES CONSULTED block on legal-chat-fast
 * when RAG/statute prefetch ran but the model omitted the mandatory section.
 */

export const SOURCES_CONSULTED_HEADING = '**SOURCES CONSULTED**';

const SOURCES_SECTION_RE = /\*\*SOURCES CONSULTED\*\*|^SOURCES CONSULTED\s*:?\s*$/im;

export interface RetrievedSourceLine {
  name: string;
  citation?: string;
  proposition?: string;
}

export function hasSourcesConsultedSection(content: string): boolean {
  return SOURCES_SECTION_RE.test(String(content || ''));
}

export function buildSourcesConsultedBlock(
  sources: RetrievedSourceLine[],
  noneRetrieved = false,
): string {
  if (noneRetrieved || sources.length === 0) {
    return [
      '',
      SOURCES_CONSULTED_HEADING,
      '- None retrieved — general principles only',
    ].join('\n');
  }

  const lines = sources.slice(0, 12).map((s) => {
    const cite = s.citation ? ` — ${s.citation}` : '';
    const prop = s.proposition ? `: ${s.proposition}` : '';
    return `- ${s.name}${cite}${prop}`;
  });

  return ['', SOURCES_CONSULTED_HEADING, ...lines].join('\n');
}

export function sourcesFromRagContext(ragContext?: {
  retrievalMethods?: string[];
  searchQuery?: string;
  layersUsed?: string[];
  chunks?: Array<{ title?: string; authorityRef?: string; citationRef?: string; content?: string }>;
} | null): RetrievedSourceLine[] {
  if (!ragContext) return [];
  const chunks = ragContext.chunks;
  if (Array.isArray(chunks) && chunks.length > 0) {
    return chunks.map((c) => ({
      name: String(c.title || c.citationRef || 'Retrieved authority').trim(),
      citation: c.authorityRef || c.citationRef,
      proposition: c.content ? String(c.content).slice(0, 120).trim() : undefined,
    }));
  }
  return [];
}

export function sourcesFromAuthorityTitles(titles: string[]): RetrievedSourceLine[] {
  return titles
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((name) => ({ name }));
}

/** NV-STATUTE-FAQ-SOURCES-001 — statute mapping fast path (IPC→BNS etc.). */
export function sourcesFromStatuteMapping(opts: {
  fromCode: string;
  fromSection: string;
  toCode: string;
  toSection: string;
  toHeading?: string;
}): RetrievedSourceLine[] {
  const heading = String(opts.toHeading || '').trim();
  return [{
    name: `${opts.toCode} Section ${opts.toSection}`,
    citation: heading || `Mapped from ${opts.fromCode} Section ${opts.fromSection} (NCRB Sankalan)`,
  }];
}

/** NV-STATUTE-FAQ-SOURCES-001 — single-section statute FAQ fast path. */
export function sourcesFromStatuteAuthority(auth: {
  act_short_title?: string;
  section_number?: string;
  section_title?: string;
}): RetrievedSourceLine[] {
  const act = String(auth.act_short_title || 'Statute').trim();
  const sec = String(auth.section_number || '?').trim();
  const title = String(auth.section_title || '').trim();
  return [{
    name: `${act} Section ${sec}`,
    citation: title || undefined,
  }];
}

/** Enforce SOURCES CONSULTED on zero-token statute fast-path answers. */
export function enforceStatuteFastPathSources(
  content: string,
  sources: RetrievedSourceLine[],
): { content: string; appended: boolean } {
  return enforceSourcesConsulted(content, {
    statutePrefetchApplied: true,
    retrievedSources: sources,
  });
}

/** Extract authority names from AUTHORITIES SUPPLIED roll-up in injected RAG block. */
export function parseAuthoritiesFromContextBlock(contextBlock?: string): RetrievedSourceLine[] {
  const block = String(contextBlock || '');
  if (!block.includes('AUTHORITIES SUPPLIED')) return [];
  const lines: RetrievedSourceLine[] = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\d+\.\s+(.+?)(?:\s+—\s+(.+))?$/);
    if (!m) continue;
    lines.push({
      name: m[1].trim(),
      citation: m[2]?.trim(),
    });
  }
  return lines;
}

export interface EnforceSourcesConsultedOpts {
  ragAttempted?: boolean;
  ragGrounded?: boolean;
  statutePrefetchApplied?: boolean;
  contextBlock?: string;
  retrievedSources?: RetrievedSourceLine[];
}

export function enforceSourcesConsulted(
  content: string,
  opts: EnforceSourcesConsultedOpts = {},
): { content: string; appended: boolean } {
  const text = String(content || '');
  if (!text.trim()) return { content: text, appended: false };
  if (hasSourcesConsultedSection(text)) return { content: text, appended: false };

  const invokedRag = opts.ragAttempted === true || opts.ragGrounded === true;
  const invokedStatute = opts.statutePrefetchApplied === true;
  if (!invokedRag && !invokedStatute) return { content: text, appended: false };

  let sources = opts.retrievedSources ?? [];
  if (!sources.length && opts.contextBlock) {
    sources = parseAuthoritiesFromContextBlock(opts.contextBlock);
  }

  const noneRetrieved = sources.length === 0;
  const block = buildSourcesConsultedBlock(sources, noneRetrieved);
  return { content: `${text.trim()}\n${block}`, appended: true };
}
