// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * DPDPA 2023 Consent Management Service
 * Implements Digital Personal Data Protection Act 2023 (India) consent framework.
 * Also covers GDPR consent for EU jurisdiction.
 *
 * @version 3.1.2
 */
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { writeCamActionAsync, camActionId } from './compliance/jrx-cam-writer.js';
import { appendAuditRecord, AuditChainBrokenError } from '../middleware/jrx-sdk-tracking-middleware.js';

const logger = createLogger('consent-management');

// Task #215: purposes whose breach is treated as a critical CAM finding
// (vs. the default high). DPDPA §9 special-category data must always raise
// the alarm to critical because the regulator treats unauthorised processing
// of biometric / sensitive legal matters as a top-tier penalty event.
const CRITICAL_BREACH_PURPOSES: ReadonlySet<ConsentPurpose> = new Set<ConsentPurpose>([
  'biometric',
  'sensitive_legal_data',
  'third_party_sharing',
]);

export type ConsentBreachStatus = 'missing' | 'withdrawn' | 'expired';

export interface ConsentCheckResult {
  granted: boolean;
  status: 'granted' | ConsentBreachStatus;
  breach: boolean;
  legalBasis: string;
}

export interface ConsentGrant {
  userId: string;
  orgId?: string;
  purposes: ConsentPurpose[];
  jurisdiction: string;
  ipAddress?: string;
  userAgent?: string;
  consentVersion: string;
}

export type ConsentPurpose =
  | 'ai_processing'
  | 'legal_research'
  | 'document_storage'
  | 'analytics'
  | 'marketing'
  | 'third_party_sharing'
  | 'biometric'
  | 'sensitive_legal_data';

export interface ConsentRecord {
  id: string;
  userId: string;
  orgId?: string;
  purpose: ConsentPurpose;
  status: 'granted' | 'withdrawn' | 'expired';
  jurisdiction: string;
  grantedAt: Date;
  withdrawnAt?: Date;
  expiresAt?: Date;
  consentVersion: string;
  legalBasis: string;
}

export interface DataPortabilityExport {
  userId: string;
  exportedAt: string;
  format: 'json';
  data: {
    consents: ConsentRecord[];
    personalData: Record<string, any>;
    processingActivities: string[];
    thirdPartySharing: string[];
  };
}

const LEGAL_BASIS: Record<ConsentPurpose, string> = {
  ai_processing: 'DPDPA §4 — Consent for processing personal data for AI legal assistance',
  legal_research: 'DPDPA §7(a) — Legitimate uses: legal purposes',
  document_storage: 'DPDPA §4 — Explicit consent for document retention',
  analytics: 'DPDPA §4 — Consent for platform analytics',
  marketing: 'DPDPA §4 — Express consent for marketing communications',
  third_party_sharing: 'DPDPA §6 — Consent for sharing with data fiduciaries',
  biometric: 'DPDPA §9 — Special category: explicit consent required',
  sensitive_legal_data: 'DPDPA §9 — Special category: explicit consent for sensitive legal matters',
};

const CONSENT_VERSION = '3.1.2-dpdpa-2023';

/**
 * NV-CONSENT-DDL-001: Prefer probe-over-CREATE. RDS role `nv_app` can SELECT/DML
 * on `nv_schema.nv_consent_records` but often lacks CREATE on `nv_schema`, so
 * `CREATE TABLE IF NOT EXISTS` fails even when the table already exists — and
 * that failure previously left `initialized=false`, spamming every NSP request.
 */
