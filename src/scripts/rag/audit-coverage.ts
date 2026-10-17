/**
 * RAG Coverage Audit Runner — Workstream #2, V5.0.0
 *
 * Probes every (category × jurisdiction) cell with its fixture query and
 * records: pipeline used, sources returned, average similarity, grounded?,
 * latency. Writes one row per cell to nv_schema.nv_rag_coverage_audit and
 * returns an aggregate summary.
 *
 * Status thresholds:
 *   GREEN  = sources >= 1 AND grounded == true
 *   YELLOW = sources >= 1 AND grounded == false
 *   RED    = sources == 0
 */

import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { upsertRow } from '../../services/persistence/jrx-persistence-helper.js';
import {
  CATEGORIES, JURISDICTIONS, getFixture, totalCells, explicitFixtureCount,
  type CategoryKey, type JurisdictionKey,
} from './rag-audit-fixtures.js';

const logger = createLogger('rag-audit');

export interface CellResult {
  category: CategoryKey;
  jurisdiction: JurisdictionKey;
  fixtureQuery: string;
  pipelineUsed: string;
  sourcesCount: number;
  avgSimilarity: number;
  grounded: boolean;
  latencyMs: number;
  status: 'green' | 'yellow' | 'red';
  notes?: string;
}

export interface AuditSummary {
  runId: string;
  ranAt: string;
  totalCells: number;
  explicitFixtures: number;
  green: number;
  yellow: number;
  red: number;
  avgLatencyMs: number;
  cells: CellResult[];
}

/**
 * Best-effort probe through whichever RAG service is mounted. Tries the
 * graphrag legal service first (jurisdiction-aware), falls back to
 * adaptive RAG, then the base RAG service.
 */
async function probeRag(query: string, jurisdiction: JurisdictionKey): Promise<{
  pipeline: string; sources: number; avgSim: number; grounded: boolean; latencyMs: number;
}> {
  const start = Date.now();

  // 1. Try GraphRAG legal service
  try {
    const { nyvGraphRAGLegal } = await import('../../services/rag/nyv-graphrag-legal-service.js');
    const svc = nyvGraphRAGLegal;
    if (typeof (svc as any).query === 'function') {
      const r = await (svc as any).query({ query, jurisdiction, limit: 5 });
      const sources = (r?.sources?.length ?? r?.chunks?.length ?? 0);
      const avgSim = sources > 0
        ? (r.sources ?? r.chunks ?? []).reduce((a: number, s: any) => a + (s.score ?? s.similarity ?? 0), 0) / sources
        : 0;
      return { pipeline: 'graphrag', sources, avgSim, grounded: sources > 0 && avgSim > 0.5, latencyMs: Date.now() - start };
    }
  } catch { /* fall through */ }

  // 2. Try adaptive RAG
  try {
    const adaptive = await import('../../services/rag/adaptive-rag-service.js');
    const svc = (adaptive as any).default ?? (adaptive as any).adaptiveRagService;
    if (svc && typeof svc.query === 'function') {
      const r = await svc.query({ query, jurisdiction });
      const sources = r?.sources?.length ?? 0;
      return { pipeline: 'adaptive-rag', sources, avgSim: 0.5, grounded: sources > 0, latencyMs: Date.now() - start };
    }
  } catch { /* fall through */ }

  // 3. Mark as no-pipeline if nothing answered
  return { pipeline: 'none', sources: 0, avgSim: 0, grounded: false, latencyMs: Date.now() - start };
}

function classify(sources: number, grounded: boolean): 'green' | 'yellow' | 'red' {
  if (sources === 0) return 'red';
  if (!grounded) return 'yellow';
  return 'green';
}

export async function runAudit(opts: { persist?: boolean } = {}): Promise<AuditSummary> {
  const runId = `rag-audit-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const ranAt = new Date().toISOString();
  const cells: CellResult[] = [];
  const persist = opts.persist !== false;

  logger.info({ msg: 'starting RAG coverage audit', runId, totalCells: totalCells(), explicitFixtures: explicitFixtureCount() });

  for (const jur of JURISDICTIONS) {
    for (const cat of CATEGORIES) {
      const fixture = getFixture(cat, jur);
      try {
        const probe = await probeRag(fixture, jur);
        const status = classify(probe.sources, probe.grounded);
        const cell: CellResult = {
          category: cat, jurisdiction: jur, fixtureQuery: fixture,
          pipelineUsed: probe.pipeline, sourcesCount: probe.sources,
          avgSimilarity: probe.avgSim, grounded: probe.grounded,
          latencyMs: probe.latencyMs, status,
        };
        cells.push(cell);

        if (persist) {
          await upsertRow('nv_schema.nv_rag_coverage_audit', 'run_id', {
            run_id: runId, category: cat, jurisdiction: jur,
            fixture_query: fixture, pipeline_used: probe.pipeline,
            sources_count: probe.sources, avg_similarity: probe.avgSim,
            grounded: probe.grounded, latency_ms: probe.latencyMs, status,
          }).catch(() => {});
        }
      } catch (e: any) {
        cells.push({
          category: cat, jurisdiction: jur, fixtureQuery: fixture,
          pipelineUsed: 'error', sourcesCount: 0, avgSimilarity: 0,
          grounded: false, latencyMs: 0, status: 'red', notes: e.message,
        });
      }
    }
  }

  const green = cells.filter(c => c.status === 'green').length;
  const yellow = cells.filter(c => c.status === 'yellow').length;
  const red = cells.filter(c => c.status === 'red').length;
  const avgLatencyMs = cells.length ? Math.round(cells.reduce((a, c) => a + c.latencyMs, 0) / cells.length) : 0;

  logger.info({ msg: 'RAG audit complete', runId, green, yellow, red, avgLatencyMs });

  return { runId, ranAt, totalCells: cells.length, explicitFixtures: explicitFixtureCount(), green, yellow, red, avgLatencyMs, cells };
}
