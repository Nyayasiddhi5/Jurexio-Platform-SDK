/**
 * task-356 — End-to-end coverage for the breach-notice pipeline.
 *
 * Guards we specifically protect:
 *   - Statutory thresholds: NY > 500 → concurrent OAG / DOS / NYS Police
 *   - MA always → OCABR + MA AG + residents (any non-zero count)
 *   - IL BIPA → per-resident statutory damage record at $1k (negligent)
 *     or $5k (intentional/reckless), one row per affected resident
 *   - CAM action emitted per notice (Compliance owner queue wiring)
 *   - Audit-chain append per notice (eventType compliance.breach.notice.*)
 *   - Outbound dispatcher invoked for every notice
 *   - Idempotency: re-firing the same incidentId doesn't duplicate notices
 *
 * Strategy: stub the DB layer with an in-memory map indexed by SQL-text
 * fragments (same approach as tests/integration/cam-reviewer-actions.test.ts),
 * mock appendAuditRecord to capture eventType + payload, install a counting
 * dispatcher, and exercise the pure public API
 * `fileBreachIncident` + `planNotices`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── In-memory fixtures ──────────────────────────────────────────────────────
type IncidentRow = {
  incident_id: string;
  org_id: string;
  [k: string]: unknown;
};
type NoticeRow = {
  notice_id: string;
  incident_id: string;
  recipient: string;
  state: string;
  channel: string;
  destination: string;
  template: string;
  policy_code: string;
  delivery_status: string;
  provider_ref: string | null;
  delivery_error: string | null;
  cam_action_id: string | null;
  audit_record_id: string | null;
};
type BipaRow = {
  incident_id: string;
  resident_ref: string;
  culpability: string;
  statutory_amount_usd: number;
};
type CamRow = {
  action_id: string;
  framework: string;
  control_id: string | null;
  severity: string;
  title: string;
  metadata: any;
};
type AuditRow = { id: string; eventType: string; payload: any };

const state: {
  incidents: IncidentRow[];
  notices: NoticeRow[];
  bipa: BipaRow[];
  cam: CamRow[];
  audit: AuditRow[];
  auditError: Error | null;
} = { incidents: [], notices: [], bipa: [], cam: [], audit: [], auditError: null };

beforeEach(() => {
  state.incidents = [];
  state.notices = [];
  state.bipa = [];
  state.cam = [];
  state.audit = [];
  state.auditError = null;
});

// ── Mocks (must be installed before importing the service) ──────────────────
vi.mock('../../src/db/index.js', () => {
  const execute = vi.fn(async (q: any) => {
    const text = String((q?.strings ?? []).join(' ')).replace(/\s+/g, ' ').trim();
    const values: any[] = q?.values ?? [];

    if (/^CREATE (TABLE|INDEX)/i.test(text)) return { rows: [] };

    if (/^INSERT INTO nv_breach_incidents/i.test(text)) {
      const [
        incident_id, org_id, _discoveredAt, _occurredAt, nature_of_breach,
        _dataCategoriesJson, _affectedJson, _containment, encryption_status,
        _cost, _bipa, _contactJson, _filedBy,
      ] = values;
      const existed = !!state.incidents.find(
        (r) => r.incident_id === incident_id && r.org_id === org_id);
      if (!existed) {
        state.incidents.push({
          incident_id, org_id, nature_of_breach, encryption_status,
        } as IncidentRow);
      }
      // RETURNING incident_id reflects whether THIS call inserted.
      return { rows: existed ? [] : [{ incident_id }] };
    }

    if (/^SELECT \* FROM nv_breach_incidents/i.test(text)) {
      const [incident_id, org_id] = values;
      const row = state.incidents.find(
        (r) => r.incident_id === incident_id && r.org_id === org_id);
      return { rows: row ? [row] : [] };
    }
    if (/^SELECT \* FROM nv_breach_notices WHERE incident_id/i.test(text)) {
      const [incident_id, org_id] = values;
      return { rows: state.notices.filter(
        (n) => n.incident_id === incident_id && n.org_id === org_id) };
    }
    if (/^SELECT resident_ref, culpability, statutory_amount_usd/i.test(text)) {
      const [incident_id, org_id] = values;
      return { rows: state.bipa.filter(
        (b) => b.incident_id === incident_id && b.org_id === org_id) };
    }

    if (/^INSERT INTO nv_breach_notices/i.test(text)) {
      const [
        notice_id, incident_id, org_id, stateCode, recipient, channel,
        destination, template, policy_code, _subject, _bodyMd, _metadataJson,
        delivery_status,
      ] = values;
      if (!state.notices.find((r) => r.notice_id === notice_id)) {
        state.notices.push({
          notice_id,
          incident_id,
          org_id,
          recipient,
          state: stateCode,
          channel,
          destination,
          template,
          policy_code,
          delivery_status,
          provider_ref: null,
          delivery_error: null,
          cam_action_id: null,
          audit_record_id: null,
        });
      }
      return { rows: [] };
    }

    if (/^UPDATE nv_breach_notices SET/i.test(text)) {
      // Param order: status, providerRef, deliveryError, camId, auditId,
      // (delivered_at nested sql — skipped at index 5), noticeId.
      const [delivery_status, provider_ref, delivery_error, cam_action_id, audit_record_id, , notice_id] = values;
      const row = state.notices.find((r) => r.notice_id === notice_id);
      if (row) {
        row.delivery_status = delivery_status;
        row.provider_ref = provider_ref;
        row.delivery_error = delivery_error;
        row.cam_action_id = cam_action_id;
        row.audit_record_id = audit_record_id;
      }
      return { rows: [] };
    }

    if (/^INSERT INTO nv_bipa_damage_records/i.test(text)) {
      const [incident_id, org_id, resident_ref, culpability, statutory_amount_usd] = values;
      if (!state.bipa.find((r) =>
        r.incident_id === incident_id && r.org_id === org_id && r.resident_ref === resident_ref)) {
        state.bipa.push({ incident_id, org_id, resident_ref, culpability, statutory_amount_usd });
      }
      return { rows: [] };
    }

    if (/^INSERT INTO nv_cam_actions/i.test(text)) {
      // 'pending' is a literal in the cam-writer SQL — not a parameter.
      const [
        action_id, _orgId, framework, control_id, severity, title,
        _description, _triggeredBy, _evidenceRef, metadataJson,
      ] = values;
      if (!state.cam.find((r) => r.action_id === action_id)) {
        let metadata: any = {};
        try { metadata = JSON.parse(metadataJson); } catch { /* ignore */ }
        state.cam.push({ action_id, framework, control_id, severity, title, metadata });
      }
      return { rows: [{ id: state.cam.length }] };
    }

    return { rows: [] };
  });
  return { db: { execute }, pool: {} };
});