async function ensureConsentTable(): Promise<void> {
  try {
    await db.execute(sql`SELECT 1 FROM nv_schema.nv_consent_records LIMIT 1`);
    return;
  } catch {
    // Table missing or not readable — attempt idempotent DDL below.
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_consent_records (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         TEXT NOT NULL,
        org_id          TEXT,
        purpose         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'granted',
        jurisdiction    TEXT NOT NULL DEFAULT 'IN',
        granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        withdrawn_at    TIMESTAMPTZ,
        expires_at      TIMESTAMPTZ,
        consent_version TEXT NOT NULL,
        legal_basis     TEXT NOT NULL,
        ip_address      TEXT,
        user_agent      TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, purpose, consent_version)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_consent_user ON nv_schema.nv_consent_records (user_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_consent_status ON nv_schema.nv_consent_records (user_id, status)
    `);
  } catch (err: unknown) {
    // Last chance: if SELECT works now, treat as ready (race / concurrent create).
    try {
      await db.execute(sql`SELECT 1 FROM nv_schema.nv_consent_records LIMIT 1`);
      return;
    } catch {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

class ConsentManagementService {
  private initialized = false;

  private async init(): Promise<void> {
    if (this.initialized) return;
    await ensureConsentTable();
    this.initialized = true;
  }

  async grantConsent(grant: ConsentGrant): Promise<ConsentRecord[]> {
    await this.init();
    const records: ConsentRecord[] = [];

    for (const purpose of grant.purposes) {
      const legalBasis = LEGAL_BASIS[purpose] || 'DPDPA §4 — Explicit consent';
      // Upsert consent
      await db.execute(sql`
        INSERT INTO nv_schema.nv_consent_records
          (user_id, org_id, purpose, status, jurisdiction, consent_version, legal_basis, ip_address, user_agent)
        VALUES (
          ${grant.userId}, ${grant.orgId || null}, ${purpose}, 'granted',
          ${grant.jurisdiction}, ${CONSENT_VERSION}, ${legalBasis},
          ${grant.ipAddress || null}, ${grant.userAgent || null}
        )
        ON CONFLICT (user_id, purpose, consent_version)
        DO UPDATE SET status = 'granted', granted_at = NOW(), withdrawn_at = NULL
      `);

      records.push({
        id: crypto.randomUUID(),
        userId: grant.userId,
        orgId: grant.orgId,
        purpose,
        status: 'granted',
        jurisdiction: grant.jurisdiction,
        grantedAt: new Date(),
        consentVersion: CONSENT_VERSION,
        legalBasis,
      });
    }

    logger.info('consent_granted', { userId: grant.userId, purposes: grant.purposes, jurisdiction: grant.jurisdiction });
    return records;
  }

  async withdrawConsent(userId: string, purposes: ConsentPurpose[]): Promise<{ withdrawn: ConsentPurpose[] }> {
    await this.init();
    const withdrawn: ConsentPurpose[] = [];

    for (const purpose of purposes) {
      await db.execute(sql`
        UPDATE nv_schema.nv_consent_records
        SET status = 'withdrawn', withdrawn_at = NOW()
        WHERE user_id = ${userId} AND purpose = ${purpose} AND status = 'granted'
      `);
      withdrawn.push(purpose);
    }

    logger.info('consent_withdrawn', { userId, purposes: withdrawn });
    return { withdrawn };
  }

  async getConsentStatus(userId: string): Promise<{
    userId: string;
    activeConsents: ConsentPurpose[];
    withdrawnConsents: ConsentPurpose[];
    consentVersion: string;
    lastUpdated: string;
    dpdpaCompliant: boolean;
  }> {
    await this.init();
    const rows = await db.execute(sql`
      SELECT purpose, status, granted_at, withdrawn_at FROM nv_schema.nv_consent_records
      WHERE user_id = ${userId} ORDER BY granted_at DESC
    `);

    const active: ConsentPurpose[] = [];
    const withdrawn: ConsentPurpose[] = [];
    let lastUpdated = new Date(0);

    for (const row of rows.rows) {
      const r = row as any;
      if (r.status === 'granted') active.push(r.purpose as ConsentPurpose);
      else withdrawn.push(r.purpose as ConsentPurpose);
      const ts = new Date(r.granted_at || r.withdrawn_at);
      if (ts > lastUpdated) lastUpdated = ts;
    }

    return {
      userId,
      activeConsents: active,
      withdrawnConsents: withdrawn,
      consentVersion: CONSENT_VERSION,
      lastUpdated: lastUpdated.toISOString(),
      dpdpaCompliant: active.includes('ai_processing'),
    };
  }

  /**
   * DPDPA §4 / §6 / §9 consent check.
   *
   * Returns the resolved status for (userId, purpose) plus a `breach` flag
   * indicating whether the caller is about to process personal data without
   * a valid consent. Task #215: when a breach is detected we emit one row
   * into the `nv_cam_actions` reviewer queue (framework=`dpdpa`,
   * severity=`critical` for §9 special-category purposes, else `high`).
   *
   * Idempotent via `camActionId([...])`: repeated breach checks for the
   * same (org, user, purpose, version) collapse to a single reviewer row.
   *
   * Callers that are about to *use* the data should pass
   * `{ attemptedUse: true }` so the CAM evidence trail records the call
   * site (route/service id) that triggered the unlawful processing risk.
   */
  async checkConsent(
    userId: string,
    purpose: ConsentPurpose,
    opts?: {
      orgId?: string;
      jurisdiction?: string;
      attemptedUse?: boolean;
      requestId?: string;
      triggeredBy?: string;
    },
  ): Promise<ConsentCheckResult> {
    await this.init();
    const legalBasis = LEGAL_BASIS[purpose] || 'DPDPA §4 — Explicit consent';

    let status: ConsentCheckResult['status'] = 'missing';
    try {
      const rows = await db.execute(sql`
        SELECT status, expires_at, withdrawn_at
        FROM nv_schema.nv_consent_records
        WHERE user_id = ${userId} AND purpose = ${purpose}
        ORDER BY granted_at DESC
        LIMIT 1
      `);
      const row = rows.rows?.[0] as any;
      if (row) {
        if (row.status === 'withdrawn' || row.withdrawn_at) {
          status = 'withdrawn';
        } else if (row.expires_at && new Date(row.expires_at) < new Date()) {
          status = 'expired';
        } else if (row.status === 'granted') {
          status = 'granted';
        } else {
          status = (row.status as ConsentBreachStatus) ?? 'missing';
        }
      }
    } catch (err: any) {
      logger.warn('consent_check_failed', { userId, purpose, err: err?.message });
    }

    const granted = status === 'granted';
    const breach = !granted;

    // task-298 review-fix v5: persist EVERY consent-gate evaluation so
    // /api/jrx/compliance/policy-enforcement KPIs can be computed from real,
    // org-scoped events (allows + breaches), not from a synthetic multiplier.
    //
    // NV-AUDIT-CHAIN-BYPASS-001 (2026-08-16): this was a direct SQL insert of
    // (action, resource_type, resource_id, metadata) into the legacy
    // unqualified `public.nv_audit_logs`, a table with no previous_hash /
    // record_hash columns. Every consent-gate event written that way sat
    // outside the tamper-evident chain and could be edited or deleted without
    // detection. The canonical writer is `appendAuditRecord`
    // (nv_schema.nv_audit_logs). The former `action` / `resource_type` /
    // `resource_id` columns are preserved as payload keys so the
    // /api/jrx/compliance/policy-enforcement reader keeps identical semantics
    // after switching from `metadata->>` to `payload->>`.
    //
    // Still best-effort: a DPDPA consent gate must not fail because its audit
    // sink is unreachable. A chain-integrity violation is distinguished from
    // an ordinary write failure and escalated at ERROR with an alert code.
    try {
      await appendAuditRecord({
        eventType: 'consent_check',
        payload: JSON.stringify({
          action: 'consent_check',
          resourceType: 'dpdpa_purpose',
          resourceId: purpose,
          orgId: opts?.orgId ?? null,
          userId,
          purpose,
          status,
          result: granted ? 'allow' : 'breach',
          jurisdiction: opts?.jurisdiction ?? 'IN',
          consentVersion: CONSENT_VERSION,
          requestId: opts?.requestId ?? null,
          triggeredBy: opts?.triggeredBy ?? null,
        }),
      });
    } catch (err: any) {
      if (err instanceof AuditChainBrokenError) {
        logger.error('consent_check_audit_chain_broken', {
          userId,
          purpose,
          err: err.message,
          severity: 'CRITICAL',
          alertCode: 'NYV-AUDIT-CHAIN-001',
        });
      } else {
        logger.warn('consent_check_audit_failed', { userId, purpose, err: err?.message });
      }
    }

    if (breach) {
      const severity = CRITICAL_BREACH_PURPOSES.has(purpose) ? 'critical' : 'high';
      const orgId = opts?.orgId ?? null;
      const triggeredBy = opts?.triggeredBy ?? 'consent_management_service.checkConsent';
      // Stable across re-checks of the same (org, user, purpose, version,
      // breach-status). Drop requestId from the key on purpose so we don't
      // create N reviewer rows for one rolling breach.
      const actionId = camActionId([
        'dpdpa',
        orgId ?? 'platform',
        userId,
        purpose,
        status,
        CONSENT_VERSION,
      ]);
      writeCamActionAsync({
        actionId,
        orgId,
        framework: 'dpdpa',
        controlId: `dpdpa.purpose.${purpose}`,
        severity,
        title: `DPDPA consent breach: ${purpose} (${status})`,
        description: `User ${userId} has no valid consent for purpose "${purpose}" (status=${status}). Legal basis: ${legalBasis}`,
        triggeredBy,
        evidenceRef: opts?.requestId ?? null,
        metadata: {
          userId,
          purpose,
          status,
          attemptedUse: Boolean(opts?.attemptedUse),
          jurisdiction: opts?.jurisdiction ?? 'IN',
          consentVersion: CONSENT_VERSION,
          legalBasis,
          // task-298 review-fix: deterministic CAM↔policy mapping. Every
          // DPDPA consent breach attaches the full set of DPDPA policy
          // codes that govern data-subject consent so that the policy
          // drilldown query (`metadata->'policyCodes' ? 'POL-IN-DPDPA-S6'`)
          // joins real consent-gate events to the right policies without
          // depending on text-matching the title or control_id.
          framework: 'dpdpa',
          policyCodes: [
            'POL-IN-DPDPA-S4',
            'POL-IN-DPDPA-S6',
            'POL-IN-DPDPA-S8',
            'POL-IN-DPDPA-S11',
            'POL-IN-DPDPA-S12',
          ],
        },
      });
      logger.warn('dpdpa_consent_breach', {
        userId, purpose, status, attemptedUse: Boolean(opts?.attemptedUse),
      });
    }

    return { granted, status, breach, legalBasis };
  }

  async exportUserData(userId: string): Promise<DataPortabilityExport> {
    await this.init();
    const rows = await db.execute(sql`
      SELECT * FROM nv_schema.nv_consent_records WHERE user_id = ${userId}
    `);

    const consents: ConsentRecord[] = rows.rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      orgId: r.org_id,
      purpose: r.purpose,
      status: r.status,
      jurisdiction: r.jurisdiction,
      grantedAt: r.granted_at,
      withdrawnAt: r.withdrawn_at,
      consentVersion: r.consent_version,
      legalBasis: r.legal_basis,
    }));

    return {
      userId,
      exportedAt: new Date().toISOString(),
      format: 'json',
      data: {
        consents,
        personalData: { userId, note: 'Full personal data export available via DPDPA §12 request' },
        processingActivities: consents.filter(c => c.status === 'granted').map(c => c.purpose),
        thirdPartySharing: consents.filter(c => c.purpose === 'third_party_sharing' && c.status === 'granted').map(() => 'Data Fiduciary Partners under DPDPA §6'),
      },
    };
  }

  async deleteUserData(userId: string): Promise<{ deleted: boolean; message: string }> {
    await this.init();
    await db.execute(sql`
      DELETE FROM nv_schema.nv_consent_records WHERE user_id = ${userId}
    `);
    logger.info('consent_data_deleted', { userId });
    return { deleted: true, message: `All consent records for user ${userId} deleted under DPDPA §13 (Right to be forgotten)` };
  }
}

export const consentManagementService = new ConsentManagementService();
export default consentManagementService;
