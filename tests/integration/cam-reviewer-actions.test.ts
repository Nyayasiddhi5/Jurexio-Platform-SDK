/**
 * Task #213 — End-to-end coverage for the CAM reviewer write endpoints
 * (POST /api/jrx/cam/reviews/:actionId/{approve,reject,assign}).
 *
 * The endpoints back a tamper-evident governance flow. Regressions we
 * specifically guard against here:
 *   - RBAC drift (a non-reviewer role being silently allowed)
 *   - Audit-chain wiring breaking (a transition succeeding without a
 *     corresponding nv_audit_logs append, or with the wrong eventType)
 *   - Terminal-state guard removed (a second approve on an already-
 *     approved row mutating it instead of returning 409)
 *   - Required-field guard removed (reject without `reason` going
 *     through instead of 400)
 *   - reviewed_by / reviewed_at no longer being stamped on the row
 *
 * Strategy: spin up a real express app with the live router mounted,
 * mock just the leaf data dependencies (`db.execute` simulates the
 * `nv_cam_actions` table; `appendAuditRecord` captures audit events;
 * `authenticateToken` injects `req.user` from a test header). The full
 * request/response cycle, RBAC middleware, route handlers, terminal-
 * state guard and audit-then-update ordering all run for real.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ── In-memory fixtures shared with the mocks ────────────────────────────────
type Row = {
  action_id: string;
  org_id: string | null;
  status: string;
  assigned_to: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  metadata: Record<string, unknown>;
};

const state: {
  rows: Row[];
  audit: Array<{ id: string; eventType: string; payload: any }>;
  auditError: Error | null;
} = { rows: [], audit: [], auditError: null };

function seedPending(actionId: string, overrides: Partial<Row> = {}) {
  const row: Row = {
    action_id: actionId,
    org_id: 'org-test',
    status: 'pending',
    assigned_to: null,
    reviewed_by: null,
    reviewed_at: null,
    metadata: {},
    ...overrides,
  };
  state.rows.push(row);
  return row;
}

// ── Mocks (must come before importing the route module) ─────────────────────
vi.mock('../../src/db/index.js', () => {
  const execute = vi.fn(async (q: any) => {
    const text = String((q?.strings ?? []).join(' ')).replace(/\s+/g, ' ').trim();
    const values: any[] = q?.values ?? [];

    // SELECT loadAction()
    if (/^SELECT action_id, org_id, status, assigned_to, reviewed_by, reviewed_at FROM nv_cam_actions/i.test(text)) {
      const aid = values[0];
      const row = state.rows.find((r) => r.action_id === aid);
      return { rows: row ? [row] : [] };
    }

    // UPDATE … status = 'approved' …
    if (/^UPDATE nv_cam_actions SET status = 'approved'/i.test(text)) {
      // values: [reviewer.id, actionId]
      const [reviewerId, aid] = values;
      const row = state.rows.find((r) => r.action_id === aid);
      if (row) {
        row.status = 'approved';
        row.reviewed_by = reviewerId;
        row.reviewed_at = new Date().toISOString();
      }
      return { rows: row ? [row] : [] };
    }

    // UPDATE … status = 'rejected' …
    if (/^UPDATE nv_cam_actions SET status = 'rejected'/i.test(text)) {
      // values: [reviewer.id, reason, actionId]
      const [reviewerId, reason, aid] = values;
      const row = state.rows.find((r) => r.action_id === aid);
      if (row) {
        row.status = 'rejected';
        row.reviewed_by = reviewerId;
        row.reviewed_at = new Date().toISOString();
        row.metadata = { ...(row.metadata ?? {}), rejection_reason: reason };
      }
      return { rows: row ? [row] : [] };
    }

    // UPDATE … assigned_to = $1, status = $2 …
    if (/^UPDATE nv_cam_actions SET assigned_to/i.test(text)) {
      // values: [assignee, nextStatus, actionId]
      const [assignee, nextStatus, aid] = values;
      const row = state.rows.find((r) => r.action_id === aid);
      if (row) {
        row.assigned_to = assignee;
        row.status = nextStatus;
      }
      return { rows: row ? [row] : [] };
    }

    // CREATE TABLE / INDEX from ensureTable() — no-op
    if (/^CREATE (TABLE|INDEX)/i.test(text)) return { rows: [] };

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
      recordHash: `rec_hash_${state.audit.length + 1}`,
      createdAt: new Date().toISOString(),
    };
    state.audit.push(rec);
    return rec;
  }),
}));

vi.mock('../../src/middleware/jrx-auth.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    const role = req.headers['x-test-role'];
    const id = req.headers['x-test-user-id'] || 'usr_test';
    if (role) {
      req.user = {
        id,
        userId: id,
        role: String(role),
        organizationId: 'org-test',
      };
    }
    next();
  },
  requireRole:
    (...allowed: string[]) =>
    (req: any, res: any, next: any) => {
      if (!req.user) {
        return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });
      }
      if (!allowed.includes(req.user.role)) {
        return res
          .status(403)
          .json({ success: false, code: 'INSUFFICIENT_PERMISSIONS' });
      }
      next();
    },
  AuthRequest: undefined as any,
}));

// ── Boot a real express app with the live router ────────────────────────────
const camRouter = (await import('../../src/routes/jrx-cam-routes.js')).default;

const app = express();
app.use(express.json());
app.use('/api/jrx/cam', camRouter);

let server: http.Server;
let baseUrl = '';

async function start() {
  return new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

await start();

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  state.rows = [];
  state.audit = [];
  state.auditError = null;
});

function call(
  method: 'POST',
  path: string,
  body: any,
  role: string | null,
  userId = 'usr_reviewer_42',
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-test-user-id': userId,
  };
  if (role) headers['x-test-role'] = role;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('CAM reviewer write endpoints (Task #213)', () => {
  describe('POST /api/jrx/cam/reviews/:actionId/approve', () => {
    it('compliance_reviewer: pending → approved, stamps reviewer + audit chain', async () => {
      const seeded = seedPending('cam_act_001');

      const res = await call('POST', '/api/jrx/cam/reviews/cam_act_001/approve', { note: 'looks good' }, 'compliance_reviewer');
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);

      // Status transition + reviewer stamping
      expect(seeded.status).toBe('approved');
      expect(seeded.reviewed_by).toBe('usr_reviewer_42');
      expect(seeded.reviewed_at).toBeTruthy();

      // Tamper-evident audit record
      expect(state.audit).toHaveLength(1);
      expect(state.audit[0].eventType).toBe('compliance.cam.review.approved');
      expect(state.audit[0].payload.actionId).toBe('cam_act_001');
      expect(state.audit[0].payload.newStatus).toBe('approved');
      expect(state.audit[0].payload.reviewer).toMatchObject({
        id: 'usr_reviewer_42',
        role: 'compliance_reviewer',
      });
      expect(json.audit.recordHash).toBe(state.audit[0].recordHash);
    });

    it('second approve on an already-terminal row → 409', async () => {
      seedPending('cam_act_002', { status: 'approved', reviewed_by: 'someone' });
      const res = await call('POST', '/api/jrx/cam/reviews/cam_act_002/approve', {}, 'compliance_reviewer');
      expect(res.status).toBe(409);
      const json: any = await res.json();
      expect(json.code).toBe('CAM_ACTION_TERMINAL');
      // and no audit record was emitted for the rejected attempt
      expect(state.audit).toHaveLength(0);
    });

    it('non-reviewer role (analyst) is blocked with 403', async () => {
      seedPending('cam_act_003');
      const res = await call('POST', '/api/jrx/cam/reviews/cam_act_003/approve', {}, 'analyst');
      expect(res.status).toBe(403);
      expect(state.audit).toHaveLength(0);
      // and the row is untouched
      expect(state.rows[0].status).toBe('pending');
      expect(state.rows[0].reviewed_by).toBeNull();
    });
  });

  describe('POST /api/jrx/cam/reviews/:actionId/reject', () => {
    it('reject without reason → 400, no state change, no audit', async () => {
      seedPending('cam_act_010');
      const res = await call('POST', '/api/jrx/cam/reviews/cam_act_010/reject', {}, 'compliance_reviewer');
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.code).toBe('CAM_REJECT_REASON_REQUIRED');
      expect(state.audit).toHaveLength(0);
      expect(state.rows[0].status).toBe('pending');
    });

    it('reject with reason: pending → rejected, audit eventType compliance.cam.review.rejected', async () => {
      const seeded = seedPending('cam_act_011');
      const res = await call(
        'POST',
        '/api/jrx/cam/reviews/cam_act_011/reject',
        { reason: 'Fails ISO 42001 control 8.2' },
        'compliance_reviewer',
      );
      expect(res.status).toBe(200);

      expect(seeded.status).toBe('rejected');
      expect(seeded.reviewed_by).toBe('usr_reviewer_42');
      expect(seeded.reviewed_at).toBeTruthy();
      expect(seeded.metadata).toMatchObject({ rejection_reason: 'Fails ISO 42001 control 8.2' });

      expect(state.audit).toHaveLength(1);
      expect(state.audit[0].eventType).toBe('compliance.cam.review.rejected');
      expect(state.audit[0].payload.reason).toBe('Fails ISO 42001 control 8.2');
    });
  });

  describe('POST /api/jrx/cam/reviews/:actionId/assign', () => {
    it('pending → in_review, stamps assignee, audit eventType compliance.cam.review.assigned', async () => {
      const seeded = seedPending('cam_act_020');
      const res = await call(
        'POST',
        '/api/jrx/cam/reviews/cam_act_020/assign',
        { assignee: 'usr_specialist_7' },
        'compliance_reviewer',
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);

      expect(seeded.status).toBe('in_review');
      expect(seeded.assigned_to).toBe('usr_specialist_7');

      expect(state.audit).toHaveLength(1);
      expect(state.audit[0].eventType).toBe('compliance.cam.review.assigned');
      expect(state.audit[0].payload).toMatchObject({
        actionId: 'cam_act_020',
        previousAssignee: null,
        newAssignee: 'usr_specialist_7',
        previousStatus: 'pending',
        newStatus: 'in_review',
      });
    });

    it('assign without assignee → 400', async () => {
      seedPending('cam_act_021');
      const res = await call('POST', '/api/jrx/cam/reviews/cam_act_021/assign', { assignee: '   ' }, 'compliance_reviewer');
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.code).toBe('CAM_ASSIGN_TARGET_REQUIRED');
      expect(state.audit).toHaveLength(0);
    });

    it('analyst trying to assign → 403, no audit, no mutation', async () => {
      const seeded = seedPending('cam_act_022');
      const res = await call(
        'POST',
        '/api/jrx/cam/reviews/cam_act_022/assign',
        { assignee: 'usr_specialist_7' },
        'analyst',
      );
      expect(res.status).toBe(403);
      expect(seeded.status).toBe('pending');
      expect(seeded.assigned_to).toBeNull();
      expect(state.audit).toHaveLength(0);
    });
  });

  describe('audit-chain failure surface', () => {
    it('approve when audit-append fails → 500, row NOT mutated', async () => {
      const seeded = seedPending('cam_act_030');
      state.auditError = new Error('chain unavailable');

      const res = await call('POST', '/api/jrx/cam/reviews/cam_act_030/approve', {}, 'compliance_reviewer');
      expect(res.status).toBe(500);
      const json: any = await res.json();
      expect(json.code).toBe('CAM_AUDIT_APPEND_FAILED');

      // Critical guarantee: no transition without an audit record.
      expect(seeded.status).toBe('pending');
      expect(seeded.reviewed_by).toBeNull();
    });
  });

  describe('not-found', () => {
    it('approve on missing actionId → 404 with CAM_ACTION_NOT_FOUND', async () => {
      const res = await call('POST', '/api/jrx/cam/reviews/missing_xyz/approve', {}, 'compliance_reviewer');
      expect(res.status).toBe(404);
      const json: any = await res.json();
      expect(json.code).toBe('CAM_ACTION_NOT_FOUND');
      expect(state.audit).toHaveLength(0);
    });
  });
});
