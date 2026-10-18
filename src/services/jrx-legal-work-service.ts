/**
 * NV-LEGAL-WORK-001 — Async legal-work jobs backed by NYS retrieval +
 * Jurexio safety-ring LLM (NV-LLM-001). Replaces sync 20–90s NYS POST /runs
 * for SDK/Queen callers.
 *
 * Durability: in-memory hot cache + nv_schema.async_job_queue when DB available
 * (EDJ pattern). Restarts hydrate from DB; multi-instance safe for status reads.
 *
 * Flow:
 *   createLegalWorkRun → 202 { runId, status: queued }
 *   → background: NYS retrieve → Queen/safety-ring draft → store result
 *   evaluateLegalWorkRun → NYS evaluate (nysRunId) OR local rubric via safety ring
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import {
  isNysKnowledgeConfigured,
  nysKnowledgeRequest,
} from './jrx-nys-knowledge-client.js';
import { retrieveNysGlobalKnowledge } from './jrx-nys-knowledge-retriever.js';

const logger = createLogger('./jrx-legal-work-service');

export type LegalWorkStatus = 'queued' | 'working' | 'completed' | 'failed' | 'evaluated';

export type GroundingFallback = 'nys' | 'tenant_rag' | 'llm_only' | 'nys_runs';

export interface LegalWorkGroundingMeta {
  method?: string;
  chunkCount: number;
  layersUsed: string[];
  fallbackChain: GroundingFallback[];
  ungrounded: boolean;
  confidence?: number;
}

export interface LegalWorkRun {
  runId: string;
  status: LegalWorkStatus;
  instruction: string;
  context?: string;
  jurisdiction: string;
  taskId?: string;
  output?: string;
  authorities?: unknown;
  evaluation?: unknown;
  error?: string;
  /** Upstream NYS integer run id when generation fell back to POST /runs */
  nysRunId?: string | number;
  grounding?: LegalWorkGroundingMeta;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  orgId?: string;
}

const runs = new Map<string, LegalWorkRun>();
const JOB_TYPE = 'legal_work_run';

function touch(run: LegalWorkRun, patch: Partial<LegalWorkRun>): LegalWorkRun {
  const next = { ...run, ...patch, updatedAt: new Date().toISOString() };
  runs.set(run.runId, next);
  void persistRun(next).catch((e) =>
    logger.warn('legal-work persist failed (non-fatal)', { runId: run.runId, error: (e as Error).message }),
  );
  return next;
}

async function persistRun(run: LegalWorkRun): Promise<void> {
  try {
    const { db } = await import('../db/index.js');
    if (!db) throw new Error('db unavailable');
    const { sql } = await import('drizzle-orm');
    const status =
      run.status === 'working'
        ? 'running'
        : run.status === 'evaluated'
          ? 'completed'
          : run.status;
    await db.execute(sql`
      INSERT INTO nv_schema.async_job_queue (job_id, job_type, status, input, output, user_id, priority, created_at, updated_at)
      VALUES (
        ${run.runId},
        ${JOB_TYPE},
        ${status},
        ${JSON.stringify({
          instruction: run.instruction,
          context: run.context,
          jurisdiction: run.jurisdiction,
          taskId: run.taskId,
          userId: run.userId,
          orgId: run.orgId,
        })},
        ${JSON.stringify({
          status: run.status,
          output: run.output,
          authorities: run.authorities,
          evaluation: run.evaluation,
          error: run.error,
          nysRunId: run.nysRunId,
          grounding: run.grounding,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        })},
        ${run.userId || null},
        ${'normal'},
        ${run.createdAt}::timestamptz,
        NOW()
      )
      ON CONFLICT (job_id) DO UPDATE SET
        status = EXCLUDED.status,
        output = EXCLUDED.output,
        updated_at = NOW()
    `);
  } catch (e) {
    // Table may lack unique job_id in some envs — try UPDATE-only
    try {
      const { db } = await import('../db/index.js');
      if (!db) throw new Error('db unavailable');
      const { sql } = await import('drizzle-orm');
      const status =
        run.status === 'working'
          ? 'running'
          : run.status === 'evaluated'
            ? 'completed'
            : run.status;
      const updated = await db.execute(sql`
        UPDATE nv_schema.async_job_queue
        SET status = ${status},
            output = ${JSON.stringify({
              status: run.status,
              output: run.output,
              authorities: run.authorities,
              evaluation: run.evaluation,
              error: run.error,
              nysRunId: run.nysRunId,
              grounding: run.grounding,
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
            })},
            updated_at = NOW()
        WHERE job_id = ${run.runId}
      `);
      if ((updated as any).rowCount === 0) {
        await db.execute(sql`
          INSERT INTO nv_schema.async_job_queue (job_id, job_type, status, input, output, user_id, priority, created_at)
          VALUES (
            ${run.runId},
            ${JOB_TYPE},
            ${status},
            ${JSON.stringify({
              instruction: run.instruction,
              context: run.context,
              jurisdiction: run.jurisdiction,
              taskId: run.taskId,
            })},
            ${JSON.stringify({
              status: run.status,
              output: run.output,
              nysRunId: run.nysRunId,
              grounding: run.grounding,
            })},
            ${run.userId || null},
            ${'normal'},
            NOW()
          )
        `);
      }
    } catch (e2) {
      logger.warn('legal-work DB persist skipped', { error: (e2 as Error).message });
      throw e;
    }
  }
}