vi.mock('../../src/middleware/jrx-sdk-tracking-middleware.js', () => ({
  appendAuditRecord: vi.fn(async ({ eventType, payload }: any) => {
    if (state.auditError) throw state.auditError;
    const rec = {
      id: `aud_${state.audit.length + 1}`,
      eventType,
      payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
      previousHash: 'prev_hash',
      recordHash: `rec_${state.audit.length + 1}`,
      createdAt: new Date().toISOString(),
    };
    state.audit.push(rec);
    return rec;
  }),
}));

// ── Import the service under test (after mocks) ─────────────────────────────
const svc = await import('../../src/services/compliance/jrx-breach-notice-service.js');
const { fileBreachIncident, getBreachIncident, planNotices, setBreachDispatcher, resetBreachDispatcher, NY_AG_THRESHOLD } = svc;

// Counting dispatcher — captures every draft handed to outbound delivery.
const dispatched: Array<{ recipient: string; channel: string; destination: string; noticeId: string }> = [];
beforeEach(() => {
  dispatched.length = 0;
  setBreachDispatcher(async (draft) => {
    dispatched.push({
      recipient: draft.recipient,
      channel: draft.channel,
      destination: draft.destination,
      noticeId: draft.noticeId,
    });
    return { channel: draft.channel, status: 'queued', providerRef: 'test:' + draft.noticeId };
  });
});

