import fs from 'node:fs';
import path from 'node:path';

export interface JrxPermissionRow {
  id: string;
  module: string;
  protected: boolean;
  step_up_required: boolean;
  gates?: string[];
}

export interface JrxGateRow {
  id: string;
  class: string;
  permission?: string;
}

export interface JrxAccessEvaluateInput {
  permission: string;
  subjectId: string;
  resourceId?: string;
  matterPolicy?: unknown;
  context?: {
    heldPermissions?: string[];
    stepUpVerified?: boolean;
    requesterId?: string;
    dualApproverIds?: string[];
  };
}

export interface JrxAccessEvaluateResult {
  decision: 'allow' | 'deny';
  code: string;
  message: string;
  gateClass?: string;
  permission?: JrxPermissionRow;
}

type PermissionsDoc = { permissions: JrxPermissionRow[] };
type GatesDoc = { gates: JrxGateRow[] };
type SodDoc = {
  rules: {
    id: string;
    type: string;
    applies_to_gate_classes?: string[];
    min_distinct_approvers?: number;
    permissions_a?: string[];
    permissions_b?: string[];
    same_subject_forbidden?: boolean;
  }[];
};

let permCache: { mtimeMs: number; byId: Map<string, JrxPermissionRow> } | null = null;
let gateCache: { mtimeMs: number; byPermission: Map<string, JrxGateRow> } | null = null;
let sodCache: { mtimeMs: number; doc: SodDoc } | null = null;

function registryFile(name: string): string {
  return path.resolve(process.cwd(), 'jurexio-sdk/jurexio-specs/registry', name);
}

function loadPermissions(): Map<string, JrxPermissionRow> {
  const file = registryFile('permissions.json');
  const stat = fs.statSync(file);
  if (permCache && permCache.mtimeMs === stat.mtimeMs) {
    return permCache.byId;
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as PermissionsDoc;
  const byId = new Map(doc.permissions.map((p) => [p.id, p]));
  permCache = { mtimeMs: stat.mtimeMs, byId };
  return byId;
}

function loadGatesByPermission(): Map<string, JrxGateRow> {
  const file = registryFile('gates.json');
  const stat = fs.statSync(file);
  if (gateCache && gateCache.mtimeMs === stat.mtimeMs) {
    return gateCache.byPermission;
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as GatesDoc;
  const byPermission = new Map<string, JrxGateRow>();
  for (const g of doc.gates) {
    const pid = g.permission;
    if (pid && !byPermission.has(pid)) {
      byPermission.set(pid, g);
    }
  }
  gateCache = { mtimeMs: stat.mtimeMs, byPermission };
  return byPermission;
}

function loadSod(): SodDoc {
  const file = registryFile('separation-of-duties.json');
  const stat = fs.statSync(file);
  if (sodCache && sodCache.mtimeMs === stat.mtimeMs) {
    return sodCache.doc;
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as SodDoc;
  sodCache = { mtimeMs: stat.mtimeMs, doc };
  return doc;
}

function violatesPermissionPairSoD(
  permission: string,
  held: Set<string>,
  rules: SodDoc['rules'],
): string | null {
  for (const rule of rules) {
    if (rule.type !== 'permission_pair_forbidden' || !rule.same_subject_forbidden) {
      continue;
    }
    const a = rule.permissions_a ?? [];
    const b = rule.permissions_b ?? [];
    const touchesA = a.includes(permission);
    const touchesB = b.includes(permission);
    if (!touchesA && !touchesB) {
      continue;
    }
    const hasA = a.some((p) => held.has(p));
    const hasB = b.some((p) => held.has(p));
    if (hasA && hasB) {
      return rule.id;
    }
  }
  return null;
}

export function evaluateJrxAccessDecision(input: JrxAccessEvaluateInput): JrxAccessEvaluateResult {
  const permission = String(input.permission ?? '').trim();
  const subjectId = String(input.subjectId ?? '').trim();
  const resourceId = String(input.resourceId ?? '').trim();
  const ctx = input.context ?? {};
  const heldList = Array.isArray(ctx.heldPermissions) ? ctx.heldPermissions.map(String) : null;

  if (!permission || !subjectId) {
    return {
      decision: 'deny',
      code: 'ACCESS_EVAL_INVALID',
      message: 'permission and subjectId are required',
    };
  }

  const permRow = loadPermissions().get(permission);
  if (!permRow) {
    return {
      decision: 'deny',
      code: 'PERMISSION_UNKNOWN',
      message: 'Permission is not in the adopted catalogue',
    };
  }

  if (resourceId && (input.matterPolicy === undefined || input.matterPolicy === null)) {
    return {
      decision: 'deny',
      code: 'MATTER_POLICY_REQUIRED',
      message:
        'Chairman C-10: deny when no MatterCore policy exists for the resource (until M01 feeds policy).',
      permission: permRow,
    };
  }

  const gate = loadGatesByPermission().get(permission);
  const gateClass = gate?.class;

  if (gateClass === 'GUARDED') {
    const requesterId = String(ctx.requesterId ?? subjectId).trim();
    if (requesterId === subjectId) {
      return {
        decision: 'deny',
        code: 'SOD_SELF_APPROVAL_FORBIDDEN',
        message: 'GUARDED gate: requester cannot approve their own action (SOD-001)',
        gateClass,
        permission: permRow,
      };
    }
  }

  if (gateClass === 'DUAL') {
    const ids = (ctx.dualApproverIds ?? []).map(String).filter(Boolean);
    const distinct = new Set(ids);
    const min = loadSod().rules.find((r) => r.type === 'distinct_approvers')
      ?.min_distinct_approvers ?? 2;
    if (distinct.size < min || !distinct.has(subjectId)) {
      return {
        decision: 'deny',
        code: 'DUAL_APPROVERS_REQUIRED',
        message: `DUAL gate requires ${min} distinct approvers including subjectId`,
        gateClass,
        permission: permRow,
      };
    }
  }

  if (permRow.protected && !ctx.stepUpVerified) {
    return {
      decision: 'deny',
      code: 'STEP_UP_REQUIRED',
      message: 'Protected permission requires step-up verification (G-11-05)',
      gateClass,
      permission: permRow,
    };
  }

  if (!heldList) {
    return {
      decision: 'deny',
      code: 'ROLE_ASSIGNMENTS_NOT_WIRED',
      message:
        'Tenant role assignments are not loaded; pass context.heldPermissions until M11 persistence ships',
      gateClass,
      permission: permRow,
    };
  }

  const held = new Set(heldList);
  if (!held.has(permission)) {
    return {
      decision: 'deny',
      code: 'PERMISSION_NOT_HELD',
      message: 'Subject does not hold the requested permission via role templates',
      gateClass,
      permission: permRow,
    };
  }

  const sodHit = violatesPermissionPairSoD(permission, held, loadSod().rules);
  if (sodHit) {
    return {
      decision: 'deny',
      code: 'SOD_PERMISSION_PAIR',
      message: `Separation-of-duties rule ${sodHit} forbids holding both permissions`,
      gateClass,
      permission: permRow,
    };
  }

  return {
    decision: 'allow',
    code: 'ACCESS_ALLOWED',
    message: 'Permission held; gate class and SoD checks passed',
    gateClass,
    permission: permRow,
  };
}
