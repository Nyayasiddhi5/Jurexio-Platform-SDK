/**
 * NV-KANOON-ENRICH-001 — optional Indian Kanoon citation enrichment for CNR resolve.
 * Opt-in via JRX_F_KANOON_ENRICH=1; requires INDIA_KANOON_API_KEY (never fake citations).
 */
import { createLogger } from '../utils/logger.js';
import type { CnrCandidate, CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';

const logger = createLogger('./jrx-kanoon-enrichment');

export const KANOON_ENRICH_SOURCE = 'indian_kanoon_enrichment';
export const KANOON_ENRICH_ATTEMPTED = 'indian_kanoon_attempted';

const KANOON_API = 'https://api.indiankanoon.org';

function envFlagOn(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Default ON when `INDIA_KANOON_API_KEY` is configured; opt-out with
 * `JRX_F_KANOON_ENRICH=0`. Explicit `JRX_F_KANOON_ENRICH=1` enables even without
 * a key (records `not_configured` in meta — no fake citations).
 */
export function isKanoonEnrichEnabled(): boolean {
  const explicit = (process.env.JRX_F_KANOON_ENRICH ?? '').trim().toLowerCase();
  if (explicit === '0' || explicit === 'false' || explicit === 'off' || explicit === 'no') {
    return false;
  }
  if (envFlagOn('JRX_F_KANOON_ENRICH')) return true;
  return kanoonKeyConfigured();
}

function kanoonKeyConfigured(): boolean {
  return (process.env.INDIA_KANOON_API_KEY ?? '').trim().length > 8;
}

type KanoonDoc = {
  tid?: number;
  title?: string;
  docsource?: string;
  publishdate?: string;
};

async function searchKanoonByQuery(query: string): Promise<KanoonDoc[]> {
  const token = process.env.INDIA_KANOON_API_KEY?.trim();
  if (!token) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${KANOON_API}/search/?formInput=${encodeURIComponent(query)}&pagenum=0`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('[Kanoon] search upstream non-OK', { status: res.status, queryLen: query.length });
      return [];
    }
    const body = (await res.json()) as { docs?: KanoonDoc[] };
    return Array.isArray(body.docs) ? body.docs.slice(0, 5) : [];
  } catch (err: unknown) {
    logger.warn('[Kanoon] search failed', { err: err instanceof Error ? err.message : String(err) });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function docsToCandidates(docs: KanoonDoc[]): CnrCandidate[] {
  return docs
    .filter((d) => d.tid && d.title)
    .map((d) => ({
      cnr: null,
      title: String(d.title),
      courtName: d.docsource ?? null,
      decisionDate: d.publishdate ?? null,
      confidence: 0.55,
      source: KANOON_ENRICH_SOURCE,
    }));
}

/** Additive enrichment — only when flag + API key; never overwrites corpus `found` status. */
export async function enrichWithKanoonCandidates(data: CnrResolveData): Promise<CnrResolveData> {
  if (!isKanoonEnrichEnabled()) return data;

  const queryParts = [
    data.cnr,
    data.fields?.caseTitle?.value ? String(data.fields.caseTitle.value) : null,
    data.fields?.petitioner?.value ? String(data.fields.petitioner.value) : null,
  ].filter(Boolean) as string[];

  if (queryParts.length === 0) return data;

  const attemptedTag = KANOON_ENRICH_ATTEMPTED;
  const sourcesTried = [...data.sourcesTried];
  if (!sourcesTried.includes(attemptedTag)) sourcesTried.push(attemptedTag);

  if (!kanoonKeyConfigured()) {
    logger.info('[Kanoon] enrich enabled but INDIA_KANOON_API_KEY absent — skip', {
      cnrLen: data.cnr.length,
    });
    return {
      ...data,
      sourcesTried,
      meta: {
        ...(data.meta ?? {}),
        extra: {
          ...(data.meta?.extra ?? {}),
          kanoonEnrich: 'not_configured',
          kanoonNote: 'Register at api.indiankanoon.org for INDIA_KANOON_API_KEY',
        },
      },
    };
  }

  const docs = await searchKanoonByQuery(queryParts.join(' '));
  if (docs.length === 0) {
    return {
      ...data,
      sourcesTried,
      meta: {
        ...(data.meta ?? {}),
        extra: { ...(data.meta?.extra ?? {}), kanoonEnrich: 'no_hits' },
      },
    };
  }

  const kanoonCandidates = docsToCandidates(docs);
  const mergedCandidates = [...data.candidates];
  for (const c of kanoonCandidates) {
    if (!mergedCandidates.some((x) => x.title === c.title && x.source === c.source)) {
      mergedCandidates.push(c);
    }
  }

  if (!sourcesTried.includes(KANOON_ENRICH_SOURCE)) sourcesTried.push(KANOON_ENRICH_SOURCE);

  return {
    ...data,
    candidates: mergedCandidates,
    sourcesTried,
    meta: {
      ...(data.meta ?? {}),
      extra: {
        ...(data.meta?.extra ?? {}),
        kanoonEnrich: 'candidates_added',
        kanoonHits: kanoonCandidates.length,
      },
    },
  };
}
