/**
 * task-356 — Real outbound-transport coverage for the breach-notice
 * pipeline. Exercises the SMTP path via nodemailer's built-in
 * `jsonTransport` (no network) so we can prove the production default
 * actually transmits when configured, captures provider refs, and
 * surfaces failures per recipient.
 *
 * Also covers the fail-closed mode (NV_BREACH_REQUIRE_DELIVERY=1)
 * which flips queued-stub fallbacks to delivery_status='failed'.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nodemailer from 'nodemailer';

interface NoticeRow {
  notice_id: string; org_id: string; incident_id: string;
  recipient: string; channel: string;
  delivery_status: string; provider_ref: string | null; delivery_error: string | null;
}
const state = {
  incidents: [] as Array<{ incident_id: string; org_id: string }>,
  notices: [] as NoticeRow[],
};

vi.mock('../../src/db/index.js', () => {
  const execute = vi.fn(async (q: any) => {
    const text = String((q?.strings ?? []).join(' ')).replace(/\s+/g, ' ').trim();
    const values: any[] = q?.values ?? [];
    if (/^CREATE (TABLE|INDEX)/i.test(text)) return { rows: [] };

    if (/^INSERT INTO nv_breach_incidents/i.test(text)) {
      const [incident_id, org_id] = values;
      const existed = !!state.incidents.find(
        (r) => r.incident_id === incident_id && r.org_id === org_id);
      if (!existed) state.incidents.push({ incident_id, org_id });
      return { rows: existed ? [] : [{ incident_id }] };
    }
    if (/^INSERT INTO nv_breach_notices/i.test(text)) {
      const [notice_id, incident_id, org_id, , recipient, channel] = values;
      if (!state.notices.find((n) => n.notice_id === notice_id)) {
        state.notices.push({
          notice_id, org_id, incident_id, recipient, channel,
          delivery_status: 'pending', provider_ref: null, delivery_error: null,
        });
      }
      return { rows: [] };
    }
    if (/^UPDATE nv_breach_notices SET/i.test(text)) {
      const [delivery_status, provider_ref, delivery_error, , , , notice_id] = values;
      const r = state.notices.find((n) => n.notice_id === notice_id);
      if (r) {
        r.delivery_status = delivery_status;
        r.provider_ref = provider_ref;
        r.delivery_error = delivery_error;
      }
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { db: { execute }, pool: {} };
});

vi.mock('../../src/middleware/jrx-sdk-tracking-middleware.js', () => ({
  appendAuditRecord: vi.fn(async () => ({ id: 'aud_x', hash: 'h' })),
}));

vi.mock('../../src/services/compliance/jrx-cam-writer.js', () => ({
  writeCamAction: vi.fn(async () => ({ id: 1, action_id: 'cam_x', deduped: false })),
  camActionId: vi.fn(() => 'cam_x_' + Math.random().toString(36).slice(2, 10)),
}));

const svc = await import('../../src/services/compliance/jrx-breach-notice-service.js');
const {
  fileBreachIncident, resetBreachDispatcher, __setSmtpTransportForTests,
} = svc;

beforeEach(() => {
  state.incidents.length = 0;
  state.notices.length = 0;
  resetBreachDispatcher();
  __setSmtpTransportForTests(null);
  delete process.env.NV_BREACH_REQUIRE_DELIVERY;
});
afterEach(() => {
  __setSmtpTransportForTests(null);
  delete process.env.NV_BREACH_REQUIRE_DELIVERY;
});

const baseInput = (overrides: any = {}) => ({
  incidentId: 'inc-tx-001',
  orgId: 'org-tx-A',
  discoveredAt: new Date().toISOString(),
  natureOfBreach: 'Unauthorised disclosure of resident PII',
  dataCategories: ['name', 'SSN'],
  affectedResidents: [{ state: 'NY', count: 100 }, { state: 'MA', count: 50 }],
  contact: { name: 'Officer', email: 'officer@test.example' },
  ...overrides,
});

describe('breach-notice real outbound transport (SMTP via nodemailer)', () => {
  it('SMTP transport: every email recipient gets delivery_status=sent with smtp:<messageId> provider ref', async () => {
    // jsonTransport is a built-in nodemailer transport that captures the
    // assembled MIME message in info.message and returns a real messageId
    // — no network, but the entire sendMail pipeline runs end-to-end.
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sentSpy = vi.spyOn(transport, 'sendMail');
    __setSmtpTransportForTests(transport);

    const out = await fileBreachIncident(baseInput({
      incidentId: 'inc-tx-smtp-ok',
      affectedResidents: [{ state: 'NY', count: 100 }], // resident-letter only
    }));

    // 1 email recipient — actually sent via nodemailer.
    expect(sentSpy).toHaveBeenCalledTimes(1);
    const call = sentSpy.mock.calls[0]![0]!;
    expect(call.to).toBe('ny-resident-letter@notice.jurexio.com');
    expect(call.headers['X-Jurexio-Notice-Id']).toBe(out.notices[0]!.noticeId);
    expect(call.headers['X-Jurexio-Org-Id']).toBe('org-tx-A');

    expect(out.notices[0]!.deliveryStatus).toBe('sent');
    expect(out.notices[0]!.providerRef).toMatch(/^smtp:/);

    const persisted = state.notices.find((n) => n.notice_id === out.notices[0]!.noticeId)!;
    expect(persisted.delivery_status).toBe('sent');
    expect(persisted.provider_ref).toMatch(/^smtp:/);
  });

  it('SMTP failure on a recipient surfaces as delivery_status=failed with the underlying error captured', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    vi.spyOn(transport, 'sendMail').mockRejectedValueOnce(new Error('mailbox-full'));
    __setSmtpTransportForTests(transport);

    const out = await fileBreachIncident(baseInput({
      incidentId: 'inc-tx-smtp-fail',
      affectedResidents: [{ state: 'NY', count: 100 }],
    }));

    expect(out.notices[0]!.deliveryStatus).toBe('failed');
    expect(out.notices[0]!.deliveryError).toMatch(/mailbox-full/);
    const persisted = state.notices.find((n) => n.notice_id === out.notices[0]!.noticeId)!;
    expect(persisted.delivery_status).toBe('failed');
    expect(persisted.delivery_error).toMatch(/mailbox-full/);
  });

  it('Mixed channel run: email recipients are SMTP-sent; web_portal recipients fall back to queued (no SMTP transport for portals yet)', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sentSpy = vi.spyOn(transport, 'sendMail');
    __setSmtpTransportForTests(transport);

    const out = await fileBreachIncident(baseInput({
      incidentId: 'inc-tx-mixed',
      affectedResidents: [{ state: 'NY', count: 1000 }, { state: 'MA', count: 50 }],
    }));

    const emails = out.notices.filter((n) => n.channel === 'email');
    const portals = out.notices.filter((n) => n.channel === 'web_portal');

    // NY > 500 fan-out (4) + MA fan-out (3) = 7 notices total.
    // Email-channel destinations (4): NY_RESIDENTS, JRX_ECOSYSTEM_POLICE, MA_RESIDENTS,
    // MA_OCABR. Web-portal destinations (3): NY_OAG, NY_DOS, MA_AG.
    expect(emails.length + portals.length).toBe(out.notices.length);
    expect(sentSpy).toHaveBeenCalledTimes(emails.length);
    for (const n of emails) {
      expect(n.deliveryStatus).toBe('sent');
      expect(n.providerRef).toMatch(/^smtp:/);
    }
    for (const n of portals) {
      expect(n.deliveryStatus).toBe('queued');
      expect(n.providerRef).toMatch(/^queued:/);
    }
  });

  it('Fail-closed mode: NV_BREACH_REQUIRE_DELIVERY=1 with no transport flips queued recipients to failed (does not pretend success)', async () => {
    process.env.NV_BREACH_REQUIRE_DELIVERY = '1';
    // No SMTP transport, no explicit dispatcher → no real delivery available.

    const out = await fileBreachIncident(baseInput({
      incidentId: 'inc-tx-failclosed',
      affectedResidents: [{ state: 'NY', count: 100 }],
    }));

    expect(out.notices[0]!.deliveryStatus).toBe('failed');
    expect(out.notices[0]!.deliveryError).toMatch(/no_real_transport_configured/);
  });
});
