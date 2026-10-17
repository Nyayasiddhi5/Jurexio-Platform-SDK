/**
 * Jurexio Enterprise Platform 3.1.2 — Architect Workflow Builder backend
 * task-258 (2026-05-13)
 *
 * Replaces the structured-501 stub at /api/architect/deploy that lived in
 * `jrx-console-page-stubs-routes.ts` with a real persistence + side-effect
 * backend so the Architect Visual Workflow Builder
 * (`client/src/pages/architect-workflow-builder.tsx`) can actually deploy
 * an org graph instead of just downloading a JSON file.
 *
 * Endpoints (mounted at `/api/architect`):
 *   POST /deploy                  — validate + persist the architect graph
 *   GET  /workflows               — list deployed architect workflows
 *   GET  /workflows/:workflowId   — fetch a single deployed workflow
 *
 * Storage: re-uses the existing `sdk_workflows` table (workflow_type =
 * 'architect_org') so we do NOT have to bump the schema. The full architect
 * graph (departments + connections + corporateDNA) is stored in the
 * `definition` jsonb column; the flattened department list is mirrored into
 * `steps` so existing sdk_workflows tooling keeps working.
 *
 * Auth: `authenticateToken` — the page itself is gated by
 * `<ProtectedRoute minRole="manager">`, so callers always have a JWT in
 * scope. Service-account / inter-service callers are also accepted via the
 * canonical bypass already implemented in `jrx-auth.ts`.
 *
 * Guardrails: NV-NAMING-001 (file prefixed `jrx-`), NV-WIRING-001 (mounted
 * from `src/index.ts`), NV-CONTRACT-001 (zod-validated body), NV-OWNERSHIP-001
 * (errors are surfaced explicitly, not swallowed).
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db as rawDb } from '../db/index.js';
import { sdkWorkflows } from '../../shared/schema.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { nvArchitectDeploymentBus } from '../services/jrx-architect-deployment-bus.js';
import { createLogger } from '../utils/logger.js';

// Lazy-bind the drizzle singleton so this module imports cleanly even if
// initializeDatabase() runs after route registration. Property access throws
// `JrxMissingDependencyError` with a clear message if the DB is still null
// at request time. Pattern documented in `utils/jrx-type-helpers.ts`.
const db = lazyRequire(() => rawDb, 'db', 'Architect routes need the NV core DB pool.');

type SdkWorkflowRow = typeof sdkWorkflows.$inferSelect;

const logger = createLogger('./jrx-architect-routes');

// ── Request schema ──────────────────────────────────────────────────────────
// Mirrors the `generateConfig()` payload built by the Architect page. We
// intentionally keep `corporateDNA`, `departments[].position`, and the agent
// id arrays loose (`z.record(z.any())` / `z.array(z.string())`) so the page
// can evolve its node shape without forcing a coordinated backend bump, but
// we do hard-validate the fields the persistence layer reads.
const departmentSchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  name: z.string().min(1).max(255),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  agents: z.array(z.string()).default([]),
  romaLevel: z.number().int().min(1).max(4).optional(),
  isActive: z.boolean().optional(),
  workflows: z.array(z.string()).optional(),
});

const connectionSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().optional(),
});

const deployBodySchema = z.object({
  version: z.string().optional(),
  organization: z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional().default(''),
  }),
  corporateDNA: z.record(z.any()).optional().default({}),
  departments: z.array(departmentSchema).min(1, 'At least one department is required to deploy'),
  connections: z.array(connectionSchema).optional().default([]),
  generatedAt: z.string().optional(),
});

type DeployBody = z.infer<typeof deployBodySchema>;

interface AuthenticatedUser {
  id?: string;
  userId?: string;
  email?: string;
  role?: string;
  organizationId?: number | string | null;
}

function resolveCreatedBy(user: AuthenticatedUser | undefined): string {
  if (!user) return 'anonymous';
  return String(user.userId ?? user.id ?? user.email ?? 'unknown');
}

function resolveOrganizationId(user: AuthenticatedUser | undefined): number | null {
  const raw = user?.organizationId;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

function summarise(body: DeployBody) {
  const departmentCount = body.departments.length;
  const agentCount = body.departments.reduce((acc, d) => acc + (d.agents?.length ?? 0), 0);
  const connectionCount = body.connections?.length ?? 0;
  return { departmentCount, agentCount, connectionCount };
}

// Roles allowed to design / deploy / read architect workflows. Mirrors the
// page-level guard `<ProtectedRoute minRole="manager">`, but enforced
// server-side (the client guard is UX, not a security boundary). The
// `service` role is included so the canonical inter-service-secret bypass in
// jrx-auth.ts (used by NSP / NSI / Jurexio Citizen) keeps working.
const ARCHITECT_ALLOWED_ROLES = [
  'manager',
  'admin',
  'super_admin',
  'service',
];

const ARCHITECT_PRIVILEGED_ROLES = new Set(['super_admin', 'service']);

function isPrivileged(user: AuthenticatedUser | undefined): boolean {
  return !!user?.role && ARCHITECT_PRIVILEGED_ROLES.has(user.role);
}

export function createArchitectRouter(): Router {
  const router = Router();
  router.use(authenticateToken);
  router.use(requireRole(...ARCHITECT_ALLOWED_ROLES));

  // ── POST /api/architect/deploy ─────────────────────────────────────────
  router.post('/deploy', async (req: Request, res: Response): Promise<void> => {
    if (!rawDb) {
      res.status(500).json({ success: false, error: 'Database not available' });
      return;
    }

    const parsed = deployBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid architect workflow payload',
        details: parsed.error.flatten(),
      });
      return;
    }
    const body = parsed.data;
    const summary = summarise(body);
    const user = req.user as AuthenticatedUser | undefined;
    const createdBy = resolveCreatedBy(user);
    const organizationId = resolveOrganizationId(user);
    // Non-privileged (manager/admin) callers must have an org-scoped JWT so
    // every persisted row is tenant-tagged and our RLS / scoped fetch paths
    // can enforce isolation. Privileged callers (super_admin / service) may
    // deploy with a null org — they're the platform operators.
    if (!isPrivileged(user) && organizationId === null) {
      res.status(403).json({
        success: false,
        error: 'Architect deploy requires an organization-scoped session',
      });
      return;
    }
    const workflowId = `arch_${randomUUID()}`;

    // Steps mirror the department list so the existing sdk_workflows tooling
    // (executors, list views) sees a non-empty steps array. The authoritative
    // graph lives in `definition`.
    const steps = body.departments.map((d, index) => ({
      index,
      action: 'department.activate',
      params: {
        departmentId: d.id,
        moduleId: d.moduleId,
        name: d.name,
        agents: d.agents,
        romaLevel: d.romaLevel ?? 3,
        isActive: d.isActive ?? true,
        workflows: d.workflows ?? [],
      },
    }));

    try {
      const [row] = await db
        .insert(sdkWorkflows)
        .values({
          workflowId,
          organizationId,
          name: body.organization.name,
          description: body.organization.description || `Architect-deployed organization (${summary.departmentCount} departments, ${summary.agentCount} agents)`,
          workflowType: 'architect_org',
          definition: {
            schemaVersion: body.version ?? '1.0.0',
            organization: body.organization,
            corporateDNA: body.corporateDNA ?? {},
            departments: body.departments,
            connections: body.connections ?? [],
            generatedAt: body.generatedAt ?? new Date().toISOString(),
          },
          steps,
          triggers: [],
          jurisdiction: 'IN',
          status: 'deployed',
          version: 1,
          createdBy,
          isActive: true,
        })
        .returning({
          id: sdkWorkflows.id,
          workflowId: sdkWorkflows.workflowId,
          createdAt: sdkWorkflows.createdAt,
        });

      logger.info('architect_deploy_ok', {
        workflowId,
        createdBy,
        organizationId,
        ...summary,
      });

      // Side-effect: publish the deployment event so downstream provisioning
      // subscribers (agent materializer, routing-rules writer, IronLedger
      // recorder) can react. The bus ships with a built-in logging
      // subscriber so the side-effect is always observable even before any
      // domain subscriber is wired (see jrx-architect-deployment-bus.ts).
      const deployedWorkflowId: string = (row?.workflowId as string | undefined) ?? workflowId;
      const deploymentRowId: number | null = typeof row?.id === 'number' ? row.id : null;
      nvArchitectDeploymentBus.publish({
        workflowId: deployedWorkflowId,
        deploymentId: deploymentRowId,
        organizationId,
        createdBy,
        name: body.organization.name,
        departmentCount: summary.departmentCount,
        agentCount: summary.agentCount,
        connectionCount: summary.connectionCount,
        ts: Date.now(),
      });

      res.status(201).json({
        success: true,
        data: {
          deploymentId: deploymentRowId,
          workflowId: deployedWorkflowId,
          name: body.organization.name,
          status: 'deployed',
          url: `/architect?deployed=${encodeURIComponent(deployedWorkflowId)}`,
          deployedAt: row?.createdAt ?? new Date().toISOString(),
          ...summary,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('architect_deploy_failed', { error: message, workflowId });
      res.status(500).json({
        success: false,
        error: 'Failed to deploy architect workflow',
        // Only surface the underlying error string in non-production so we
        // don't leak internals (column names, RLS messages, etc) to clients.
        ...(process.env.NODE_ENV !== 'production' ? { message } : {}),
      });
    }
  });

  // ── GET /api/architect/workflows ───────────────────────────────────────
  router.get('/workflows', async (req: Request, res: Response): Promise<void> => {
    if (!rawDb) {
      res.status(500).json({ success: false, error: 'Database not available' });
      return;
    }
    try {
      const user = req.user as AuthenticatedUser | undefined;
      const organizationId = resolveOrganizationId(user);
      const conditions = [eq(sdkWorkflows.workflowType, 'architect_org')];
      if (isPrivileged(user)) {
        // super_admin / service may pass ?orgId=<n> to scope explicitly,
        // otherwise they see all architect_org workflows (intentional —
        // these are the platform-operator + inter-service identities).
        const queryOrgRaw = req.query.orgId;
        if (typeof queryOrgRaw === 'string' && queryOrgRaw.trim() !== '') {
          const n = Number.parseInt(queryOrgRaw, 10);
          if (Number.isFinite(n)) conditions.push(eq(sdkWorkflows.organizationId, n));
        }
      } else {
        // Regular caller must have an organizationId on their JWT, otherwise
        // we refuse to list anything (prevents a "null org" caller from
        // seeing every other org's metadata).
        if (organizationId === null) {
          res.status(403).json({
            success: false,
            error: 'Architect workflow access requires an organization-scoped session',
          });
          return;
        }
        conditions.push(eq(sdkWorkflows.organizationId, organizationId));
      }
      const rows = await db
        .select({
          id: sdkWorkflows.id,
          workflowId: sdkWorkflows.workflowId,
          name: sdkWorkflows.name,
          description: sdkWorkflows.description,
          status: sdkWorkflows.status,
          createdBy: sdkWorkflows.createdBy,
          createdAt: sdkWorkflows.createdAt,
        })
        .from(sdkWorkflows)
        .where(and(...conditions))
        .orderBy(desc(sdkWorkflows.createdAt))
        .limit(100);

      res.json({ success: true, data: { workflows: rows, count: rows.length } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('architect_list_failed', { error: message });
      res.status(500).json({ success: false, error: 'Failed to list architect workflows', message });
    }
  });

  // ── GET /api/architect/workflows/:workflowId ───────────────────────────
  router.get('/workflows/:workflowId', async (req: Request, res: Response): Promise<void> => {
    if (!rawDb) {
      res.status(500).json({ success: false, error: 'Database not available' });
      return;
    }
    try {
      const user = req.user as AuthenticatedUser | undefined;
      const organizationId = resolveOrganizationId(user);
      const [row] = (await db
        .select()
        .from(sdkWorkflows)
        .where(and(
          eq(sdkWorkflows.workflowType, 'architect_org'),
          eq(sdkWorkflows.workflowId, String(req.params.workflowId ?? '')),
        ))
        .limit(1)) as SdkWorkflowRow[];
      if (!row) {
        res.status(404).json({ success: false, error: 'Architect workflow not found' });
        return;
      }
      // Tenant scoping: non-privileged callers can only read workflows that
      // belong to their own org. Returning 404 (rather than 403) avoids
      // leaking the existence of cross-tenant workflowIds to enumeration.
      if (!isPrivileged(user)) {
        if (organizationId === null || row.organizationId !== organizationId) {
          res.status(404).json({ success: false, error: 'Architect workflow not found' });
          return;
        }
      }
      res.json({ success: true, data: row });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('architect_get_failed', { error: message, workflowId: req.params.workflowId });
      res.status(500).json({ success: false, error: 'Failed to fetch architect workflow', message });
    }
  });

  return router;
}
