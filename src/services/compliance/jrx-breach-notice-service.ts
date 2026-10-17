/**
 * Jurexio Breach Notice Service — task-356.
 *
 * Closes the loop on the US state breach-notification surface seeded by
 * task-351. Given a breach incident tagged with affected NY / IL / MA
 * residents, this service:
 *
 *   1. Persists the incident to `nv_breach_incidents`.
 *   2. Generates per-state notice drafts (resident letters + state-AG /
 *      OCABR / NYS Police filings) from statute-aware templates with the
 *      incident facts auto-filled. Drafts are stored in
 *      `nv_breach_notices`.
 *   3. Routes a CAM action (`framework='breach'`) to the Compliance owner
 *      queue per notice so the reviewer surface picks them up.
 *   4. Dispatches outbound delivery: email to OAG mailboxes, web-portal
 *      submission for state portals (currently a queue/stub transport
 *      that records intent — pluggable via `setBreachDispatcher`). Every
 *      attempt appends a tamper-evident record to `nv_audit_logs` via
 *      `appendAuditRecord` so the §899-aa / c.93H / BIPA evidence trail
 *      reconstructs deterministically.
 *   5. For IL BIPA, writes a per-affected-resident statutory damage row
 *      to `nv_bipa_damage_records` (per-scan accrual per Cothron v.
 *      White Castle, 2023 IL 128004) so the §20 private-right-of-action
 *      surface is auditable.
 *
 * Threshold + recipient rules (codified in `planNotices`):
 *   - NY (POL-US-NYSHIELD-899-bb / §899-aa(2),(8)):
 *       always  → resident letter
 *       NY count > 500 → concurrent notice to NY OAG, NY Dept of State,
 *                        and NY State Police
 *   - MA (POL-US-MA201CMR17-03 / M.G.L. c.93H §3(b)):
 *       always  → MA OCABR + MA Attorney General + resident letter
 *   - IL (POL-US-BIPA-740-14-15 / 740 ILCS 14/15 + §20):
 *       always  → resident letter + per-resident statutory damage record
 *                 ($1,000 negligent / $5,000 intentional, per scan).
 *
 * Idempotent: callers supply a stable `incidentId`. Re-firing the same
 * incident is a no-op past the first call.
 *
 * NV-NAMING-001: nv- prefix.
 * NV-WIRING-001: mounted at /api/jrx/compliance/breach via
 *                src/routes/jrx-breach-notice-routes.ts.
 * NV-OWNERSHIP-001: dispatch failures surface as `delivery_status='failed'`
 *                  with the error captured; never silently dropped.
 */
import { sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import { writeCamAction, camActionId } from './jrx-cam-writer.js';
import { appendAuditRecord } from '../../middleware/jrx-sdk-tracking-middleware.js';

const logger = createLogger('./jrx-breach-notice');

// ── Types ───────────────────────────────────────────────────────────────────
// task-398: 'US' is a federal-scope pseudo-state used by recipients that
// do not bind to a single state (e.g. the FTC under the GLBA Safeguards
// Rule §314.5, which is triggered by a 500-consumer aggregate without
// regard to which states those consumers reside in).
export type BreachState = 'NY' | 'IL' | 'MA' | 'US';

export type BreachRecipient =
  | 'NY_RESIDENTS'
  | 'NY_OAG'
  | 'NY_DOS'
  | 'NYS_POLICE'
  | 'MA_RESIDENTS'
  | 'MA_AG'
  | 'MA_OCABR'
  | 'IL_RESIDENTS'
  // task-398: federal — FTC under GLBA Safeguards Rule §314.5
  | 'FTC';

export type DeliveryChannel = 'email' | 'web_portal' | 'queued';

export type DeliveryStatus = 'pending' | 'queued' | 'sent' | 'failed';

export interface AffectedResidentBucket {
  state: BreachState;
  count: number;
  /** Optional explicit resident IDs (used by IL BIPA per-scan accrual). */
  residentIds?: string[];
}

export interface BreachIncidentInput {
  /** Stable id (e.g. ticket / case number). Idempotency key. */
  incidentId: string;
  orgId: string;
  /** ISO timestamp the breach was discovered. */
  discoveredAt: string;
  /** ISO timestamp the breach occurred (best estimate). */
  occurredAt?: string;
  /** Short narrative — feeds the notice template. */
  natureOfBreach: string;
  /** Categories of PI exposed (e.g. 'name','SSN','financial_account'). */
  dataCategories: string[];
  /** One bucket per affected state. */
  affectedResidents: AffectedResidentBucket[];
  /** Containment + remediation summary. */
  containmentSummary?: string;
  /** Encryption posture at time of breach. */
  encryptionStatus?: 'encrypted' | 'unencrypted' | 'unknown';
  /** Estimated cost of substitute notice (NY §899-aa(5) trigger). */
  estimatedCostUSD?: number;
  /** Breach scope is 'negligent' (BIPA $1k) or 'intentional/reckless' (BIPA $5k). */
  bipaCulpability?: 'negligent' | 'intentional';
  /** Compliance contact for the filing. */
  contact: { name: string; email: string; phone?: string };
  /** Filed-by user id (for audit). */
  filedBy?: string;
}

export interface BreachNoticeDraft {
  noticeId: string;
  incidentId: string;
  orgId: string;
  state: BreachState;
  recipient: BreachRecipient;
  channel: DeliveryChannel;
  destination: string;
  template: string;
  policyCode: string;
  subject: string;
  bodyMarkdown: string;
  metadata: Record<string, unknown>;
}

export interface BreachDispatchResult {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  providerRef?: string;
  error?: string;
}

export type BreachDispatcher = (draft: BreachNoticeDraft) => Promise<BreachDispatchResult>;

// ── Recipient registry (statutory destinations) ─────────────────────────────
// Sources:
//   NY OAG       — https://ag.ny.gov/internet/data-breach (per §899-aa(8)(a))
//   NY DOS       — https://its.ny.gov/cyber-incident-reporting (Cyber Command intake)
//   NYS Police   — Cyber Analysis Unit, https://troopers.ny.gov
//   MA AG        — https://www.mass.gov/how-to/report-a-data-breach (per c.93H §3)
//   MA OCABR     — dataprivacyandsecurity@state.ma.us (per c.93H §3)
// All addresses are the canonical statutory mailboxes/portals; the
// dispatcher transport is pluggable so a tenant can override with their
// own counsel or filing vendor.
interface RecipientSpec {
  channel: DeliveryChannel;
  destination: string;
  template: string;
  policyCode: string;
}

const RECIPIENTS: Record<BreachRecipient, RecipientSpec> = {
  NY_RESIDENTS: {
    channel: 'email',
    destination: 'ny-resident-letter@notice.jurexio.example',
    template: 'NY-SHIELD-899aa-resident-letter',
    policyCode: 'POL-US-NYSHIELD-899-bb',
  },
  NY_OAG: {
    channel: 'web_portal',
    destination: 'https://ag.ny.gov/internet/data-breach',
    template: 'NY-SHIELD-899aa-oag-filing',
    policyCode: 'POL-US-NYSHIELD-899-bb',
  },
  NY_DOS: {
    channel: 'web_portal',
    destination: 'https://its.ny.gov/cyber-incident-reporting',
    template: 'NY-SHIELD-899aa-dos-filing',
    policyCode: 'POL-US-NYSHIELD-899-bb',
  },
  NYS_POLICE: {
    channel: 'email',
    destination: 'cyber.intel@troopers.ny.gov',
    template: 'NY-SHIELD-899aa-nysp-filing',
    policyCode: 'POL-US-NYSHIELD-899-bb',
  },
  MA_RESIDENTS: {
    channel: 'email',
    destination: 'ma-resident-letter@notice.jurexio.example',
    template: 'MA-c93H-3-resident-letter',
    policyCode: 'POL-US-MA201CMR17-03',
  },
  MA_AG: {
    channel: 'web_portal',
    destination: 'https://www.mass.gov/how-to/report-a-data-breach',
    template: 'MA-c93H-3-ag-filing',
    policyCode: 'POL-US-MA201CMR17-03',
  },
  MA_OCABR: {
    channel: 'email',
    destination: 'dataprivacyandsecurity@state.ma.us',
    template: 'MA-c93H-3-ocabr-filing',
    policyCode: 'POL-US-MA201CMR17-03',
  },
  IL_RESIDENTS: {
    channel: 'email',
    destination: 'il-resident-letter@notice.jurexio.example',
    template: 'IL-BIPA-740-14-20-resident-letter',
    policyCode: 'POL-US-BIPA-740-14-15',
  },
  // task-398: GLBA Safeguards Rule §314.5 (16 C.F.R. §314.5).
  // Source — https://www.ftc.gov/business-guidance/privacy-security/financial-privacy
  // Filing portal: https://www.ftc.gov/safeguards-rule-notification (electronic
  // notification form, mandated by §314.5(a) effective 2024-05-13). Tenant
  // can override via setBreachDispatcher() to route through outside counsel
  // or a regulatory-filing vendor.
  FTC: {
    channel: 'web_portal',
    destination: 'https://www.ftc.gov/safeguards-rule-notification',
    template: 'GLBA-314.5-ftc-notification',
    policyCode: 'POL-US-GLBA-314.5',
  },
};

// NY SHIELD §899-aa(8)(a) statutory threshold for concurrent agency notice.
export const NY_AG_THRESHOLD = 500;

// task-398: GLBA Safeguards Rule §314.5(a) — electronic notice to the FTC
// no later than 30 days after discovery for any "notification event"
// involving the unencrypted customer information of 500 or more
// consumers, aggregated across states.
export const FTC_GLBA_THRESHOLD = 500;

// ── Pluggable dispatcher ────────────────────────────────────────────────────
//
// Resolution order at dispatch time:
//
//   1. An explicit dispatcher set via `setBreachDispatcher()` (used by tests
//      and by production wiring that prefers a vendor SDK / portal worker).
//   2. SMTP transport via nodemailer when `NV_BREACH_SMTP_URL` is configured
//      AND the recipient channel is 'email' — this is the production default
//      for resident letters and OAG / OCABR mailbox filings.
//   3. Queued-stub fallback that records intent to `nv_breach_notices` with
//      `delivery_status='queued'` so the audit chain still proves the notice
//      was generated and routed, even when no real transport is configured.
//
// Fail-closed mode: when `NV_BREACH_REQUIRE_DELIVERY=1` (recommended in
// prod), recipients that would land on the queued-stub fallback are flipped
// to `delivery_status='failed'` with an explicit error so a downstream
// monitor surfaces the gap instead of treating queued-only as success.
let _explicitDispatcher: BreachDispatcher | null = null;

export function setBreachDispatcher(d: BreachDispatcher): void {
  _explicitDispatcher = d;
}

// Test seam: drop the explicit dispatcher and fall back to env-resolved
// default (queued unless NV_BREACH_SMTP_URL is set).
export function resetBreachDispatcher(): void {
  _explicitDispatcher = null;
}

let _smtpTransport: any | null = null;
let _smtpInitTried = false;
async function getSmtpTransport(): Promise<any | null> {
  if (_smtpTransport) return _smtpTransport;
  if (_smtpInitTried) return null;
  _smtpInitTried = true;
  const url = process.env.NV_BREACH_SMTP_URL;
  if (!url) return null;
  try {
    const nodemailer = await import('nodemailer') as typeof import('nodemailer');
    _smtpTransport = nodemailer.createTransport(url);
    return _smtpTransport;
  } catch (err: any) {
    logger.warn('breach_smtp_init_failed', { err: err?.message });
    return null;
  }
}

// Test seam: allow tests to inject (or clear) the cached SMTP transport
// without going through process.env.
export function __setSmtpTransportForTests(t: any | null): void {
  _smtpTransport = t;
  _smtpInitTried = !!t || _smtpInitTried;
}

const QUEUED_STUB_PROVIDER_PREFIX = 'queued:';
const SMTP_PROVIDER_PREFIX = 'smtp:';

async function smtpDispatch(draft: BreachNoticeDraft, transport: any): Promise<BreachDispatchResult> {
  const from = process.env.NV_BREACH_NOTICE_FROM || 'notice@jurexio.example';
  try {
    const info: any = await transport.sendMail({
      from,
      to: draft.destination,
      subject: draft.subject,
      text: draft.bodyMarkdown,
      headers: {
        'X-Jurexio-Notice-Id': draft.noticeId,
        'X-Jurexio-Incident-Id': draft.incidentId,
        'X-Jurexio-Org-Id': draft.orgId,
        'X-Jurexio-Policy': draft.policyCode,
      },
    });
    const ref = info?.messageId
      ? `${SMTP_PROVIDER_PREFIX}${info.messageId}`
      : `${SMTP_PROVIDER_PREFIX}${draft.noticeId}`;
    return { channel: 'email', status: 'sent', providerRef: ref };
  } catch (err: any) {
    return {
      channel: 'email',
      status: 'failed',
      providerRef: `${SMTP_PROVIDER_PREFIX}${draft.noticeId}`,
      error: err?.message ?? String(err),
    };
  }
}

async function resolveDispatcher(draft: BreachNoticeDraft): Promise<BreachDispatchResult> {
  if (_explicitDispatcher) return _explicitDispatcher(draft);
  if (draft.channel === 'email') {
    const transport = await getSmtpTransport();
    if (transport) return smtpDispatch(draft, transport);
  }
  const requireDelivery = process.env.NV_BREACH_REQUIRE_DELIVERY === '1';
  if (requireDelivery) {
    return {
      channel: draft.channel,
      status: 'failed',
      providerRef: `${QUEUED_STUB_PROVIDER_PREFIX}${draft.noticeId}`,
      error: `breach_no_real_transport_configured (channel=${draft.channel}; set NV_BREACH_SMTP_URL or call setBreachDispatcher)`,
    };
  }
  return {
    channel: draft.channel,
    status: 'queued',
    providerRef: `${QUEUED_STUB_PROVIDER_PREFIX}${draft.noticeId}`,
  };
}

const _dispatcher: BreachDispatcher = (draft) => resolveDispatcher(draft);

// ── Schema bootstrap ────────────────────────────────────────────────────────
let _tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (_tablesEnsured) return;
  if (!db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_breach_incidents (
        incident_id          VARCHAR(80) NOT NULL,
        org_id               VARCHAR(100) NOT NULL,
        discovered_at        TIMESTAMPTZ  NOT NULL,
        occurred_at          TIMESTAMPTZ,
        nature_of_breach     TEXT         NOT NULL,
        data_categories      JSONB        NOT NULL DEFAULT '[]'::jsonb,
        affected_residents   JSONB        NOT NULL DEFAULT '[]'::jsonb,
        containment_summary  TEXT,
        encryption_status    VARCHAR(20),
        estimated_cost_usd   NUMERIC,
        bipa_culpability     VARCHAR(20),
        contact              JSONB        NOT NULL,
        filed_by             VARCHAR(100),
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        -- Tenant-scoped identity. Two orgs MUST be able to use the same
        -- caller-side incident_id (e.g. ticket number) without colliding
        -- and silently suppressing the second tenant's statutory filings.
        PRIMARY KEY (org_id, incident_id)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_breach_notices (
        notice_id            VARCHAR(80) PRIMARY KEY,
        incident_id          VARCHAR(80) NOT NULL,
        org_id               VARCHAR(100) NOT NULL,
        state                VARCHAR(4)  NOT NULL,
        recipient            VARCHAR(40) NOT NULL,
        channel              VARCHAR(20) NOT NULL,
        destination          VARCHAR(255) NOT NULL,
        template             VARCHAR(80) NOT NULL,
        policy_code          VARCHAR(80) NOT NULL,
        subject              VARCHAR(255) NOT NULL,
        body_md              TEXT        NOT NULL,
        metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
        delivery_status      VARCHAR(20) NOT NULL DEFAULT 'pending',
        provider_ref         VARCHAR(255),
        delivery_error       TEXT,
        cam_action_id        VARCHAR(64),
        audit_record_id      VARCHAR(80),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at         TIMESTAMPTZ,
        UNIQUE(org_id, incident_id, recipient)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS nv_breach_notices_incident_idx
        ON nv_breach_notices(org_id, incident_id)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_bipa_damage_records (
        id              SERIAL PRIMARY KEY,
        incident_id     VARCHAR(80) NOT NULL,
        org_id          VARCHAR(100) NOT NULL,
        resident_ref    VARCHAR(120) NOT NULL,
        culpability     VARCHAR(20) NOT NULL,
        statutory_amount_usd INTEGER NOT NULL,
        statute_ref     VARCHAR(80) NOT NULL DEFAULT '740-ILCS-14/20',
        accrued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(org_id, incident_id, resident_ref)
      )
    `);
    _tablesEnsured = true;
  } catch (err: any) {
    logger.warn('breach_notice_ensure_tables_failed', { err: err?.message });
  }
}

// ── Notice planner (pure) ───────────────────────────────────────────────────
/**
 * Decide which recipients to notify for a given incident, applying the
 * statutory thresholds. Pure function — no I/O — so the planner is unit-
 * testable in isolation.
 */
export function planNotices(input: BreachIncidentInput): BreachRecipient[] {
  const out: BreachRecipient[] = [];
  let totalConsumers = 0;
  for (const bucket of input.affectedResidents) {
    if (bucket.count <= 0) continue;
    totalConsumers += bucket.count;
    if (bucket.state === 'NY') {
      out.push('NY_RESIDENTS');
      if (bucket.count > NY_AG_THRESHOLD) {
        // §899-aa(8)(a) — concurrent notice to AG, DOS, NYS Police.
        out.push('NY_OAG', 'NY_DOS', 'NYS_POLICE');
      }
    } else if (bucket.state === 'MA') {
      // c.93H §3(b) — notice to OAG, OCABR, and affected residents.
      out.push('MA_RESIDENTS', 'MA_AG', 'MA_OCABR');
    } else if (bucket.state === 'IL') {
      // BIPA — direct to affected residents; per-resident statutory
      // damage records accrue separately (see fileBreachIncident).
      out.push('IL_RESIDENTS');
    }
  }
  // task-398: GLBA Safeguards Rule §314.5(a) — federal FTC notice when the
  // aggregate affected-consumer count meets or exceeds 500, UNLESS the
  // §314.2(m) "notification event" definition's encryption carve-out
  // applies (information was encrypted AND the encryption key was not
  // accessed or acquired). We currently honour the carve-out only when
  // the caller positively asserts encryptionStatus='encrypted'; 'unknown'
  // / 'unencrypted' / undefined still triggers notice — fail-safe per
  // §314.5 plain reading. NOTE (review-comment-2 follow-up): the
  // BreachIncidentInput shape does not yet carry an explicit
  // key-compromise indicator; until that field is added, treating any
  // 'encrypted' assertion as fully carved out is the *less-conservative*
  // branch. A future revision should narrow this to require both
  // encryptionStatus==='encrypted' AND keysCompromised===false.
  if (totalConsumers >= FTC_GLBA_THRESHOLD && input.encryptionStatus !== 'encrypted') {
    out.push('FTC');
  }
  // Dedupe while preserving order.
  return Array.from(new Set(out));
}

// ── Notice template renderer ────────────────────────────────────────────────
function renderNoticeBody(
  recipient: BreachRecipient,
  input: BreachIncidentInput,
  bucket: AffectedResidentBucket,
): { subject: string; body: string } {
  const cats = input.dataCategories.join(', ') || 'personal information';
  const occurred = input.occurredAt ?? 'date unknown';
  const containment = input.containmentSummary ?? 'Investigation ongoing; containment in progress.';
  const enc = input.encryptionStatus ?? 'unknown';

  const orgLine = `Reporting entity: ${input.orgId}`;
  const incidentLine = `Incident: ${input.incidentId}`;
  const contactLine = `Contact: ${input.contact.name} <${input.contact.email}>${input.contact.phone ? ' (' + input.contact.phone + ')' : ''}`;
  const factsBlock = [
    `- Discovered: ${input.discoveredAt}`,
    `- Occurred:   ${occurred}`,
    `- Nature:     ${input.natureOfBreach}`,
    `- Data categories exposed: ${cats}`,
    `- Encryption status at time of breach: ${enc}`,
    `- Affected ${bucket.state} residents: ${bucket.count}`,
    `- Containment + remediation: ${containment}`,
  ].join('\n');

  switch (recipient) {
    case 'NY_RESIDENTS':
      return {
        subject: `Notice of Data Breach — ${input.orgId} (NY SHIELD §899-aa)`,
        body: `# Notice of Data Breach\n\nDear New York Resident,\n\nWe are writing pursuant to New York General Business Law §899-aa to notify you that your private information may have been exposed in a security incident.\n\n${factsBlock}\n\nYou may obtain a copy of the New York Attorney General's identity-theft prevention guide at https://ag.ny.gov/.\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    case 'NY_OAG':
      return {
        subject: `§899-aa Breach Notification — ${input.orgId} / Incident ${input.incidentId}`,
        body: `# §899-aa(8)(a) Concurrent Notification — Office of the Attorney General\n\nThis filing is submitted pursuant to NY GBL §899-aa(8)(a). Affected New York residents exceed the statutory 500-resident threshold.\n\n${factsBlock}\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    case 'NY_DOS':
      return {
        subject: `§899-aa Breach Notification — NY Department of State / Incident ${input.incidentId}`,
        body: `# §899-aa(8)(a) Concurrent Notification — NY Department of State\n\nThis filing is submitted pursuant to NY GBL §899-aa(8)(a). The NY Department of State (Division of Consumer Protection) is being notified concurrently with the NY OAG and NYS Police.\n\n${factsBlock}\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    case 'NYS_POLICE':
      return {
        subject: `§899-aa Breach Notification — NYS Police / Incident ${input.incidentId}`,
        body: `# §899-aa(8)(a) Concurrent Notification — New York State Police (Cyber Analysis Unit)\n\nThis filing is submitted pursuant to NY GBL §899-aa(8)(a) (concurrent agency notification when affected NY residents exceed 500).\n\n${factsBlock}\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    case 'MA_RESIDENTS':
      return {
        subject: `Notice of Data Breach — ${input.orgId} (M.G.L. c.93H §3)`,
        body: `# Notice of Data Breach\n\nDear Massachusetts Resident,\n\nWe are writing pursuant to Massachusetts General Laws c.93H §3 to notify you that your personal information may have been exposed in a security incident.\n\n${factsBlock}\n\nYou may file a complaint with the Massachusetts Office of Consumer Affairs and Business Regulation (OCABR) and the Office of the Attorney General. You also have the right to obtain a police report and to place a security freeze on your consumer reports at no charge.\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    case 'MA_AG':
      return {
        subject: `c.93H §3 Breach Notification — MA Attorney General / Incident ${input.incidentId}`,
        body: `# c.93H §3 Notification — Office of the Attorney General of Massachusetts\n\nThis filing is submitted pursuant to M.G.L. c.93H §3(b).\n\n${factsBlock}\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    case 'MA_OCABR':
      return {
        subject: `c.93H §3 Breach Notification — OCABR / Incident ${input.incidentId}`,
        body: `# c.93H §3 Notification — Office of Consumer Affairs and Business Regulation\n\nThis filing is submitted pursuant to M.G.L. c.93H §3(b).\n\n${factsBlock}\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    case 'IL_RESIDENTS':
      return {
        subject: `Notice of Biometric Information Incident — ${input.orgId} (740 ILCS 14/15)`,
        body: `# Notice of Biometric Information Incident\n\nDear Illinois Resident,\n\nWe are writing under the Illinois Biometric Information Privacy Act (740 ILCS 14) to notify you that biometric identifiers or biometric information that we held may have been compromised.\n\n${factsBlock}\n\nYou have a private right of action under 740 ILCS 14/20. You may pursue liquidated damages of $1,000 (negligent) or $5,000 (intentional/reckless) per violation, plus attorney's fees and costs.\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    case 'FTC': {
      // task-398: GLBA Safeguards Rule §314.5(b) content elements.
      // The bucket passed in for the FTC recipient is a synthesised
      // aggregate (state='US') summing across all per-state buckets so
      // the notice carries the federal-scope consumer count.
      const factsBlockFederal = [
        `- Discovered: ${input.discoveredAt}`,
        `- Occurred:   ${occurred}`,
        `- Nature:     ${input.natureOfBreach}`,
        `- Data categories exposed: ${cats}`,
        `- Encryption status at time of breach: ${enc}`,
        `- Aggregate affected consumers (all states): ${bucket.count}`,
        `- Containment + remediation: ${containment}`,
      ].join('\n');
      return {
        subject: `GLBA Safeguards Rule §314.5 Notification — ${input.orgId} / Incident ${input.incidentId}`,
        body: `# 16 C.F.R. §314.5 Notification — Federal Trade Commission\n\nThis notification is submitted pursuant to the FTC Safeguards Rule, 16 C.F.R. §314.5, no later than 30 days after discovery, in connection with a notification event involving the unencrypted customer information of 500 or more consumers.\n\n${factsBlockFederal}\n\n${orgLine}\n${contactLine}\n${incidentLine}\n`,
      };
    }
  }
}

function noticeId(orgId: string, incidentId: string, recipient: BreachRecipient): string {
  // Hash includes orgId so two tenants reusing the same caller-side
  // incident_id (e.g. ticket number) produce distinct notice ids and
  // cannot collide on the notice_id PRIMARY KEY.
  return 'bn_' + createHash('sha256')
    .update(orgId + '|' + incidentId + '|' + recipient)
    .digest('hex').slice(0, 24);
}

// ── Public API ──────────────────────────────────────────────────────────────
export interface FileBreachResult {
  incidentId: string;
  notices: Array<BreachNoticeDraft & {
    deliveryStatus: DeliveryStatus;
    providerRef?: string;
    deliveryError?: string;
    camActionId?: string;
    auditRecordId?: string;
  }>;
  bipaRecords: Array<{ residentRef: string; culpability: string; statutoryAmountUSD: number }>;
}

/**
 * File a breach incident: persist, draft notices per state thresholds,
 * route to CAM, dispatch outbound, append the audit-chain record.
 *
 * Idempotent on `incidentId` for ALL side effects: re-firing the same
 * incident short-circuits before dispatch / CAM / audit-append, and
 * returns the previously-filed notices + BIPA records. Critical because
 * duplicate statutory filings to NY OAG / MA AG / OCABR / NYS Police
 * would themselves be a regulatory and reputational incident.
 */
export async function fileBreachIncident(input: BreachIncidentInput): Promise<FileBreachResult> {
  if (!input?.incidentId || !input.orgId || !input.discoveredAt || !input.natureOfBreach) {
    throw new Error('breach_incident_missing_required_fields');
  }
  if (!Array.isArray(input.affectedResidents) || input.affectedResidents.length === 0) {
    throw new Error('breach_incident_missing_affected_residents');
  }
  if (!input.contact?.name || !input.contact?.email) {
    throw new Error('breach_incident_missing_contact');
  }

  await ensureTables();

  // 1) Persist incident — INSERT … RETURNING tells us whether THIS call
  // is the first writer for this incident. If a row already existed
  // (RETURNING is empty under ON CONFLICT DO NOTHING), we are a replay
  // and MUST NOT re-dispatch / re-audit / re-write CAM. Read back and
  // return cached state.
  let isNewIncident = true;
  if (db) {
    const insR: any = await db.execute(sql`
      INSERT INTO nv_breach_incidents
        (incident_id, org_id, discovered_at, occurred_at, nature_of_breach,
         data_categories, affected_residents, containment_summary,
         encryption_status, estimated_cost_usd, bipa_culpability, contact, filed_by)
      VALUES
        (${input.incidentId}, ${input.orgId}, ${input.discoveredAt}::timestamptz,
         ${input.occurredAt ?? null}, ${input.natureOfBreach},
         ${JSON.stringify(input.dataCategories ?? [])}::jsonb,
         ${JSON.stringify(input.affectedResidents)}::jsonb,
         ${input.containmentSummary ?? null},
         ${input.encryptionStatus ?? 'unknown'},
         ${input.estimatedCostUSD ?? null},
         ${input.bipaCulpability ?? null},
         ${JSON.stringify(input.contact)}::jsonb,
         ${input.filedBy ?? null})
      ON CONFLICT (org_id, incident_id) DO NOTHING
      RETURNING incident_id
    `);
    const insRows = (insR.rows ?? insR) as any[];
    isNewIncident = insRows.length > 0;
  }

  if (!isNewIncident) {
    // Replay: surface the previously-filed notices/records WITHOUT
    // re-running any external side effect. The dispatcher and audit
    // chain are deliberately not invoked.
    const cached = await getBreachIncident(input.incidentId, input.orgId);
    const cachedNotices = (cached?.notices ?? []) as any[];
    const cachedBipa    = (cached?.bipaRecords ?? []) as any[];
    logger.info('breach_incident_replay_short_circuit', {
      incidentId: input.incidentId,
      orgId: input.orgId,
      notices: cachedNotices.length,
      bipaRecords: cachedBipa.length,
    });
    return {
      incidentId: input.incidentId,
      notices: cachedNotices.map((n) => ({
        noticeId:        n.notice_id,
        incidentId:      n.incident_id,
        orgId:           n.org_id,
        state:           n.state,
        recipient:       n.recipient,
        channel:         n.channel,
        destination:     n.destination,
        template:        n.template,
        policyCode:      n.policy_code,
        subject:         n.subject ?? '',
        bodyMarkdown:    n.body_md ?? '',
        metadata:        n.metadata ?? {},
        deliveryStatus:  n.delivery_status,
        providerRef:     n.provider_ref ?? undefined,
        deliveryError:   n.delivery_error ?? undefined,
        camActionId:     n.cam_action_id ?? undefined,
        auditRecordId:   n.audit_record_id ?? undefined,
      })),
      bipaRecords: cachedBipa.map((r) => ({
        residentRef:        r.resident_ref,
        culpability:        r.culpability,
        statutoryAmountUSD: Number(r.statutory_amount_usd),
      })),
    };
  }

  // 2) Plan + draft notices.
  const recipients = planNotices(input);
  // task-398: pre-compute the federal aggregate bucket for FTC §314.5
  // (sum of all per-state counts; FTC notice is consumer-count-driven
  // and not bound to a single state).
  const aggregateUSBucket: AffectedResidentBucket = {
    state: 'US',
    count: input.affectedResidents.reduce((s, b) => s + (b.count > 0 ? b.count : 0), 0),
  };
  const drafts: BreachNoticeDraft[] = [];
  for (const recipient of recipients) {
    const spec = RECIPIENTS[recipient];
    const state: BreachState = recipient === 'FTC' ? 'US'
                              : recipient.startsWith('NY') ? 'NY'
                              : recipient.startsWith('MA') ? 'MA'
                              : 'IL';
    const bucket = state === 'US'
      ? aggregateUSBucket
      : input.affectedResidents.find(b => b.state === state);
    if (!bucket) continue;
    const { subject, body } = renderNoticeBody(recipient, input, bucket);
    drafts.push({
      noticeId: noticeId(input.orgId, input.incidentId, recipient),
      incidentId: input.incidentId,
      orgId: input.orgId,
      state,
      recipient,
      channel: spec.channel,
      destination: spec.destination,
      template: spec.template,
      policyCode: spec.policyCode,
      subject,
      bodyMarkdown: body,
      metadata: {
        affectedCount: bucket.count,
        dataCategories: input.dataCategories,
        encryptionStatus: input.encryptionStatus ?? 'unknown',
      },
    });
  }

  // 3) For each draft: persist row, write CAM action, dispatch, audit.
  const results: FileBreachResult['notices'] = [];
  for (const draft of drafts) {
    if (db) {
      await db.execute(sql`
        INSERT INTO nv_breach_notices
          (notice_id, incident_id, org_id, state, recipient, channel,
           destination, template, policy_code, subject, body_md, metadata,
           delivery_status)
        VALUES
          (${draft.noticeId}, ${draft.incidentId}, ${draft.orgId},
           ${draft.state}, ${draft.recipient}, ${draft.channel},
           ${draft.destination}, ${draft.template}, ${draft.policyCode},
           ${draft.subject}, ${draft.bodyMarkdown},
           ${JSON.stringify(draft.metadata)}::jsonb, 'pending')
        ON CONFLICT (org_id, incident_id, recipient) DO NOTHING
      `);
    }

    // CAM action — Compliance owner queue picks this up.
    // Include orgId so the action_id key is unique across tenants that
    // happen to use the same caller-side incident id.
    const camId = camActionId(['breach', draft.orgId, draft.policyCode, draft.recipient, draft.incidentId]);
    await writeCamAction({
      actionId: camId,
      orgId: draft.orgId,
      framework: 'breach',
      controlId: draft.policyCode + '.' + draft.recipient,
      severity: 'critical',
      title: `Breach notice: ${draft.recipient} — ${draft.incidentId}`,
      description: `Auto-generated ${draft.template} draft is queued for delivery to ${draft.destination} (${draft.channel}). Owner: Compliance.`,
      triggeredBy: './jrx-breach-notice-service',
      evidenceRef: draft.noticeId,
      metadata: {
        policyCode: draft.policyCode,
        incidentId: draft.incidentId,
        recipient: draft.recipient,
        state: draft.state,
        channel: draft.channel,
        destination: draft.destination,
        affectedCount: draft.metadata.affectedCount,
      },
    });

    // Outbound dispatch.
    let dispatch: BreachDispatchResult;
    try {
      dispatch = await _dispatcher(draft);
    } catch (err: any) {
      dispatch = { channel: draft.channel, status: 'failed', error: err?.message ?? String(err) };
    }

    // Audit-chain append (best-effort: a chain failure must NOT swallow
    // the dispatch result, but it MUST be reflected in the row so a
    // reviewer sees the gap).
    let auditId: string | undefined;
    let auditError: string | undefined;
    try {
      const rec = await appendAuditRecord({
        eventType: `compliance.breach.notice.${draft.state.toLowerCase()}.${draft.recipient.toLowerCase()}`,
        payload: JSON.stringify({
          incidentId: draft.incidentId,
          orgId: draft.orgId,
          noticeId: draft.noticeId,
          recipient: draft.recipient,
          channel: draft.channel,
          destination: draft.destination,
          policyCode: draft.policyCode,
          template: draft.template,
          deliveryStatus: dispatch.status,
          providerRef: dispatch.providerRef,
          deliveryError: dispatch.error,
          affectedCount: draft.metadata.affectedCount,
          subjectHash: createHash('sha256').update(draft.subject).digest('hex').slice(0, 16),
          bodyHash: createHash('sha256').update(draft.bodyMarkdown).digest('hex').slice(0, 16),
        }),
      });
      auditId = rec.id;
    } catch (err: any) {
      auditError = err?.message ?? String(err);
      logger.warn('breach_notice_audit_append_failed', {
        incidentId: draft.incidentId, recipient: draft.recipient, err: auditError,
      });
    }

    if (db) {
      await db.execute(sql`
        UPDATE nv_breach_notices SET
          delivery_status = ${dispatch.status},
          provider_ref    = ${dispatch.providerRef ?? null},
          delivery_error  = ${dispatch.error ?? auditError ?? null},
          cam_action_id   = ${camId},
          audit_record_id = ${auditId ?? null},
          delivered_at    = ${dispatch.status === 'sent' ? sql`NOW()` : sql`NULL`}
        WHERE notice_id = ${draft.noticeId}
      `);
    }

    results.push({
      ...draft,
      deliveryStatus: dispatch.status,
      providerRef: dispatch.providerRef,
      deliveryError: dispatch.error ?? auditError,
      camActionId: camId,
      auditRecordId: auditId,
    });
  }

  // 4) IL BIPA per-affected-resident statutory damage rows.
  const bipaRecords: FileBreachResult['bipaRecords'] = [];
  const ilBucket = input.affectedResidents.find(b => b.state === 'IL');
  if (ilBucket && ilBucket.count > 0) {
    const culpability = input.bipaCulpability ?? 'negligent';
    const amount = culpability === 'intentional' ? 5000 : 1000;
    const ids = (ilBucket.residentIds && ilBucket.residentIds.length > 0)
      ? ilBucket.residentIds
      : Array.from({ length: ilBucket.count }, (_, i) =>
          `il-resident-${input.incidentId}-${String(i + 1).padStart(6, '0')}`);
    for (const residentRef of ids) {
      if (db) {
        await db.execute(sql`
          INSERT INTO nv_bipa_damage_records
            (incident_id, org_id, resident_ref, culpability, statutory_amount_usd)
          VALUES
            (${input.incidentId}, ${input.orgId}, ${residentRef},
             ${culpability}, ${amount})
          ON CONFLICT (org_id, incident_id, resident_ref) DO NOTHING
        `);
      }
      bipaRecords.push({ residentRef, culpability, statutoryAmountUSD: amount });
    }
  }

  logger.info('breach_incident_filed', {
    incidentId: input.incidentId,
    orgId: input.orgId,
    notices: results.length,
    bipaRecords: bipaRecords.length,
  });

  return { incidentId: input.incidentId, notices: results, bipaRecords };
}

/**
 * Read back an incident (notices + delivery status + BIPA records).
 *
 * `orgId` is REQUIRED to keep tenant isolation across the read path —
 * the table primary key is composite `(org_id, incident_id)`, and notices
 * / BIPA rows are looked up on the same composite. A caller that does
 * not know the org cannot see another tenant's filings.
 */
export async function getBreachIncident(incidentId: string, orgId: string): Promise<{
  incident: any | null;
  notices: any[];
  bipaRecords: any[];
} | null> {
  if (!db) return null;
  if (!orgId) {
    throw new Error('breach_get_incident_org_required');
  }
  const incR: any = await db.execute(sql`
    SELECT * FROM nv_breach_incidents
    WHERE incident_id = ${incidentId} AND org_id = ${orgId}
  `);
  const incident = (incR.rows ?? incR)[0] ?? null;
  if (!incident) return { incident: null, notices: [], bipaRecords: [] };
  const notR: any = await db.execute(sql`
    SELECT * FROM nv_breach_notices
    WHERE incident_id = ${incidentId} AND org_id = ${orgId}
    ORDER BY created_at ASC
  `);
  const bipaR: any = await db.execute(sql`
    SELECT resident_ref, culpability, statutory_amount_usd, accrued_at
    FROM nv_bipa_damage_records
    WHERE incident_id = ${incidentId} AND org_id = ${orgId}
    ORDER BY id ASC
  `);
  return {
    incident,
    notices: notR.rows ?? notR,
    bipaRecords: bipaR.rows ?? bipaR,
  };
}

export const nvBreachNoticeService = {
  fileBreachIncident,
  getBreachIncident,
  planNotices,
  setBreachDispatcher,
  resetBreachDispatcher,
  RECIPIENTS,
  NY_AG_THRESHOLD,
  FTC_GLBA_THRESHOLD,
};

export default nvBreachNoticeService;
