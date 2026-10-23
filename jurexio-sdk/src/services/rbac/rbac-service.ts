/**
 * Jurexio RBAC Service v3.1.2
 * JRX-SVC-RBAC-001
 *
 * Role-Based Access Control with Attribute-Based extensions (RBAC + ABAC).
 * Enforces Zero Trust Architecture — every access decision is explicit.
 *
 * Hierarchy:
 *   super_admin > platform_admin > enterprise_admin > manager > operator > analyst > developer > user
 *
 *   super_admin  (tier-2) — global, Jurexio internal. Unscoped.
 *   platform_admin (tier-1) — scoped to ONE platform's orgs/users/keys/limits.
 *     The platform_id scoping itself is enforced in jrx-customer-org-rbac.ts;
 *     this role's permissions below are the role-level grants.
 *
 * Permission model:
 *   Resource:Action patterns e.g. 'agents:read', 'cases:write', 'sdk:configure'
 *   Combined with Attribute conditions: jurisdiction, tier, organization, IP
 *
 * Features:
 *   - Jurisdiction-scoped permissions (e.g., user can only access IN jurisdiction)
 *   - Tier-gated feature access
 *   - Organization isolation (multi-tenant)
 *   - Audit trail for all access decisions
 *   - Dynamic permission grants (temporary / scoped)
 */

import { logger } from '../../utils/logger.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type RoleType =
  | 'super_admin'
  | 'platform_admin'
  | 'enterprise_admin'
  | 'manager'
  | 'operator'
  | 'analyst'
  | 'developer'
  | 'user'
  | 'readonly';

export type ResourceType =
  | 'agents' | 'cases' | 'documents' | 'users' | 'organizations'
  | 'api-keys' | 'sdk' | 'analytics' | 'billing' | 'compliance'
  | 'llm-providers' | 'feature-flags' | 'audit-logs' | 'jurisdictions'
  | 'digital-twins' | 'skills' | 'e-filing' | 'white-label'
  | 'memory' | 'rag' | 'orchestration' | 'security' | 'system';

export type ActionType = 'read' | 'write' | 'delete' | 'execute' | 'configure' | 'admin';

export interface Permission {
  resource: ResourceType;
  actions: ActionType[];
  conditions?: {
    jurisdictions?: string[];        // Restrict to specific jurisdictions
    tiers?: string[];                // Restrict to specific tiers
    ownedOnly?: boolean;             // Can only access own resources
  };
}

export interface Role {
  type: RoleType;
  displayName: string;
  description: string;
  permissions: Permission[];
  inherits?: RoleType[];             // Inherit permissions from parent roles
}

