// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { createLogger } from '../../utils/logger.js';
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { nvMatterMemory, nvClientMemory, nvJurisdictionalMemory, nvPrecedentMemory } from '../../../shared/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { encryptedExpr, decryptedExpr } from '../field-encryption-service.js';
import { withTenantTx, type TenantTx } from '../../middleware/jrx-org-rls-middleware.js';

const logger = createLogger('./jrx-5tier-memory');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';
type LegalDomain = 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip' | 'family' | 'constitutional' | 'other';

export interface WorkingMemoryContext {
  traceId: string;
  entries: Map<string, unknown>;
  createdAt: Date;
}

export interface EpisodicEvent {
  type: string;
  content: string;
  agentId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface MatterMemoryInput {
  memoryType: 'interaction' | 'document' | 'decision' | 'research' | 'milestone';
  content: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface DomainInsight {
  key: string;
  value: string;
  confidence: number;
}

export interface PrecedentInput {
  caseId: string;
  citation: string;
  jurisdiction: string;
  court?: string;
  year?: number;
  principleOfLaw: string;
  headnote?: string;
  status?: string;
  overruledBy?: string;
  distinguishedIn?: string[];
  appliedIn?: string[];
  relevanceScore?: number;
  embeddingVector?: string;
  metadata?: Record<string, unknown>;
}

export interface ErasureReport {
  tiersProcessed: number;
  recordsDeleted: number;
  errors: string[];
}

/**
 * NV-MEM-TENANT-001 (durable tier) — matter/client memory is privileged client
 * material, so a read must present an owner. `matterId` alone is a routing key,
 * not an authorisation: anyone who learned a matter id could previously read the
 * whole matter's memory. Scope is a required argument so a caller cannot omit it.
 */
export interface DurableMemoryScope {
  userId?: string | number;
  orgId?: string | number;
}

function normalizeScopeId(value?: string | number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function tenantRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] })?.rows;
  return rows ?? [];
}

/**
 * NV-MEM-INSERT-FIX-001 — nv_matter_memory has FORCE RLS on org_id. Inserts and
 * reads that use the global pool without SET LOCAL app.current_org_id fail closed
 * (proven on jrx-staging: "new row violates row-level security policy").
 */
async function withMatterMemoryTenantTx<T>(
  scope: DurableMemoryScope,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const orgId = normalizeScopeId(scope.orgId);
  if (orgId === null || orgId <= 0) {
    throw new Error('[Nv5TierMemoryService] orgId required for RLS-scoped matter memory access');
  }
  return withTenantTx(String(orgId), fn);
}

export interface DeduplicationReport {
  totalBefore: number;
  totalAfter: number;
  duplicatesRemoved: number;
}

export class Nv5TierMemoryService {
  private static instance: Nv5TierMemoryService;
  private l1ContextMemory: Map<string, WorkingMemoryContext> = new Map();
  private l1EpisodicBuffer: Map<string, EpisodicEvent[]> = new Map();

  private constructor() {}

  static getInstance(): Nv5TierMemoryService {
    if (!Nv5TierMemoryService.instance) {
      Nv5TierMemoryService.instance = new Nv5TierMemoryService();
    }
    return Nv5TierMemoryService.instance;
  }

  getWorkingMemory(traceId: string): WorkingMemoryContext {
    if (!this.l1ContextMemory.has(traceId)) {
      this.l1ContextMemory.set(traceId, { traceId, entries: new Map(), createdAt: new Date() });
    }
    return this.l1ContextMemory.get(traceId)!;
  }

  setWorkingMemory(traceId: string, key: string, value: unknown): void {
    const ctx = this.getWorkingMemory(traceId);
    ctx.entries.set(key, value);
  }

  clearWorkingMemory(traceId: string): void {
    this.l1ContextMemory.delete(traceId);
  }