async function hydrateFromDb(runId: string): Promise<LegalWorkRun | undefined> {
  try {
    const { db } = await import('../db/index.js');
    if (!db) return undefined;
    const { sql } = await import('drizzle-orm');
    const result = await db.execute(sql`
      SELECT job_id, status, input, output, user_id, created_at
      FROM nv_schema.async_job_queue
      WHERE job_id = ${runId} AND job_type = ${JOB_TYPE}
      LIMIT 1
    `);
    const row = (result.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (!row) return undefined;
    const input = typeof row.input === 'string' ? JSON.parse(row.input as string) : (row.input as any) || {};
    const output = typeof row.output === 'string' ? JSON.parse(row.output as string) : (row.output as any) || {};
    const run: LegalWorkRun = {
      runId: String(row.job_id),
      status: (output.status || row.status || 'queued') as LegalWorkStatus,
      instruction: String(input.instruction || ''),
      context: input.context,
      jurisdiction: String(input.jurisdiction || 'IN'),
      taskId: input.taskId,
      output: output.output,
      authorities: output.authorities,
      evaluation: output.evaluation,
      error: output.error,
      nysRunId: output.nysRunId,
      grounding: output.grounding,
      createdAt: output.createdAt || (row.created_at ? new Date(row.created_at as string).toISOString() : new Date().toISOString()),
      updatedAt: output.updatedAt || new Date().toISOString(),
      userId: (row.user_id as string) || input.userId,
      orgId: input.orgId,
    };
    runs.set(run.runId, run);
    return run;
  } catch {
    return undefined;
  }
}

export function getLegalWorkRun(runId: string): LegalWorkRun | undefined {
  return runs.get(runId);
}

export async function getLegalWorkRunAsync(runId: string): Promise<LegalWorkRun | undefined> {
  return runs.get(runId) || (await hydrateFromDb(runId));
}

export function listLegalWorkRuns(limit = 50): LegalWorkRun[] {
  return Array.from(runs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

async function generateViaJrxSafetyRing(
  instruction: string,
  context: string,
  jurisdiction: string,
): Promise<string> {
  const { executeWithFullSafetyRingSimple } = await import(
    '../orchestration/jrx-sdk-orchestration-wrapper.js'
  );
  const prompt = [
    `Jurisdiction: ${jurisdiction}`,
    '§ RETRIEVAL ORDER: NYS (global public law) → tenant RAG/KB → matter memory → LLM synthesize only from context.',
    'Produce a professional legal work product. Cite only authorities present in the grounding context. Do not fabricate citations.',
    '',
    '=== GROUNDING CONTEXT (verified retrieval) ===',
    context.slice(0, 24_000),
    '',
    '=== INSTRUCTION ===',
    instruction,
  ].join('\n');
  return executeWithFullSafetyRingSimple(
    'You are a senior attorney producing grounded legal work products for Jurexio.',
    prompt,
    {
      jurisdiction,
      taskType: 'legal-work-draft',
      tier: 'pro',
      enableRAG: false, // already grounded via NYS
      sdkPlatform: 'legal-work',
    },
    4096,
  );
}

async function processRun(runId: string): Promise<void> {
  const run = runs.get(runId) || (await hydrateFromDb(runId));
  if (!run) return;
  touch(run, { status: 'working' });

  const fallbackChain: GroundingFallback[] = [];

  try {
    // Channel A grounding (NYS first)
    const nys = await retrieveNysGlobalKnowledge({
      query: run.instruction,
      jurisdiction: run.jurisdiction,
      topK: 8,
    });
    if (nys.chunks.length > 0) fallbackChain.push('nys');

    let tenantChunks: Array<{ title?: string; content: string }> = [];
    if (nys.chunks.length === 0) {
      // Tenant RAG second when NYS empty / CB open
      try {
        const { autoRagRetrieve } = await import('./jrx-auto-rag-router.js');
        // Temporarily rely on tenant layers only if NYS already empty
        const rag = await autoRagRetrieve({
          query: run.instruction,
          jurisdiction: run.jurisdiction,
          topK: 6,
          tier: 'pro',
          taskType: 'legal-work',
        });
        if (rag.chunks.length > 0) {
          fallbackChain.push('tenant_rag');
          tenantChunks = rag.chunks.map((c) => ({ title: c.title, content: c.content }));
        }
      } catch {
        /* fail-soft */
      }
    }

    const groundedPieces = [
      ...nys.chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.content}`),
      ...tenantChunks.map((c, i) => `[T${i + 1}] ${c.title || 'tenant'}\n${c.content}`),
    ];
    if (groundedPieces.length === 0) fallbackChain.push('llm_only');

    const contextBlock = [run.context || '', ...groundedPieces].filter(Boolean).join('\n\n');

    const grounding: LegalWorkGroundingMeta = {
      method: nys.method,
      chunkCount: nys.chunks.length + tenantChunks.length,
      layersUsed: [
        ...(nys.chunks.length > 0 ? ['nys_global'] : []),
        ...(tenantChunks.length > 0 ? ['tenant_rag'] : []),
      ],
      fallbackChain,
      ungrounded: groundedPieces.length === 0,
    };

    let output: string;
    let nysRunId: string | number | undefined;

    // Prefer JRX safety-ring generation (NV-LLM-001). Fallback to NYS /runs.
    try {
      output = await generateViaJrxSafetyRing(run.instruction, contextBlock, run.jurisdiction);
    } catch (e) {
      logger.warn('JRX safety-ring draft failed; falling back to NYS /runs', {
        error: (e as Error).message,
      });
      if (!isNysKnowledgeConfigured()) throw e;
      fallbackChain.push('nys_runs');
      const nysRun = await nysKnowledgeRequest<{
        id?: string | number;
        output?: string;
        authorities?: unknown;
      }>({
        method: 'POST',
        path: '/runs',
        body: {
          instruction: run.instruction,
          context: contextBlock.slice(0, 20_000),
          jurisdiction: run.jurisdiction,
          taskId: run.taskId,
        },
        timeoutMs: 120_000,
      });
      if (nysRun.ok === false) throw new Error(nysRun.error);
      const data = nysRun.data as any;
      nysRunId = data?.id ?? data?.runId;
      output = String(data?.output ?? data?.workProduct ?? '');
      touch(runs.get(runId)!, {
        authorities: data?.authorities ?? nys.chunks,
        nysRunId,
        grounding: { ...grounding, fallbackChain: [...fallbackChain] },
      });
    }

    touch(runs.get(runId)!, {
      status: 'completed',
      output,
      authorities: runs.get(runId)?.authorities ?? nys.chunks,
      nysRunId: nysRunId ?? runs.get(runId)?.nysRunId,
      grounding: { ...grounding, fallbackChain: [...fallbackChain] },
    });
  } catch (e) {
    logger.error('legal-work run failed', { runId, error: (e as Error).message });
    touch(runs.get(runId)!, {
      status: 'failed',
      error: (e as Error).message,
      grounding: {
        chunkCount: 0,
        layersUsed: [],
        fallbackChain: fallbackChain.length ? fallbackChain : ['llm_only'],
        ungrounded: true,
      },
    });
  }
}

export async function createLegalWorkRun(input: {
  instruction: string;
  context?: string;
  jurisdiction?: string;
  taskId?: string;
  userId?: string;
  orgId?: string;
}): Promise<LegalWorkRun> {
  if (!isJrxFeatureOn('nysKnowledgePlane')) {
    throw new Error('NYS knowledge plane flag is off');
  }
  const runId = `lw_${randomUUID()}`;
  const now = new Date().toISOString();
  const run: LegalWorkRun = {
    runId,
    status: 'queued',
    instruction: input.instruction,
    context: input.context,
    jurisdiction: (input.jurisdiction || 'IN').toUpperCase(),
    taskId: input.taskId,
    createdAt: now,
    updatedAt: now,
    userId: input.userId,
    orgId: input.orgId,
    grounding: {
      chunkCount: 0,
      layersUsed: [],
      fallbackChain: [],
      ungrounded: true,
    },
  };
  runs.set(runId, run);
  await persistRun(run).catch(() => undefined);

  // Prefer durable pg_jobs worker when available; always also schedule in-process
  try {
    const { jobQueue } = await import('./job-queue.js');
    await jobQueue.enqueue({
      queue: './jrx-legal-work',
      taskType: JOB_TYPE,
      payload: { runId },
      priority: 70,
      createdBy: input.userId,
      platform: 'legal-work',
    });
    jobQueue.registerHandler(JOB_TYPE, async (job) => {
      await processRun(String(job.payload.runId));
      return { runId: job.payload.runId };
    });
  } catch {
    /* pg_jobs may be unavailable locally */
  }

  setImmediate(() => {
    processRun(runId).catch((err) => {
      logger.error('legal-work background error', { runId, error: (err as Error).message });
    });
  });
  return run;
}

export async function evaluateLegalWorkRun(runId: string): Promise<LegalWorkRun> {
  const run = runs.get(runId) || (await hydrateFromDb(runId));
  if (!run) throw new Error('Run not found');
  if (run.status !== 'completed' && run.status !== 'evaluated') {
    throw new Error(`Run not ready for evaluation (status=${run.status})`);
  }

  // Prefer NYS evaluate when we have an upstream integer nysRunId
  if (isNysKnowledgeConfigured() && run.nysRunId != null) {
    const nysEval = await nysKnowledgeRequest({
      method: 'POST',
      path: `/runs/${encodeURIComponent(String(run.nysRunId))}/evaluate`,
      body: {},
      timeoutMs: 120_000,
    });
    if (nysEval.ok) {
      return touch(run, { status: 'evaluated', evaluation: nysEval.data });
    }
  }

  // Local rubric via safety ring (NV-LLM-001)
  try {
    const { executeWithFullSafetyRingSimple } = await import(
      '../orchestration/jrx-sdk-orchestration-wrapper.js'
    );
    const judge = await executeWithFullSafetyRingSimple(
      'You are a legal work-product judge. Return JSON: {score:0-100,passCount,totalCount,criteria:[{name,pass,rationale}]}',
      `Evaluate this work product against professional legal standards.\n\nINSTRUCTION:\n${run.instruction}\n\nOUTPUT:\n${(run.output || '').slice(0, 12_000)}`,
      {
        jurisdiction: run.jurisdiction,
        taskType: 'legal-work-evaluate',
        tier: 'pro',
        enableRAG: false,
        sdkPlatform: 'legal-work',
      },
      2048,
    );
    let evaluation: unknown = { raw: judge };
    try {
      const m = judge.match(/\{[\s\S]*\}/);
      if (m) evaluation = JSON.parse(m[0]);
    } catch {
      /* keep raw */
    }
    return touch(run, { status: 'evaluated', evaluation });
  } catch (e) {
    throw new Error(`Evaluation failed: ${(e as Error).message}`);
  }
}

/** Proxy catalog tasks from NYS. */
export async function listLegalWorkTasks(query: Record<string, string | undefined>) {
  const { q, search, ...rest } = query;
  return nysKnowledgeRequest({
    method: 'GET',
    path: '/tasks',
    query: {
      ...rest,
      search: search || q || undefined,
    },
  });
}

export async function getLegalWorkTask(id: string) {
  return nysKnowledgeRequest({
    method: 'GET',
    path: `/tasks/${encodeURIComponent(id)}`,
  });
}