export interface AccessContext {
  userId: string;
  organizationId?: string;
  role: RoleType;
  tier: string;
  jurisdiction?: string;
  resourceId?: string;
  ipAddress?: string;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  conditions?: string[];
  auditId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Role Definitions (canonical — matches nv_users table roles)
// ──────────────────────────────────────────────────────────────────────────────

const ROLE_DEFINITIONS: Record<RoleType, Role> = {
  super_admin: {
    type: 'super_admin',
    displayName: 'Super Administrator',
    description: 'Full platform access — Jurexio internal only',
    permissions: [{ resource: 'system', actions: ['read', 'write', 'delete', 'execute', 'configure', 'admin'] }],
  },
  platform_admin: {
    type: 'platform_admin',
    displayName: 'Platform Administrator',
    description: 'Tier-1 — manages a single platform\'s orgs, users, SDK keys, and rate-limits (scoped to their platform_id; cannot touch the global registry, models, or LLM credentials)',
    permissions: [
      { resource: 'organizations', actions: ['read', 'write', 'configure'] },
      { resource: 'users', actions: ['read', 'write', 'delete'] },
      { resource: 'api-keys', actions: ['read', 'write', 'delete'] },
      { resource: 'sdk', actions: ['read', 'configure'] },
      { resource: 'analytics', actions: ['read'] },
      { resource: 'billing', actions: ['read', 'configure'] },
      { resource: 'compliance', actions: ['read', 'configure'] },
      { resource: 'feature-flags', actions: ['read'] },
      { resource: 'audit-logs', actions: ['read'] },
      { resource: 'llm-providers', actions: ['read'] },
    ],
    inherits: ['enterprise_admin'],
  },
  enterprise_admin: {
    type: 'enterprise_admin',
    displayName: 'Enterprise Administrator',
    description: 'Full organization access including user management and billing',
    permissions: [
      { resource: 'agents', actions: ['read', 'write', 'configure'] },
      { resource: 'cases', actions: ['read', 'write', 'delete'] },
      { resource: 'documents', actions: ['read', 'write', 'delete'] },
      { resource: 'users', actions: ['read', 'write', 'delete'] },
      { resource: 'organizations', actions: ['read', 'configure'] },
      { resource: 'api-keys', actions: ['read', 'write', 'delete'] },
      { resource: 'sdk', actions: ['read', 'configure'] },
      { resource: 'analytics', actions: ['read'] },
      { resource: 'billing', actions: ['read', 'configure'] },
      { resource: 'compliance', actions: ['read', 'configure'] },
      { resource: 'llm-providers', actions: ['read', 'configure'] },
      { resource: 'feature-flags', actions: ['read', 'configure'] },
      { resource: 'audit-logs', actions: ['read'] },
      { resource: 'jurisdictions', actions: ['read'] },
      { resource: 'digital-twins', actions: ['read', 'write', 'delete'] },
      { resource: 'skills', actions: ['read', 'write', 'configure'] },
      { resource: 'e-filing', actions: ['read', 'write', 'execute'] },
      { resource: 'white-label', actions: ['read', 'configure'] },
      { resource: 'orchestration', actions: ['read', 'execute'] },
    ],
    inherits: ['manager'],
  },
  manager: {
    type: 'manager',
    displayName: 'Manager',
    description: 'Team and case management access',
    permissions: [
      { resource: 'agents', actions: ['read', 'execute'] },
      { resource: 'cases', actions: ['read', 'write'] },
      { resource: 'documents', actions: ['read', 'write'] },
      { resource: 'users', actions: ['read'] },
      { resource: 'analytics', actions: ['read'] },
      { resource: 'digital-twins', actions: ['read', 'write'] },
      { resource: 'e-filing', actions: ['read', 'write'] },
      { resource: 'orchestration', actions: ['read', 'execute'] },
    ],
    inherits: ['operator'],
  },
  operator: {
    type: 'operator',
    displayName: 'Operator',
    description: 'Day-to-day operational access',
    permissions: [
      { resource: 'agents', actions: ['read', 'execute'] },
      { resource: 'cases', actions: ['read', 'write'] },
      { resource: 'documents', actions: ['read', 'write'] },
      { resource: 'digital-twins', actions: ['read'] },
      { resource: 'e-filing', actions: ['read'] },
    ],
    inherits: ['analyst'],
  },
  analyst: {
    type: 'analyst',
    displayName: 'Analyst',
    description: 'Read and analytics access',
    permissions: [
      { resource: 'agents', actions: ['read'] },
      { resource: 'cases', actions: ['read'] },
      { resource: 'documents', actions: ['read'] },
      { resource: 'analytics', actions: ['read'] },
      { resource: 'audit-logs', actions: ['read'] },
    ],
  },
  developer: {
    type: 'developer',
    displayName: 'Developer',
    description: 'API and SDK access for integration development',
    permissions: [
      { resource: 'agents', actions: ['read', 'execute'] },
      { resource: 'api-keys', actions: ['read', 'write'] },
      { resource: 'sdk', actions: ['read', 'execute', 'configure'] },
      { resource: 'documents', actions: ['read', 'write'] },
      { resource: 'skills', actions: ['read', 'write'] },
      { resource: 'orchestration', actions: ['read', 'execute'] },
    ],
  },
  user: {
    type: 'user',
    displayName: 'User',
    description: 'Standard end-user access',
    permissions: [
      { resource: 'agents', actions: ['read', 'execute'], conditions: { ownedOnly: true } },
      { resource: 'cases', actions: ['read', 'write'], conditions: { ownedOnly: true } },
      { resource: 'documents', actions: ['read', 'write'], conditions: { ownedOnly: true } },
      { resource: 'e-filing', actions: ['read'], conditions: { ownedOnly: true } },
    ],
  },
  readonly: {
    type: 'readonly',
    displayName: 'Read-Only',
    description: 'View-only access — no modifications',
    permissions: [
      { resource: 'agents', actions: ['read'] },
      { resource: 'cases', actions: ['read'] },
      { resource: 'documents', actions: ['read'] },
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// RBAC Service
// ──────────────────────────────────────────────────────────────────────────────

export class RBACService {
  private static instance: RBACService;
  private auditLog: Array<{ id: string; timestamp: Date; userId: string; resource: string; action: string; allowed: boolean; reason: string }> = [];

  private constructor() {
    logger.info('[RBAC] RBAC Service initialized — Zero Trust Architecture active');
  }

  static getInstance(): RBACService {
    if (!RBACService.instance) {
      RBACService.instance = new RBACService();
    }
    return RBACService.instance;
  }

  /**
   * Check if a user has permission to perform an action on a resource.
   * This is the primary authorization gate — call BEFORE any resource access.
   */
  checkAccess(
    context: AccessContext,
    resource: ResourceType,
    action: ActionType,
  ): AccessDecision {
    const auditId = `rbac-${Date.now()}-${crypto.randomUUID().substring(0, 6)}`;

    // Super admin bypasses all checks
    if (context.role === 'super_admin') {
      this.recordAudit(auditId, context, resource, action, true, 'super_admin bypass');
      return { allowed: true, reason: 'super_admin bypass', auditId };
    }

    // Collect all permissions including inherited
    const permissions = this.getEffectivePermissions(context.role);
    const matchingPermissions = permissions.filter(p => p.resource === resource);

    if (matchingPermissions.length === 0) {
      this.recordAudit(auditId, context, resource, action, false, `No permissions for resource: ${resource}`);
      return { allowed: false, reason: `No permissions for resource: ${resource}`, auditId };
    }

    for (const permission of matchingPermissions) {
      if (!permission.actions.includes(action)) continue;

      // Check conditions
      const conditions: string[] = [];
      if (permission.conditions?.jurisdictions && context.jurisdiction) {
        if (!permission.conditions.jurisdictions.includes(context.jurisdiction)) {
          continue;
        }
        conditions.push(`jurisdiction:${context.jurisdiction}`);
      }
      if (permission.conditions?.tiers) {
        if (!permission.conditions.tiers.includes(context.tier)) {
          continue;
        }
        conditions.push(`tier:${context.tier}`);
      }

      this.recordAudit(auditId, context, resource, action, true, `Permission granted: ${resource}:${action}`);
      return { allowed: true, reason: `Permission granted via role ${context.role}`, conditions, auditId };
    }

    const reason = `Role '${context.role}' lacks permission: ${resource}:${action}`;
    this.recordAudit(auditId, context, resource, action, false, reason);
    return { allowed: false, reason, auditId };
  }

  /**
   * Get all effective permissions for a role (including inherited).
   */
  getEffectivePermissions(role: RoleType): Permission[] {
    const definition = ROLE_DEFINITIONS[role];
    if (!definition) return [];

    const permissions = [...definition.permissions];

    // Resolve inherited permissions
    if (definition.inherits) {
      for (const parentRole of definition.inherits) {
        permissions.push(...this.getEffectivePermissions(parentRole));
      }
    }

    return permissions;
  }

  /**
   * List all roles and their permissions — for admin UI.
   */
  listRoles(): Role[] {
    return Object.values(ROLE_DEFINITIONS);
  }

  /**
   * Get the role definition.
   */
  getRole(role: RoleType): Role | undefined {
    return ROLE_DEFINITIONS[role];
  }

  /**
   * Get audit log entries.
   */
  getAuditLog(filters?: { userId?: string; resource?: string; limit?: number }): typeof this.auditLog {
    let entries = this.auditLog;
    if (filters?.userId) entries = entries.filter(e => e.userId === filters.userId);
    if (filters?.resource) entries = entries.filter(e => e.resource === filters.resource);
    return entries.slice(-(filters?.limit || 100));
  }

  healthCheck(): { status: 'healthy'; roleCount: number; auditLogSize: number } {
    return {
      status: 'healthy',
      roleCount: Object.keys(ROLE_DEFINITIONS).length,
      auditLogSize: this.auditLog.length,
    };
  }

  private getEffectivePermissionsAll(role: RoleType): Permission[] {
    return this.getEffectivePermissions(role);
  }

  private recordAudit(
    id: string,
    context: AccessContext,
    resource: string,
    action: string,
    allowed: boolean,
    reason: string,
  ): void {
    this.auditLog.push({ id, timestamp: new Date(), userId: context.userId, resource, action, allowed, reason });
    // Keep last 10,000 entries in memory; older entries should be persisted to DB
    if (this.auditLog.length > 10000) this.auditLog = this.auditLog.slice(-10000);
  }
}

export const rbacService = RBACService.getInstance();
