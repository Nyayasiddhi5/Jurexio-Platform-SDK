/**
 * NV-PATRA-MITRA-PG-001 — durable Patra Mitra session backing store.
 * Hot Map cache in nv-patra-mitra-service.ts; Postgres is source of truth across restarts.
 */
import { sql } from 'drizzle-orm';
import { db as _rawDb } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { createLogger } from '../utils/logger.js';
import type { PatraMitraSession } from './jrx-patra-mitra-service.js';

const db = lazyRequire(() => _rawDb, 'db');
const logger = createLogger('./jrx-patra-mitra-store');

function sessionToPayload(session: PatraMitraSession): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    orgId: session.orgId,
    platformCode: session.platformCode,
    fileName: session.fileName,
    mimeType: session.mimeType,
    jurisdiction: session.jurisdiction,
    extractionMethod: session.extractionMethod,
    format: session.format,
    warnings: session.warnings,
    text: session.text,
    textPreview: session.textPreview,
    characterCount: session.characterCount,
    wordCount: session.wordCount,
    fields: session.fields,
    summary: session.summary,
    keyPoints: session.keyPoints,
    documentType: session.documentType,
    detectedLanguage: session.detectedLanguage,
    languageLabel: session.languageLabel,
    chat: session.chat,
    toolRuns: session.toolRuns ?? [],
    extractionPath: session.extractionPath,
    docparseMeta: session.docparseMeta,
    tables: session.tables,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
  };
}

function payloadToSession(payload: Record<string, unknown>): PatraMitraSession {
  return {
    sessionId: String(payload.sessionId),
    orgId: payload.orgId != null ? String(payload.orgId) : undefined,
    platformCode: payload.platformCode != null ? String(payload.platformCode) : undefined,
    fileName: String(payload.fileName || 'document.pdf'),
    mimeType: payload.mimeType != null ? String(payload.mimeType) : undefined,
    jurisdiction: String(payload.jurisdiction || 'IN'),
    extractionMethod: String(payload.extractionMethod || 'unknown'),
    format: String(payload.format || 'text'),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
    text: String(payload.text || ''),
    textPreview: String(payload.textPreview || ''),
    characterCount: Number(payload.characterCount || 0),
    wordCount: Number(payload.wordCount || 0),
    fields: Array.isArray(payload.fields) ? payload.fields as PatraMitraSession['fields'] : [],
    summary: String(payload.summary || ''),
    keyPoints: Array.isArray(payload.keyPoints) ? payload.keyPoints.map(String) : [],
    documentType: payload.documentType != null ? String(payload.documentType) : undefined,
    detectedLanguage: payload.detectedLanguage != null ? String(payload.detectedLanguage) : undefined,
    languageLabel: payload.languageLabel != null ? String(payload.languageLabel) : undefined,
    chat: Array.isArray(payload.chat) ? payload.chat as PatraMitraSession['chat'] : [],
    toolRuns: Array.isArray(payload.toolRuns) ? payload.toolRuns as PatraMitraSession['toolRuns'] : [],
    extractionPath: payload.extractionPath != null ? String(payload.extractionPath) : null,
    docparseMeta: (payload.docparseMeta as Record<string, unknown>) ?? null,
    tables: Array.isArray(payload.tables) ? payload.tables as PatraMitraSession['tables'] : [],
    createdAt: String(payload.createdAt || new Date().toISOString()),
    updatedAt: String(payload.updatedAt || new Date().toISOString()),
    expiresAt: Number(payload.expiresAt || Date.now() + 7_200_000),
  };
}

export async function persistPatraMitraSession(session: PatraMitraSession): Promise<void> {
  try {
    const payload = sessionToPayload(session);
    await db.execute(sql`
      INSERT INTO nv_schema.nv_patra_mitra_sessions
        (session_id, org_id, platform_code, payload, expires_at, created_at, updated_at)
      VALUES (
        ${session.sessionId},
        ${session.orgId ?? null},
        ${session.platformCode ?? null},
        ${JSON.stringify(payload)}::jsonb,
        to_timestamp(${Math.floor(session.expiresAt / 1000)}),
        NOW(),
        NOW()
      )
      ON CONFLICT (session_id) DO UPDATE SET
        org_id = EXCLUDED.org_id,
        platform_code = EXCLUDED.platform_code,
        payload = EXCLUDED.payload,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
    `);
  } catch (err: unknown) {
    logger.warn('[PatraMitra] session persist failed (non-fatal)', {
      sessionId: session.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function loadPatraMitraSession(sessionId: string): Promise<PatraMitraSession | null> {
  try {
    const row = await db.execute(sql`
      SELECT payload, expires_at
      FROM nv_schema.nv_patra_mitra_sessions
      WHERE session_id = ${sessionId}
      LIMIT 1
    `);
    const rec = row.rows?.[0] as { payload?: unknown; expires_at?: Date | string } | undefined;
    if (!rec?.payload || typeof rec.payload !== 'object') return null;
    const session = payloadToSession(rec.payload as Record<string, unknown>);
    if (session.expiresAt < Date.now()) {
      await deletePatraMitraSession(sessionId).catch(() => undefined);
      return null;
    }
    return session;
  } catch (err: unknown) {
    logger.warn('[PatraMitra] session load failed', {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function deletePatraMitraSession(sessionId: string): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM nv_schema.nv_patra_mitra_sessions WHERE session_id = ${sessionId}
    `);
  } catch {
    /* best-effort */
  }
}

export async function listPatraMitraSessionsFromDb(limit = 50): Promise<PatraMitraSession[]> {
  try {
    const row = await db.execute(sql`
      SELECT payload, expires_at
      FROM nv_schema.nv_patra_mitra_sessions
      WHERE expires_at > NOW()
      ORDER BY updated_at DESC
      LIMIT ${Math.min(100, Math.max(1, limit))}
    `);
    const out: PatraMitraSession[] = [];
    for (const r of row.rows ?? []) {
      const rec = r as { payload?: unknown };
      if (rec.payload && typeof rec.payload === 'object') {
        out.push(payloadToSession(rec.payload as Record<string, unknown>));
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function pruneExpiredPatraMitraSessions(): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM nv_schema.nv_patra_mitra_sessions WHERE expires_at <= NOW()
    `);
  } catch {
    /* best-effort */
  }
}
