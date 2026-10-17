/**
 * NV-DRAFT-CHUNK-001 — stitch multi-chunk complex agreement drafts.
 * NV-DRAFT-CHUNK-COHESION-002 — section numbering continuity + shared definitions.
 * Applies NV-DRAFT-COMPLETION-001 closure on the final stitched body only.
 */

import type { DraftDocumentType } from '../config/jrx-draft-length-registry.js';
import type { DraftChunkPlan } from './jrx-draft-chunk-planner.js';
import { applyDraftCompletionPolish } from './jrx-draft-completion.js';

export interface DraftChunkResult {
  plan: DraftChunkPlan;
  content: string;
}

export interface SharedDefinitionsRegistry {
  terms: string[];
}

const DUPLICATE_HEADING_RE = /^(?:\*\*)?(?:RECITALS|DEFINITIONS|PARTIES|IN WITNESS WHEREOF)(?:\*\*)?\s*$/gim;

function normalizeChunk(content: string): string {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dedupeBoilerplateOverlap(stitched: string): string {
  const lines = stitched.split('\n');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (key && DUPLICATE_HEADING_RE.test(line.trim()) && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(line);
  }
  return out.join('\n');
}

/** Extract defined terms from a DEFINITIONS section for chunk-to-chunk continuity. */
export function extractDefinitionsRegistry(content: string): SharedDefinitionsRegistry {
  const text = String(content || '');
  const terms: string[] = [];
  const defSection = text.match(/(?:^|\n)(?:\*\*)?DEFINITIONS(?:\*\*)?\s*\n([\s\S]*?)(?:\n(?:\*\*)?(?:ARTICLE|Clause|Section|IN WITNESS)|$)/i);
  const body = defSection?.[1] ?? text;
  for (const line of body.split('\n')) {
    const quoted = line.match(/["“]([^"”]+)["”]\s+(?:means|shall mean)/i);
    if (quoted?.[1]) terms.push(quoted[1].trim());
    const caps = line.match(/^["“]?([A-Z][A-Za-z0-9\s/-]{1,40})["”]?\s+(?:means|shall mean)/);
    if (caps?.[1]) terms.push(caps[1].trim());
  }
  return { terms: [...new Set(terms.map((t) => t.trim()).filter(Boolean))].slice(0, 40) };
}

/** Renumber duplicate ARTICLE/Clause headings so chunk joins do not restart at 1. */
export function renumberSectionHeadings(stitched: string, startArticle = 1): string {
  let articleCounter = startArticle;
  const seenArticles = new Set<string>();
  const lines = stitched.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const articleMatch = line.match(/^(?:\*\*)?ARTICLE\s+(\d+)(?:\*\*)?\s*$/i);
    if (articleMatch) {
      const key = line.trim().toLowerCase();
      if (seenArticles.has(key)) {
        out.push(line.replace(/ARTICLE\s+\d+/i, `ARTICLE ${articleCounter}`));
        articleCounter += 1;
        continue;
      }
      seenArticles.add(key);
      const num = Number(articleMatch[1]);
      if (num < articleCounter) {
        out.push(line.replace(/ARTICLE\s+\d+/i, `ARTICLE ${articleCounter}`));
        articleCounter += 1;
        continue;
      }
      articleCounter = num + 1;
      out.push(line);
      continue;
    }

    const clauseMatch = line.match(/^(?:\*\*)?(?:Clause|Section)\s+(\d+(?:\.\d+)*)(?:\*\*)?\s*$/i);
    if (clauseMatch && seenArticles.has(`clause:${clauseMatch[1]}`)) {
      out.push(line.replace(/(\d+(?:\.\d+)*)/, String(articleCounter)));
      articleCounter += 1;
      continue;
    }
    if (clauseMatch) seenArticles.add(`clause:${clauseMatch[1]}`);
    out.push(line);
  }

  return out.join('\n');
}

export function stitchDraftChunks(
  chunks: DraftChunkResult[],
  documentType: DraftDocumentType = 'complex_agreement',
  registry?: SharedDefinitionsRegistry,
): { content: string; chunkCount: number; appendedClosure: boolean; definitionsRegistry: SharedDefinitionsRegistry } {
  const ordered = [...chunks].sort((a, b) => a.plan.index - b.plan.index);
  const parts = ordered
    .map((c) => normalizeChunk(c.content))
    .filter(Boolean);

  let definitionsRegistry = registry ?? { terms: [] };
  for (const part of parts) {
    const extracted = extractDefinitionsRegistry(part);
    if (extracted.terms.length) {
      definitionsRegistry = {
        terms: [...new Set([...definitionsRegistry.terms, ...extracted.terms])],
      };
    }
  }

  let content = dedupeBoilerplateOverlap(parts.join('\n\n'));
  content = renumberSectionHeadings(content);

  if (definitionsRegistry.terms.length > 0 && !/\*\*DEFINITIONS\*\*/i.test(content)) {
    const defLines = definitionsRegistry.terms.slice(0, 12).map(
      (t) => `"${t}" shall have the meaning assigned in the operative clauses above.`,
    );
    content = `${content}\n\n**DEFINITIONS (stitched registry)**\n${defLines.join('\n')}`;
  }

  const polished = applyDraftCompletionPolish(content, {
    documentType,
    appendClosure: true,
  });
  content = polished.content;
  return {
    content,
    chunkCount: ordered.length,
    appendedClosure: polished.appendedClosure,
    definitionsRegistry,
  };
}
