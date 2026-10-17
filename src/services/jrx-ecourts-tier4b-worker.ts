/**
 * NV-ECOURTS-TIER4B-WORKER-001 — async portal fetch jobs (Option C).
 *
 * In-memory job store for spike; production should move to Redis/BullMQ.
 * Keeps gateway resolve under 23s — POST returns jobId, GET polls result.
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import type { CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';
import {
  attemptEcourtsPortalFetch,
  isEcourtsPortalFetchEnabled,
} from './jrx-ecourts-portal-fetch.js';

const logger = createLogger('./jrx-ecourts-tier4b-worker');

export type Tier4bJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type Tier4bJob = {
  jobId: string;
  status: Tier4bJobStatus;
  cnr: string | null;
  diaryNumber: string | null;
  createdAt: string;
  updatedAt: string;
  result: CnrResolveData | null;
  error: string | null;
  sourcesTried: string[];
};

const jobs = new Map<string, Tier4bJob>();
const MAX_JOBS = 500;
const JOB_TTL_MS = 60 * 60 * 1000;

function pruneExpiredJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) {
      jobs.delete(id);
    }
  }
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.entries()].sort(
    (a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime(),
  );
  while (jobs.size > MAX_JOBS && sorted.length > 0) {
    const oldest = sorted.shift();
    if (oldest) jobs.delete(oldest[0]);
  }
}

async function runPortalJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = 'running';
  job.updatedAt = new Date().toISOString();

  try {
    const attempt = await attemptEcourtsPortalFetch({
      cnr: job.cnr ?? undefined,
      diaryNumber: job.diaryNumber ?? undefined,
    });

    if (attempt.kind === 'found') {
      job.status = 'completed';
      job.result = attempt.data;
      job.sourcesTried = attempt.data.sourcesTried ?? [];
    } else if (attempt.kind === 'attempted') {
      job.status = 'failed';
      job.error = attempt.reason;
      job.sourcesTried = [attempt.tag];
    } else {
      job.status = 'failed';
      job.error = 'Portal fetch skipped — flag off or invalid input';
      job.sourcesTried = [];
    }
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    logger.warn('[CNR] tier4b job failed', { jobId, errorLen: job.error.length });
  }

  job.updatedAt = new Date().toISOString();
}

/** Enqueue async portal fetch — returns immediately (non-blocking for gateway). */
export function enqueueEcourtsPortalJob(input: {
  cnr?: string;
  diaryNumber?: string;
}): { jobId: string } | null {
  if (!isEcourtsPortalFetchEnabled()) return null;

  pruneExpiredJobs();
  const jobId = randomUUID();
  const now = new Date().toISOString();

  jobs.set(jobId, {
    jobId,
    status: 'queued',
    cnr: input.cnr ?? null,
    diaryNumber: input.diaryNumber ?? null,
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null,
    sourcesTried: [],
  });

  setImmediate(() => {
    void runPortalJob(jobId);
  });

  return { jobId };
}

export function getEcourtsPortalJob(jobId: string): Tier4bJob | null {
  return jobs.get(jobId) ?? null;
}

/** Test hook — clear in-memory store. */
export function clearEcourtsPortalJobsForTests(): void {
  jobs.clear();
}