  async saveEpisodic(sessionId: string, event: EpisodicEvent): Promise<void> {
    if (!this.l1EpisodicBuffer.has(sessionId)) {
      this.l1EpisodicBuffer.set(sessionId, []);
    }
    const events = this.l1EpisodicBuffer.get(sessionId)!;
    events.push(event);

    if (events.length > 100) {
      events.splice(0, events.length - 100);
    }

    logger.info({ service: 'Nv5TierMemoryService', method: 'saveEpisodic', sessionId, eventType: event.type });
  }

  async getEpisodic(sessionId: string, limit: number = 20): Promise<EpisodicEvent[]> {
    const events = this.l1EpisodicBuffer.get(sessionId) || [];
    return events.slice(-limit);
  }

  async summarizeEpisodic(sessionId: string): Promise<string> {
    const events = await this.getEpisodic(sessionId, 50);
    if (events.length === 0) return 'No session history available.';

    const summary = events.map(e => `[${e.type}] ${e.content.substring(0, 100)}`).join('\n');
    return `Session ${sessionId} summary (${events.length} events):\n${summary}`;
  }

  async saveMatterMemory(
    matterId: string,
    userId: string,
    memory: MatterMemoryInput,
    scope: DurableMemoryScope = {},
  ): Promise<void> {
    const startTime = Date.now();
    const scopedUserId = normalizeScopeId(scope.userId) ?? normalizeScopeId(userId);
    const scopedOrgId = normalizeScopeId(scope.orgId);
    if (scopedUserId === null || scopedUserId <= 0) {
      logger.warn({
        service: 'Nv5TierMemoryService',
        method: 'saveMatterMemory',
        matterId,
        reason: 'refused-invalid-user-id',
        hint: 'resolvePartnerMemoryUserId / customerUserId before durable write',
      });
      return;
    }
    if (scopedOrgId === null || scopedOrgId <= 0) {
      logger.warn({
        service: 'Nv5TierMemoryService',
        method: 'saveMatterMemory',
        matterId,
        reason: 'refused-missing-org-id',
        hint: 'pass tenantId / sdkContext.customerOrgId in scope.orgId for RLS-bound durable write',
      });
      return;
    }
    try {
      // Task #29 — fail-closed field encryption. Both the plaintext insert and
      // the encrypted-companion UPDATE happen in a single transaction. If the
      // pgp_sym_encrypt mirror fails (missing key, pgcrypto not installed,
      // invalid bytea conversion, etc.) the transaction rolls back and NO
      // plaintext row is left behind. There is no log-and-continue path.
      //
      // NV-MEM-INSERT-FIX-001 — the same transaction must SET LOCAL
      // app.current_org_id or FORCE RLS rejects the INSERT before content_enc runs.
      if (!db) throw new Error('[Nv5TierMemoryService] db handle missing');
      await withMatterMemoryTenantTx({ orgId: scopedOrgId }, async (tx) => {
        const inserted = await tx.execute(sql`
          INSERT INTO nv_matter_memory (
            matter_id, user_id, org_id, memory_type, content, importance, metadata
          ) VALUES (
            ${matterId},
            ${scopedUserId},
            ${scopedOrgId},
            ${memory.memoryType},
            ${memory.content},
            ${memory.importance || 0.5},
            ${JSON.stringify(memory.metadata || {})}::jsonb
          )
          RETURNING id
        `);
        const id = tenantRows(inserted)[0]?.id;
        if (id === undefined || id === null) {
          throw new Error('[FieldEnc] saveMatterMemory: insert returned no id; aborting transaction');
        }
        await tx.execute(sql`
          UPDATE nv_matter_memory
          SET content_enc = ${encryptedExpr(memory.content)}
          WHERE id = ${id}
        `);
      });

      logger.info({
        service: 'Nv5TierMemoryService',
        method: 'saveMatterMemory',
        matterId,
        memoryType: memory.memoryType,
        durationMs: Date.now() - startTime,
      });
    } catch (error: any) {
      logger.error({
        service: 'Nv5TierMemoryService',
        method: 'saveMatterMemory',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
    }
  }

  async getMatterMemory(
    matterId: string,
    scope: DurableMemoryScope,
    limit: number = 20,
  ): Promise<any[]> {
    const userId = normalizeScopeId(scope?.userId);
    const orgId = normalizeScopeId(scope?.orgId);
    if (userId === null && orgId === null) {
      // Fail closed: an un-scoped matter read is a cross-tenant read.
      logger.warn({
        service: 'Nv5TierMemoryService',
        method: 'getMatterMemory',
        matterId,
        reason: 'refused-unscoped-read',
      });
      return [];
    }
    if (orgId === null || orgId <= 0) {
      logger.warn({
        service: 'Nv5TierMemoryService',
        method: 'getMatterMemory',
        matterId,
        reason: 'refused-missing-org-id',
      });
      return [];
    }

    try {
      // Field-level encryption (Task #29 deliverable #3): decrypt-on-read.
      // NV-MEM-INSERT-FIX-001 — reads must run inside the same org RLS binding
      // as writes or FORCE RLS returns zero rows.
      return await withMatterMemoryTenantTx({ orgId }, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT id,
                 matter_id    AS "matterId",
                 user_id      AS "userId",
                 memory_type  AS "memoryType",
                 COALESCE(${decryptedExpr('content_enc')}, content) AS content,
                 importance,
                 metadata,
                 created_at   AS "createdAt"
          FROM nv_matter_memory
          WHERE matter_id = ${matterId}
            AND (
              (${userId}::int IS NOT NULL AND user_id = ${userId}::int)
              OR (${orgId}::int IS NOT NULL AND org_id = ${orgId}::int)
            )
          ORDER BY created_at DESC
          LIMIT ${limit}
        `);
        return tenantRows(rows);
      });
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'getMatterMemory', error: (error as Error).message });
      // Safe fallback: plaintext-only read if decrypt fails (e.g., key not
      // loaded). The owner predicate is preserved — a decrypt failure must not
      // widen the read.
      try {
        return await withMatterMemoryTenantTx({ orgId }, async (tx) => {
          const fallback = await tx.execute(sql`
            SELECT id,
                   matter_id    AS "matterId",
                   user_id      AS "userId",
                   memory_type  AS "memoryType",
                   content,
                   importance,
                   metadata,
                   created_at   AS "createdAt"
            FROM nv_matter_memory
            WHERE matter_id = ${matterId}
              AND (
                (${userId}::int IS NOT NULL AND user_id = ${userId}::int)
                OR org_id = ${orgId}::int
              )
            ORDER BY created_at DESC
            LIMIT ${limit}
          `);
          return tenantRows(fallback);
        });
      } catch {
        return [];
      }
    }
  }

  async saveClientMemory(
    clientId: string,
    attribute: string,
    value: string,
    confidence: number,
    matterIds: string[],
    scope: DurableMemoryScope = {},
  ): Promise<void> {
    try {
      await db.insert(nvClientMemory).values({
        clientId,
        // Owner was never persisted, so no scoped read of this tier could ever
        // succeed — the column existed but stayed null on every insert.
        userId: normalizeScopeId(scope.userId),
        attribute,
        value,
        confidence,
        evidenceMatterIds: matterIds,
      });
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'saveClientMemory', error: (error as Error).message });
    }
  }

  async getClientMemory(clientId: string, scope: DurableMemoryScope, attributes?: string[]): Promise<any[]> {
    const userId = normalizeScopeId(scope?.userId);
    if (userId === null) {
      logger.warn({
        service: 'Nv5TierMemoryService',
        method: 'getClientMemory',
        clientId,
        reason: 'refused-unscoped-read',
      });
      return [];
    }
    try {
      const results = await db.select()
        .from(nvClientMemory)
        .where(and(eq(nvClientMemory.clientId, clientId), eq(nvClientMemory.userId, userId)))
        .orderBy(desc(nvClientMemory.lastUpdated))
        .limit(50);
      if (attributes) {
        return results.filter(r => attributes.includes(r.attribute));
      }
      return results;
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'getClientMemory', error: (error as Error).message });
      return [];
    }
  }

  async updateClientMemoryConfidence(id: number, newConfidence: number): Promise<void> {
    try {
      await db.update(nvClientMemory)
        .set({ confidence: newConfidence, updatedAt: new Date() })
        .where(eq(nvClientMemory.id, id));
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'updateClientMemoryConfidence', error: (error as Error).message });
    }
  }

  async saveJurisdictionalMemory(jurisdiction: JurisdictionCode, domain: LegalDomain, insight: DomainInsight, source?: string, userId?: number): Promise<void> {
    try {
      await db.insert(nvJurisdictionalMemory).values({
        jurisdiction,
        domain,
        insightKey: insight.key,
        insightValue: insight.value,
        confidence: insight.confidence,
        source: source || 'system',
        userId: userId || null,
        metadata: {},
      });
      logger.info({ service: 'Nv5TierMemoryService', method: 'saveJurisdictionalMemory', jurisdiction, domain, key: insight.key });
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'saveJurisdictionalMemory', error: (error as Error).message });
    }
  }

  async getJurisdictionalMemory(jurisdiction: JurisdictionCode, domain?: LegalDomain, limit: number = 50): Promise<any[]> {
    try {
      const conditions = domain
        ? and(eq(nvJurisdictionalMemory.jurisdiction, jurisdiction), eq(nvJurisdictionalMemory.domain, domain))
        : eq(nvJurisdictionalMemory.jurisdiction, jurisdiction);
      const results = await db.select()
        .from(nvJurisdictionalMemory)
        .where(conditions)
        .orderBy(desc(nvJurisdictionalMemory.lastUpdated))
        .limit(limit);
      return results;
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'getJurisdictionalMemory', error: (error as Error).message });
      return [];
    }
  }

  async savePrecedentMemory(precedent: PrecedentInput, userId?: number): Promise<void> {
    try {
      await db.insert(nvPrecedentMemory).values({
        caseId: precedent.caseId,
        citation: precedent.citation,
        jurisdiction: precedent.jurisdiction,
        court: precedent.court || null,
        year: precedent.year || null,
        principleOfLaw: precedent.principleOfLaw,
        headnote: precedent.headnote || null,
        status: precedent.status || 'active',
        overruledBy: precedent.overruledBy || null,
        distinguishedIn: precedent.distinguishedIn || [],
        appliedIn: precedent.appliedIn || [],
        relevanceScore: precedent.relevanceScore || 0.5,
        embeddingVector: precedent.embeddingVector || null,
        userId: userId || null,
        metadata: precedent.metadata || {},
      });
      logger.info({ service: 'Nv5TierMemoryService', method: 'savePrecedentMemory', caseId: precedent.caseId, citation: precedent.citation });
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'savePrecedentMemory', error: (error as Error).message });
    }
  }

  async getPrecedentMemory(jurisdiction: string, limit: number = 20): Promise<any[]> {
    try {
      const results = await db.select()
        .from(nvPrecedentMemory)
        .where(eq(nvPrecedentMemory.jurisdiction, jurisdiction))
        .orderBy(desc(nvPrecedentMemory.updatedAt))
        .limit(limit);
      return results;
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'getPrecedentMemory', error: (error as Error).message });
      return [];
    }
  }

  async findPrecedentByCitation(citation: string): Promise<any | null> {
    try {
      const results = await db.select()
        .from(nvPrecedentMemory)
        .where(eq(nvPrecedentMemory.citation, citation))
        .limit(1);
      return results[0] || null;
    } catch (error: any) {
      logger.error({ service: 'Nv5TierMemoryService', method: 'findPrecedentByCitation', error: (error as Error).message });
      return null;
    }
  }

  async eraseUserData(userId: string): Promise<ErasureReport> {
    let recordsDeleted = 0;
    const errors: string[] = [];

    try {
      this.l1ContextMemory.clear();
      recordsDeleted += 1;
    } catch (e: any) {
      errors.push(`L1 erasure failed: ${(e as Error).message}`);
    }

    try {
      this.l1EpisodicBuffer.clear();
      recordsDeleted += 1;
    } catch (e: any) {
      errors.push(`L1 episodic erasure failed: ${(e as Error).message}`);
    }

    try {
      const userIdNum = parseInt(userId);
      if (!isNaN(userIdNum)) {
        await db.delete(nvMatterMemory).where(eq(nvMatterMemory.userId, userIdNum));
        recordsDeleted += 1;
      }
    } catch (e: any) {
      errors.push(`L2 matter erasure failed: ${(e as Error).message}`);
    }

    try {
      const userIdNum = parseInt(userId);
      if (!isNaN(userIdNum)) {
        await db.delete(nvClientMemory).where(eq(nvClientMemory.userId, userIdNum));
        recordsDeleted += 1;
      }
    } catch (e: any) {
      errors.push(`L3 client erasure failed: ${(e as Error).message}`);
    }

    try {
      const userIdNum = parseInt(userId);
      if (!isNaN(userIdNum)) {
        await db.delete(nvJurisdictionalMemory).where(eq(nvJurisdictionalMemory.userId, userIdNum));
        recordsDeleted += 1;
      }
    } catch (e: any) {
      errors.push(`L4 jurisdictional erasure failed: ${(e as Error).message}`);
    }

    try {
      const userIdNum = parseInt(userId);
      if (!isNaN(userIdNum)) {
        await db.delete(nvPrecedentMemory).where(eq(nvPrecedentMemory.userId, userIdNum));
        recordsDeleted += 1;
      }
    } catch (e: any) {
      errors.push(`L5 precedent erasure failed: ${(e as Error).message}`);
    }

    logger.info({
      service: 'Nv5TierMemoryService',
      method: 'eraseUserData',
      userId,
      tiersProcessed: 5,
      recordsDeleted,
      errors: errors.length,
    });

    return { tiersProcessed: 5, recordsDeleted, errors };
  }

  async compressEpisodicToMatter(sessionId: string, matterId: string, userId: string): Promise<void> {
    const events = await this.getEpisodic(sessionId);
    if (events.length === 0) return;

    const summary = events.map(e => e.content).join(' | ').substring(0, 2000);
    // Previously written with userId '0', which orphaned the row from every
    // scoped read.
    await this.saveMatterMemory(matterId, userId, {
      memoryType: 'interaction',
      content: `[Compressed from session ${sessionId}] ${summary}`,
      importance: 0.3,
    });

    this.l1EpisodicBuffer.delete(sessionId);
  }

  async deduplicateMatterMemory(matterId: string, scope: DurableMemoryScope): Promise<DeduplicationReport> {
    const memories = await this.getMatterMemory(matterId, scope, 1000);
    const seen = new Set<string>();
    const duplicateIds: number[] = [];

    for (const m of memories) {
      const key = `${m.memoryType}:${m.content.substring(0, 100)}`;
      if (seen.has(key)) {
        duplicateIds.push(m.id);
      } else {
        seen.add(key);
      }
    }

    for (const id of duplicateIds) {
      try {
        await db.delete(nvMatterMemory).where(eq(nvMatterMemory.id, id));
      } catch {
      }
    }

    return {
      totalBefore: memories.length,
      totalAfter: memories.length - duplicateIds.length,
      duplicatesRemoved: duplicateIds.length,
    };
  }
}

export const nv5TierMemoryService = Nv5TierMemoryService.getInstance();
