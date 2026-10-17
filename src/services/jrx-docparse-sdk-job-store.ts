/**
 * NV-DOCPARSE-JOBS-001 — Redis-backed docparse SDK job records (NV-SECRETS-001: no file bytes in logs).
 */
import type { DocparseJobRecord } from '@jurexio/docparse-sdk';
import { nvRedisCache } from './jrx-redis-cache-service.js';

const KEY_PREFIX = 'nv:docparse-sdk:job:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function key(jobId: string): string {
  return `${KEY_PREFIX}${jobId}`;
}

export async function saveDocparseSdkJobRecord(rec: DocparseJobRecord): Promise<void> {
  await nvRedisCache.set(key(rec.jobId), rec, TTL_MS);
}

export async function loadDocparseSdkJobRecord(jobId: string): Promise<DocparseJobRecord | undefined> {
  const rec = await nvRedisCache.get<DocparseJobRecord>(key(jobId));
  return rec ?? undefined;
}
