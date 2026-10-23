// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — Case Update Service
 * JRX-SVC-CASEUPDATE-001
 *
 * Handover §5.2 — 6 update types with 24-hour edit lock.
 *
 * Update types: HEARING | FILING | DOCUMENT | COMMUNICATION | TASK | NOTE
 * 24h lock: Once a case update is 24 hours old, it cannot be modified or deleted.
 *           Only a supervising partner (enterprise role) can override the lock.
 */

import crypto from 'crypto';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-case-update');

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type CaseUpdateType = 'HEARING' | 'FILING' | 'DOCUMENT' | 'COMMUNICATION' | 'TASK' | 'NOTE';

export interface CaseUpdate {
  update_id: string;
  case_id: string;
  user_id: string;
  update_type: CaseUpdateType;
  title: string;
  description: string;
  metadata: Record<string, any>;
  locked: boolean;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUpdateInput {
  case_id: string;
  update_type: CaseUpdateType;
  title: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface UpdateInput {
  title?: string;
  description?: string;
  metadata?: Record<string, any>;
}

// ─────────────────────────────────────────
// Update type metadata (descriptions, icons, colours)
// ─────────────────────────────────────────

export const UPDATE_TYPE_META: Record<CaseUpdateType, { label: string; description: string; icon: string; colour: string }> = {
  HEARING: {
    label: 'Hearing',
    description: 'Court hearing, adjournment, order date, or hearing notes',
    icon: '⚖️',
    colour: '#4F46E5',
  },
  FILING: {
    label: 'Filing',
    description: 'Court filings, submissions, plaints, written statements, replies',
    icon: '📋',
    colour: '#0891B2',
  },
  DOCUMENT: {
    label: 'Document',
    description: 'Documents received, sent, or attached to the case',
    icon: '📄',
    colour: '#059669',
  },
  COMMUNICATION: {
    label: 'Communication',
    description: 'Client communications, opposing counsel, court correspondence',
    icon: '💬',
    colour: '#D97706',
  },
  TASK: {
    label: 'Task',
    description: 'Action items, deadlines, research tasks, to-do items',
    icon: '✅',
    colour: '#7C3AED',
  },
  NOTE: {
    label: 'Note',
    description: 'General notes, observations, strategy notes, reminders',
    icon: '📝',
    colour: '#6B7280',
  },
};

const LOCK_HOURS = 24;

// ─────────────────────────────────────────
// Case Update Service
// ─────────────────────────────────────────

export class CaseUpdateService {
  /**
   * Create a new case update.
   */
  async createUpdate(userId: string, input: CreateUpdateInput): Promise<CaseUpdate> {
    const updateId = crypto.randomUUID();
    const validTypes: CaseUpdateType[] = ['HEARING', 'FILING', 'DOCUMENT', 'COMMUNICATION', 'TASK', 'NOTE'];
    if (!validTypes.includes(input.update_type)) {
      throw new Error(`Invalid update_type: ${input.update_type}. Must be one of: ${validTypes.join(', ')}`);
    }
    if (!input.title?.trim()) throw new Error('title is required');
    if (!input.case_id?.trim()) throw new Error('case_id is required');

    const meta = JSON.stringify(input.metadata || {});

    // §4.2 MANDATORY — compute SHA-256 hash_signature for tamper-evidence
    const hashPayload = `${updateId}:${input.case_id}:${userId}:${input.update_type}:${input.title}:${input.description || ''}`;
    const hashSignature = crypto.createHash('sha256').update(hashPayload).digest('hex');

    await db.execute(sql`
      INSERT INTO nv_schema.case_updates
        (update_id, case_id, user_id, update_type, title, description, metadata, locked, created_at, updated_at,
         hash_signature, is_billable, is_client_visible, confidential_level, record_status)
      VALUES
        (${updateId}::uuid, ${input.case_id}, ${userId},
         ${input.update_type}::nv_schema.case_update_type,
         ${input.title}, ${input.description || ''}, ${meta}::jsonb,
         FALSE, NOW(), NOW(),
         ${hashSignature}, FALSE, TRUE, 'TEAM_VISIBLE', 'active')
    `);

    logger.info('Case update created', { updateId, caseId: input.case_id, type: input.update_type, hashSignature: hashSignature.substring(0, 16) + '...' });
    return this.getUpdate(updateId);
  }

  /**
   * Get a single case update.
   */
  async getUpdate(updateId: string): Promise<CaseUpdate> {
    const rows = await db.execute(sql`
      SELECT update_id, case_id, user_id, update_type::text, title, description,
             metadata, locked, locked_at, created_at, updated_at
      FROM nv_schema.case_updates WHERE update_id = ${updateId}::uuid LIMIT 1
    `);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
    if (!(rows as any[]).length) throw new Error(`Case update not found: ${updateId}`);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
    return this._mapRow((rows as any[])[0]);
  }

  /**
   * List all updates for a case.
   */
  async listByCaseId(caseId: string, type?: CaseUpdateType, limit = 50, offset = 0): Promise<CaseUpdate[]> {
    let rows: any[];
    if (type) {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
      rows = await db.execute(sql`
        SELECT update_id, case_id, user_id, update_type::text, title, description,
               metadata, locked, locked_at, created_at, updated_at
        FROM nv_schema.case_updates
        WHERE case_id = ${caseId} AND update_type = ${type}::nv_schema.case_update_type
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `) as any[];
    } else {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
      rows = await db.execute(sql`
        SELECT update_id, case_id, user_id, update_type::text, title, description,
               metadata, locked, locked_at, created_at, updated_at
        FROM nv_schema.case_updates
        WHERE case_id = ${caseId}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `) as any[];
    }
    return (rows as any[]).map(r => this._mapRow(r));
  }

  /**
   * Update a case update. Returns error if locked (>24h old).
   */
  async editUpdate(
    updateId: string,
    userId: string,
    input: UpdateInput,
    isSupervisor = false
  ): Promise<CaseUpdate> {
    const existing = await this.getUpdate(updateId);

    // Check ownership
    if (existing.user_id !== userId && !isSupervisor) {
      throw new Error('You do not own this case update');
    }

    // Check 24h lock
    const ageHours = (Date.now() - new Date(existing.created_at).getTime()) / 3_600_000;
    if (ageHours >= LOCK_HOURS && !isSupervisor) {
      throw new Error(`Case update is locked (${LOCK_HOURS}h lock). Only a supervising partner can override.`);
    }
    if (existing.locked && !isSupervisor) {
      throw new Error('Case update is locked and cannot be modified');
    }

    // Apply updates
    const newTitle = input.title ?? existing.title;
    const newDesc = input.description ?? existing.description;
    const newMeta = JSON.stringify(input.metadata ?? existing.metadata);

    await db.execute(sql`
      UPDATE nv_schema.case_updates
      SET title = ${newTitle}, description = ${newDesc}, metadata = ${newMeta}::jsonb,
          updated_at = NOW()
      WHERE update_id = ${updateId}::uuid
    `);

    return this.getUpdate(updateId);
  }

  /**
   * Delete a case update. Returns error if locked (>24h old).
   */
  async deleteUpdate(updateId: string, userId: string, isSupervisor = false): Promise<void> {
    const existing = await this.getUpdate(updateId);
    if (existing.user_id !== userId && !isSupervisor) throw new Error('You do not own this case update');
    const ageHours = (Date.now() - new Date(existing.created_at).getTime()) / 3_600_000;
    if (ageHours >= LOCK_HOURS && !isSupervisor) {
      throw new Error(`Case update is locked (${LOCK_HOURS}h lock). Cannot delete.`);
    }
    await db.execute(sql`DELETE FROM nv_schema.case_updates WHERE update_id = ${updateId}::uuid`);
    logger.info('Case update deleted', { updateId });
  }

  /**
   * Lock all updates older than 24h (background job).
   */
  async lockExpiredUpdates(): Promise<number> {
    const result = await db.execute(sql`
      UPDATE nv_schema.case_updates
      SET locked = TRUE, locked_at = NOW()
      WHERE locked = FALSE
        AND created_at < NOW() - INTERVAL '24 hours'
      RETURNING update_id
    `);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
    const count = (result as any[]).length;
    if (count > 0) logger.info(`Locked ${count} expired case updates`);
    return count;
  }

  private _mapRow(r: any): CaseUpdate {
    return {
      update_id: r.update_id,
      case_id: r.case_id,
      user_id: r.user_id,
      update_type: r.update_type as CaseUpdateType,
      title: r.title,
      description: r.description || '',
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {},
      locked: r.locked,
      locked_at: r.locked_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }
}

export const caseUpdateService = new CaseUpdateService();