afterEach(() => resetBreachDispatcher());

// ── Test fixtures ───────────────────────────────────────────────────────────
function baseIncident(overrides: any = {}) {
  return {
    incidentId: 'inc-test-001',
    orgId: 'org-test',
    discoveredAt: '2026-05-13T10:00:00Z',
    occurredAt: '2026-05-12T22:00:00Z',
    natureOfBreach: 'Unauthorised access to a customer database via a leaked API key.',
    dataCategories: ['name', 'SSN', 'financial_account'],
    affectedResidents: [],
    containmentSummary: 'Key revoked; affected systems isolated; forensics engaged.',
    encryptionStatus: 'unencrypted' as const,
    contact: { name: 'Compliance Officer', email: 'compliance@test.example', phone: '+1-555-0100' },
    ...overrides,
  };
}

// ── planNotices() — pure threshold logic ────────────────────────────────────
describe('planNotices() — statutory thresholds', () => {
  it('NY ≤ 500 residents → resident letter only (no AG / DOS / NYS Police)', () => {
    const recipients = planNotices(baseIncident({
      affectedResidents: [{ state: 'NY', count: 500 }],
    }));
    expect(recipients).toEqual(['NY_RESIDENTS']);
  });

  it('NY > 500 residents → concurrent NY OAG + DOS + NYS Police + residents (§899-aa(8)(a))', () => {
    const recipients = planNotices(baseIncident({
      affectedResidents: [{ state: 'NY', count: NY_AG_THRESHOLD + 1 }],
    }));
    expect(recipients.sort()).toEqual(
      ['NY_DOS', 'NY_OAG', 'NY_RESIDENTS', 'NYS_POLICE'].sort(),
    );
  });

  it('MA → OCABR + MA AG + residents regardless of count (c.93H §3(b))', () => {
    const recipients = planNotices(baseIncident({
      affectedResidents: [{ state: 'MA', count: 1 }],
    }));
    expect(recipients.sort()).toEqual(['MA_AG', 'MA_OCABR', 'MA_RESIDENTS'].sort());
  });

  it('IL → resident letter only (state-AG path is the per-resident BIPA damage row)', () => {
    const recipients = planNotices(baseIncident({
      affectedResidents: [{ state: 'IL', count: 3 }],
    }));
    expect(recipients).toEqual(['IL_RESIDENTS']);
  });

  it('multi-state incident composes per-state recipients', () => {
    const recipients = planNotices(baseIncident({
      affectedResidents: [
        { state: 'NY', count: 750 },   // > 500, full NY chain
        { state: 'MA', count: 12 },    // MA chain
        { state: 'IL', count: 4 },     // IL only
      ],
    }));
    expect(new Set(recipients)).toEqual(new Set([
      'NY_RESIDENTS', 'NY_OAG', 'NY_DOS', 'NYS_POLICE',
      'MA_RESIDENTS', 'MA_AG', 'MA_OCABR',
      'IL_RESIDENTS',
    ]));
  });

  it('zero-count buckets are ignored', () => {
    const recipients = planNotices(baseIncident({
      affectedResidents: [{ state: 'NY', count: 0 }, { state: 'MA', count: 5 }],
    }));
    expect(recipients.includes('NY_RESIDENTS')).toBe(false);
    expect(recipients).toContain('MA_RESIDENTS');
  });
});

