/**
 * IL BIPA 740 ILCS 14/15 — Biometric Information Privacy Act consent service.
 *
 * Implements the §15(b) "written, informed consent before biometric collection"
 * contract that POL-US-BIPA-740-14-15 (nv-policy-engine.ts) declares but does
 * NOT enforce. Pairs with `nv-bipa-consent-gate.ts` (the Express middleware
 * that blocks capture pre-flight) and `nv-bipa-consent-routes.ts` (the
 * Console + SDK surface).
 *
 * Why a dedicated table (vs. reusing nv_consent_records / `biometric` purpose):
 *   - BIPA §15(b) demands a STRONGER artefact than DPDPA §9 — a written
 *     disclosure, the specific biometric identifier, the storage purpose
 *     and term, and the data-subject's signature (or signed e-record).
 *     Dropping these into the generic consent table would either lose the
 *     evidence (no signature column) or pollute every other purpose row
 *     with nullable BIPA fields.
 *   - §15(a) destruction has its own lifecycle (revocation triggers a
 *     destruction worker run, recorded as `destroyed_at`) which the
 *     generic withdraw flow does not model.
 *   - Per-scan accrual under Cothron v. White Castle requires every grant
 *     / revoke / destruction event to be independently auditable via
 *     nv_audit_logs — the dedicated service centralises that emission.
 *
 * @module nv-bipa-consent-service
 */
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
import { sql } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { writeCamActionAsync, camActionId } from './jrx-cam-writer.js';
import { appendAuditRecord, AuditChainBrokenError } from '../../middleware/jrx-sdk-tracking-middleware.js';

const db = lazyRequire(() => _raw_db, 'db');
const logger = createLogger('./jrx-bipa-consent');

/** Biometric identifier types tracked by BIPA §10. */
export type BipaBiometricType =
  | 'voiceprint'
  | 'facial_geometry'
  | 'fingerprint'
  | 'iris_scan'
  | 'retina_scan'
  | 'hand_scan';

export const BIPA_BIOMETRIC_TYPES: readonly BipaBiometricType[] = [
  'voiceprint', 'facial_geometry', 'fingerprint', 'iris_scan', 'retina_scan', 'hand_scan',
] as const;

export type BipaConsentStatus = 'granted' | 'revoked' | 'expired';

export interface BipaConsentRecord {
  id: string;
  userId: string;
  orgId: string | null;
  biometricType: BipaBiometricType;
  status: BipaConsentStatus;
  /** §15(b)(1) — the written disclosure shown to the data subject. */
  disclosureText: string;
  /** §15(b)(2) — the specific purpose for collection / storage. */
  purpose: string;
  /** §15(b)(2) — the length of term the identifier will be stored. */
  retentionTerm: string;
  /** §15(b)(3) — written, signed release. Stored as the printed name plus
   *  optional signed payload (base64 image / signature pad output). */
  signatureName: string;
  signaturePayload: string | null;
  policyVersion: string;
  ipAddress: string | null;
  userAgent: string | null;
  grantedAt: string;
  revokedAt: string | null;
  destroyedAt: string | null;
  expiresAt: string | null;
}

/** Current BIPA §15(b) disclosure version surfaced to data subjects. */
export const BIPA_POLICY_VERSION = '1.0.0-BIPA-740-14-15';

/** §15(a) — max 3 years post-last-interaction or purpose-end, whichever is earlier. */
export const BIPA_DEFAULT_RETENTION_TERM =
  'Stored only for the duration of the active engagement and destroyed within 3 years of the data subject\'s last interaction with Jurexio, or upon revocation, whichever is earlier (740 ILCS 14/15(a)).';