// ── fileBreachIncident() — full pipeline ────────────────────────────────────
describe('fileBreachIncident() — full pipeline', () => {
  it('NY > 500 residents triggers concurrent OAG / DOS / NYS Police + residents, all dispatched + audited + CAM-routed', async () => {
    const out = await fileBreachIncident(baseIncident({
      incidentId: 'inc-ny-large',
      affectedResidents: [{ state: 'NY', count: 1200 }],
    }));

    const recipients = out.notices.map((n) => n.recipient).sort();
    expect(recipients).toEqual(['NYS_POLICE', 'NY_DOS', 'NY_OAG', 'NY_RESIDENTS'].sort());

    // Outbound dispatch invoked for every notice.
    expect(dispatched.map((d) => d.recipient).sort()).toEqual(recipients);
    // Statutory destinations include the AG portal + NYS Police mailbox.
    expect(dispatched.find((d) => d.recipient === 'NY_OAG')?.destination).toMatch(/ag\.ny\.gov/);
    expect(dispatched.find((d) => d.recipient === 'NYS_POLICE')?.destination).toMatch(/troopers\.ny\.gov/);
    expect(dispatched.find((d) => d.recipient === 'NY_DOS')?.destination).toMatch(/its\.ny\.gov|ny\.gov/);

    // CAM action per notice, framework='breach'.
    expect(state.cam).toHaveLength(4);
    for (const r of state.cam) {
      expect(r.framework).toBe('breach');
      expect(r.severity).toBe('critical');
      expect(r.metadata.policyCode).toBe('POL-US-NYSHIELD-899-bb');
      expect(r.metadata.incidentId).toBe('inc-ny-large');
    }

    // Audit-chain record per notice with the canonical eventType prefix.
    expect(state.audit).toHaveLength(4);
    for (const a of state.audit) {
      expect(a.eventType).toMatch(/^compliance\.breach\.notice\.ny\./);
      expect(a.payload.incidentId).toBe('inc-ny-large');
      expect(a.payload.deliveryStatus).toBe('queued');
    }

    // Persisted notice rows reflect dispatch + audit linkage.
    expect(state.notices).toHaveLength(4);
    for (const n of state.notices) {
      expect(n.delivery_status).toBe('queued');
      expect(n.provider_ref).toMatch(/^test:/);
      expect(n.cam_action_id).toBeTruthy();
      expect(n.audit_record_id).toBeTruthy();
    }
    // No BIPA records for an NY-only incident.
    expect(state.bipa).toHaveLength(0);
  });

  it('NY ≤ 500 residents stays at resident-letter only (no AG / DOS / NYS Police filings)', async () => {
    const out = await fileBreachIncident(baseIncident({
      incidentId: 'inc-ny-small',
      affectedResidents: [{ state: 'NY', count: 250 }],
    }));
    expect(out.notices.map((n) => n.recipient)).toEqual(['NY_RESIDENTS']);
    expect(state.cam).toHaveLength(1);
    expect(state.audit).toHaveLength(1);
    // No filings to AG / DOS / NYS Police were dispatched.
    expect(dispatched.find((d) => d.recipient === 'NY_OAG')).toBeUndefined();
    expect(dispatched.find((d) => d.recipient === 'NY_DOS')).toBeUndefined();
    expect(dispatched.find((d) => d.recipient === 'NYS_POLICE')).toBeUndefined();
  });

  it('MA breach → OCABR + MA AG + residents (c.93H §3(b))', async () => {
    const out = await fileBreachIncident(baseIncident({
      incidentId: 'inc-ma-001',
      affectedResidents: [{ state: 'MA', count: 42 }],
    }));
    const recipients = out.notices.map((n) => n.recipient).sort();
    expect(recipients).toEqual(['MA_AG', 'MA_OCABR', 'MA_RESIDENTS'].sort());

    // OCABR mailbox + MA AG portal both hit.
    expect(dispatched.find((d) => d.recipient === 'MA_OCABR')?.destination).toMatch(/state\.ma\.us/);
    expect(dispatched.find((d) => d.recipient === 'MA_AG')?.destination).toMatch(/mass\.gov/);

    // CAM + audit per notice.
    expect(state.cam).toHaveLength(3);
    for (const r of state.cam) {
      expect(r.metadata.policyCode).toBe('POL-US-MA201CMR17-03');
    }
    expect(state.audit).toHaveLength(3);
    expect(state.audit.every((a) => a.eventType.startsWith('compliance.breach.notice.ma.'))).toBe(true);
  });

  it('IL BIPA breach → resident letter + per-affected-resident statutory damage row at $1k (negligent)', async () => {
    const out = await fileBreachIncident(baseIncident({
      incidentId: 'inc-il-001',
      affectedResidents: [{ state: 'IL', count: 5 }],
      bipaCulpability: 'negligent',
    }));
    expect(out.notices.map((n) => n.recipient)).toEqual(['IL_RESIDENTS']);
    expect(out.bipaRecords).toHaveLength(5);
    for (const r of out.bipaRecords) {
      expect(r.statutoryAmountUSD).toBe(1000);
      expect(r.culpability).toBe('negligent');
    }
    // Persisted to the damage table.
    expect(state.bipa).toHaveLength(5);
    expect(new Set(state.bipa.map((r) => r.statutory_amount_usd))).toEqual(new Set([1000]));
    // Per-resident IDs are unique (per-scan accrual, Cothron v. White Castle).
    const refs = new Set(state.bipa.map((r) => r.resident_ref));
    expect(refs.size).toBe(5);
  });

  it('IL BIPA intentional/reckless culpability → $5k per resident', async () => {
    const out = await fileBreachIncident(baseIncident({
      incidentId: 'inc-il-002',
      affectedResidents: [{ state: 'IL', count: 3, residentIds: ['emp-001', 'emp-002', 'emp-003'] }],
      bipaCulpability: 'intentional',
    }));
    expect(out.bipaRecords).toHaveLength(3);
    expect(out.bipaRecords.every((r) => r.statutoryAmountUSD === 5000)).toBe(true);
    // Explicit resident IDs are honoured.
    expect(state.bipa.map((r) => r.resident_ref).sort()).toEqual(['emp-001', 'emp-002', 'emp-003']);
  });

  it('tenant isolation: two orgs reusing the same caller-side incidentId file independently — no replay suppression', async () => {
    // Both tenants pick the same human-friendly incident id (e.g. ticket #INC-42).
    // The composite (org_id, incident_id) PK must keep them isolated:
    // BOTH orgs must produce the full NY notice fan-out (residents + OAG +
    // DOS + NYS Police), distinct notice rows, distinct CAM rows, distinct
    // audit events, and distinct dispatch attempts.
    const sharedId = 'INC-42';
    const orgA = baseIncident({
      incidentId: sharedId, orgId: 'org-tenant-A',
      affectedResidents: [{ state: 'NY', count: 1200 }],
    });
    const orgB = baseIncident({
      incidentId: sharedId, orgId: 'org-tenant-B',
      affectedResidents: [{ state: 'NY', count: 800 }],
    });

    const a = await fileBreachIncident(orgA);
    const b = await fileBreachIncident(orgB);

    // Each tenant got the full NY >500 fan-out (4 recipients).
    expect(a.notices.map((n) => n.recipient).sort()).toEqual(
      ['NYS_POLICE', 'NY_DOS', 'NY_OAG', 'NY_RESIDENTS']);
    expect(b.notices.map((n) => n.recipient).sort()).toEqual(
      ['NYS_POLICE', 'NY_DOS', 'NY_OAG', 'NY_RESIDENTS']);

    // Distinct notice ids per tenant — no PK collision on (notice_id).
    const aIds = new Set(a.notices.map((n) => n.noticeId));
    const bIds = new Set(b.notices.map((n) => n.noticeId));
    for (const id of aIds) expect(bIds.has(id)).toBe(false);

    // 4 + 4 = 8 notice rows, 8 CAM rows, 8 audit events, 8 dispatches.
    expect(state.notices.filter((n) => n.org_id === 'org-tenant-A')).toHaveLength(4);
    expect(state.notices.filter((n) => n.org_id === 'org-tenant-B')).toHaveLength(4);
    expect(state.cam).toHaveLength(8);
    expect(state.audit).toHaveLength(8);
    expect(dispatched).toHaveLength(8);

    // Read-back is org-scoped: tenant A cannot see tenant B's incident.
    const readA = await getBreachIncident(sharedId, 'org-tenant-A');
    const readB = await getBreachIncident(sharedId, 'org-tenant-B');
    expect(readA?.notices).toHaveLength(4);
    expect(readB?.notices).toHaveLength(4);
    expect(new Set(readA!.notices.map((n: any) => n.org_id))).toEqual(new Set(['org-tenant-A']));
    expect(new Set(readB!.notices.map((n: any) => n.org_id))).toEqual(new Set(['org-tenant-B']));
  });

  it('idempotency: re-firing the same incidentId short-circuits — no duplicate dispatch, audit, CAM or BIPA writes', async () => {
    const input = baseIncident({
      incidentId: 'inc-idem-001',
      affectedResidents: [{ state: 'NY', count: 600 }, { state: 'IL', count: 2 }],
      bipaCulpability: 'negligent',
    });
    const first = await fileBreachIncident(input);
    const noticesAfterFirst = state.notices.length;
    const camAfterFirst     = state.cam.length;
    const bipaAfterFirst    = state.bipa.length;
    const auditAfterFirst   = state.audit.length;
    const dispatchAfterFirst = dispatched.length;

    const replay = await fileBreachIncident(input);

    // External side effects MUST NOT fire on replay (statutory filings
    // to NY OAG / IL residents must not be transmitted twice).
    expect(state.notices).toHaveLength(noticesAfterFirst);
    expect(state.cam).toHaveLength(camAfterFirst);
    expect(state.bipa).toHaveLength(bipaAfterFirst);
    expect(state.audit).toHaveLength(auditAfterFirst);
    expect(dispatched).toHaveLength(dispatchAfterFirst);

    // Replay still returns the previously-filed notices + BIPA rows so
    // callers get a deterministic response.
    expect(replay.notices.map((n) => n.recipient).sort())
      .toEqual(first.notices.map((n) => n.recipient).sort());
    expect(replay.bipaRecords).toHaveLength(first.bipaRecords.length);
  });

  it('rejects malformed input (missing affected residents)', async () => {
    await expect(fileBreachIncident(baseIncident({
      incidentId: 'inc-bad-001',
      affectedResidents: [],
    }))).rejects.toThrow(/affected_residents|affectedResidents|missing/i);
  });

  it('rejects malformed input (missing contact)', async () => {
    await expect(fileBreachIncident(baseIncident({
      incidentId: 'inc-bad-002',
      affectedResidents: [{ state: 'NY', count: 10 }],
      contact: { name: '', email: '' } as any,
    }))).rejects.toThrow(/contact/i);
  });

  it('audit eventType reflects per-recipient routing (one event per recipient, not per state)', async () => {
    await fileBreachIncident(baseIncident({
      incidentId: 'inc-multi-001',
      affectedResidents: [{ state: 'NY', count: 700 }, { state: 'MA', count: 11 }],
    }));
    const eventTypes = state.audit.map((a) => a.eventType).sort();
    expect(eventTypes).toEqual([
      'compliance.breach.notice.ma.ma_ag',
      'compliance.breach.notice.ma.ma_ocabr',
      'compliance.breach.notice.ma.ma_residents',
      'compliance.breach.notice.ny.ny_dos',
      'compliance.breach.notice.ny.ny_oag',
      'compliance.breach.notice.ny.ny_residents',
      'compliance.breach.notice.ny.nys_police',
    ]);
  });
});