const DEFAULT_DISCLOSURE = (b: BipaBiometricType) =>
  `Jurexio is informing you in writing that your ${b.replace('_', ' ')} ` +
  `(a biometric identifier under 740 ILCS 14/10) will be collected, captured, ` +
  `stored, and used solely for the legal-AI capture purpose you select. ` +
  `Jurexio does not sell, lease, trade, or otherwise profit from biometric ` +
  `identifiers (740 ILCS 14/15(c)). Records are protected with the same ` +
  `standard of care as other confidential information (§15(e)) and destroyed ` +
  `per the schedule below (§15(a)). You may revoke this consent at any time ` +
  `via the Console privacy page; revocation triggers immediate destruction.`;

async function ensureBipaTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_schema.nv_bipa_consent_records (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            TEXT NOT NULL,
      org_id             TEXT,
      biometric_type     TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'granted',
      disclosure_text    TEXT NOT NULL,
      purpose            TEXT NOT NULL,
      retention_term     TEXT NOT NULL,
      signature_name     TEXT NOT NULL,
      signature_payload  TEXT,
      policy_version     TEXT NOT NULL,
      ip_address         TEXT,
      user_agent         TEXT,
      granted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at         TIMESTAMPTZ,
      destroyed_at       TIMESTAMPTZ,
      expires_at         TIMESTAMPTZ,
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_nv_bipa_user
      ON nv_schema.nv_bipa_consent_records (user_id, biometric_type)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_nv_bipa_status
      ON nv_schema.nv_bipa_consent_records (user_id, status)
  `);
}

function rowToRecord(r: any): BipaConsentRecord {
  return {
    id: r.id,
    userId: r.user_id,
    orgId: r.org_id ?? null,
    biometricType: r.biometric_type,
    status: r.status,
    disclosureText: r.disclosure_text,
    purpose: r.purpose,
    retentionTerm: r.retention_term,
    signatureName: r.signature_name,
    signaturePayload: r.signature_payload ?? null,
    policyVersion: r.policy_version,
    ipAddress: r.ip_address ?? null,
    userAgent: r.user_agent ?? null,
    grantedAt: r.granted_at instanceof Date ? r.granted_at.toISOString() : String(r.granted_at),
    revokedAt: r.revoked_at ? (r.revoked_at instanceof Date ? r.revoked_at.toISOString() : String(r.revoked_at)) : null,
    destroyedAt: r.destroyed_at ? (r.destroyed_at instanceof Date ? r.destroyed_at.toISOString() : String(r.destroyed_at)) : null,
    expiresAt: r.expires_at ? (r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at)) : null,
  };
}

/**
 * NV-AUDIT-CHAIN-BYPASS-001 (2026-08-16) — BIPA §20 evidence must be
 * tamper-evident.
 *
 * This helper previously issued a direct SQL insert of (action, resource_type,
 * resource_id, metadata) into the legacy unqualified `public.nv_audit_logs`, a
 * table with no previous_hash / record_hash columns. Grant / revoke /
 * destruction events — exactly the per-scan accrual evidence that Cothron v.
 * White Castle makes dispositive — were therefore written outside the hash
 * chain and could be altered or removed without detection.
 *
 * Writes now go through `appendAuditRecord`, the single chain-enforced writer.
 * The retired `action` / `resource_type` / `resource_id` columns are carried as
 * payload keys so downstream readers keep the same field names.
 */
async function writeAudit(action: string, userId: string, biometricType: BipaBiometricType, meta: Record<string, unknown>): Promise<void> {
  try {
    await appendAuditRecord({
      eventType: action,
      payload: JSON.stringify({
        action,
        resourceType: 'bipa_biometric',
        resourceId: biometricType,
        userId,
        biometricType,
        policyCode: 'POL-US-BIPA-740-14-15',
        ...meta,
      }),
    });
  } catch (err: any) {
    if (err instanceof AuditChainBrokenError) {
      logger.error('bipa_audit_chain_broken', {
        action,
        userId,
        err: err.message,
        severity: 'CRITICAL',
        alertCode: 'NYV-AUDIT-CHAIN-001',
      });
    } else {
      logger.warn('bipa_audit_write_failed', { action, userId, err: err?.message });
    }
  }
}

class BipaConsentService {
  private initialized = false;
  private async init(): Promise<void> {
    if (this.initialized) return;
    await ensureBipaTable();
    this.initialized = true;
  }

  async grant(opts: {
    userId: string;
    orgId?: string | null;
    biometricType: BipaBiometricType;
    purpose: string;
    signatureName: string;
    signaturePayload?: string | null;
    disclosureText?: string;
    retentionTerm?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<BipaConsentRecord> {
    await this.init();
    const disclosure = opts.disclosureText ?? DEFAULT_DISCLOSURE(opts.biometricType);
    const retention = opts.retentionTerm ?? BIPA_DEFAULT_RETENTION_TERM;
    const rows = await db.execute(sql`
      INSERT INTO nv_schema.nv_bipa_consent_records
        (user_id, org_id, biometric_type, status, disclosure_text, purpose,
         retention_term, signature_name, signature_payload, policy_version,
         ip_address, user_agent)
      VALUES (
        ${opts.userId}, ${opts.orgId ?? null}, ${opts.biometricType}, 'granted',
        ${disclosure}, ${opts.purpose}, ${retention},
        ${opts.signatureName}, ${opts.signaturePayload ?? null}, ${BIPA_POLICY_VERSION},
        ${opts.ipAddress ?? null}, ${opts.userAgent ?? null}
      )
      RETURNING *
    `);
    const rec = rowToRecord(rows.rows[0]);
    await writeAudit('bipa_consent_granted', opts.userId, opts.biometricType, {
      orgId: opts.orgId ?? null, recordId: rec.id, purpose: opts.purpose, signatureName: opts.signatureName,
    });
    logger.info('bipa_consent_granted', { userId: opts.userId, biometricType: opts.biometricType });
    return rec;
  }

  /**
   * Resolve the authoritative consent state for (userId, biometricType).
   * Returns the most recent record + whether capture is permitted right now.
   */
  async check(userId: string, biometricType: BipaBiometricType): Promise<{
    granted: boolean;
    status: BipaConsentStatus | 'missing';
    record: BipaConsentRecord | null;
  }> {
    await this.init();
    try {
      const rows = await db.execute(sql`
        SELECT * FROM nv_schema.nv_bipa_consent_records
        WHERE user_id = ${userId} AND biometric_type = ${biometricType}
        ORDER BY granted_at DESC
        LIMIT 1
      `);
      const row = rows.rows?.[0] as any;
      if (!row) return { granted: false, status: 'missing', record: null };
      const rec = rowToRecord(row);
      let status: BipaConsentStatus | 'missing' = rec.status;
      if (rec.expiresAt && new Date(rec.expiresAt) < new Date()) status = 'expired';
      const granted = status === 'granted';
      return { granted, status, record: rec };
    } catch (err: any) {
      logger.warn('bipa_check_failed', { userId, biometricType, err: err?.message });
      return { granted: false, status: 'missing', record: null };
    }
  }

  async listForUser(userId: string): Promise<BipaConsentRecord[]> {
    await this.init();
    const rows = await db.execute(sql`
      SELECT * FROM nv_schema.nv_bipa_consent_records
      WHERE user_id = ${userId}
      ORDER BY granted_at DESC
    `);
    return rows.rows.map(rowToRecord);
  }

  /**
   * §15(a) — revoke + immediately destroy. Marks the record `revoked` and
   * runs the destruction worker against any persisted biometric data for
   * (userId, biometricType). The worker is best-effort: it deletes from
   * known biometric stores, clears caches, and emits a destruction audit
   * event. It NEVER throws so a partial-destruction is still visible in
   * the audit trail.
   */
  async revokeAndDestroy(opts: {
    userId: string;
    biometricType: BipaBiometricType;
    triggeredBy?: string;
    reason?: string;
  }): Promise<{ revoked: boolean; destroyed: BipaDestructionResult }> {
    await this.init();
    const upd = await db.execute(sql`
      UPDATE nv_schema.nv_bipa_consent_records
      SET status = 'revoked', revoked_at = NOW()
      WHERE user_id = ${opts.userId} AND biometric_type = ${opts.biometricType} AND status = 'granted'
      RETURNING id
    `);
    const revokedCount = upd.rows.length;
    await writeAudit('bipa_consent_revoked', opts.userId, opts.biometricType, {
      revokedCount, triggeredBy: opts.triggeredBy ?? 'user', reason: opts.reason ?? null,
    });
    const destroyed = await this.runDestructionWorker(opts.userId, opts.biometricType, opts.triggeredBy ?? 'revoke');
    return { revoked: revokedCount > 0, destroyed };
  }

  /**
   * §15(a) destruction worker. Iterates known biometric data sinks and
   * removes any persisted artefacts for (userId, biometricType). Today
   * Jurexio does not store voiceprints / facial geometry locally —
   * STT/face capture proxy through providers — but we still:
   *   1. Delete from `nv_schema.nv_biometric_artefacts` (created on demand)
   *      so future stores can opt-in by writing rows there.
   *   2. Stamp `destroyed_at` on the consent record so the destruction is
   *      a permanent part of the §20 evidence chain.
   *   3. Emit `bipa_destruction_executed` to nv_audit_logs.
   */
  async runDestructionWorker(userId: string, biometricType: BipaBiometricType, triggeredBy: string): Promise<BipaDestructionResult> {
    await this.init();
    let deletedArtefacts = 0;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS nv_schema.nv_biometric_artefacts (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id         TEXT NOT NULL,
          biometric_type  TEXT NOT NULL,
          payload_ref     TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const del = await db.execute(sql`
        DELETE FROM nv_schema.nv_biometric_artefacts
        WHERE user_id = ${userId} AND biometric_type = ${biometricType}
        RETURNING id
      `);
      deletedArtefacts = del.rows.length;
    } catch (err: any) {
      logger.warn('bipa_destroy_artefacts_failed', { userId, biometricType, err: err?.message });
    }

    let stamped = 0;
    try {
      const r = await db.execute(sql`
        UPDATE nv_schema.nv_bipa_consent_records
        SET destroyed_at = NOW()
        WHERE user_id = ${userId} AND biometric_type = ${biometricType} AND destroyed_at IS NULL
        RETURNING id
      `);
      stamped = r.rows.length;
    } catch (err: any) {
      logger.warn('bipa_destroy_stamp_failed', { userId, biometricType, err: err?.message });
    }

    await writeAudit('bipa_destruction_executed', userId, biometricType, {
      deletedArtefacts, recordsStamped: stamped, triggeredBy,
    });

    // Mirror the destruction event into the CAM reviewer queue so privacy
    // ops can confirm §15(a) was honoured for this principal.
    try {
      writeCamActionAsync({
        actionId: camActionId(['bipa', 'destruction', userId, biometricType, String(Date.now())]),
        orgId: null,
        framework: 'bipa',
        controlId: 'BIPA:740-ILCS-14/15(a)',
        severity: 'low',
        title: `BIPA §15(a) destruction executed: ${biometricType}`,
        description: `Destruction worker removed ${deletedArtefacts} biometric artefact(s) for user ${userId} (${biometricType}). Triggered by: ${triggeredBy}.`,
        triggeredBy: './jrx-bipa-consent-service.runDestructionWorker',
        evidenceRef: null,
        metadata: { userId, biometricType, deletedArtefacts, recordsStamped: stamped, policyCodes: ['POL-US-BIPA-740-14-15'] },
      });
    } catch { /* CAM is best-effort */ }

    logger.info('bipa_destruction_executed', { userId, biometricType, deletedArtefacts, recordsStamped: stamped });
    return { deletedArtefacts, recordsStamped: stamped, triggeredBy, completedAt: new Date().toISOString() };
  }
}

export interface BipaDestructionResult {
  deletedArtefacts: number;
  recordsStamped: number;
  triggeredBy: string;
  completedAt: string;
}

export const bipaConsentService = new BipaConsentService();
export default bipaConsentService;
