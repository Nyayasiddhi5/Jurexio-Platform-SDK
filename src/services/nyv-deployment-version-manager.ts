/**
 * NYV Deployment Version Manager v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-grade versioning for module-by-module deployment.
 *
 * VERSIONING STRATEGY:
 *   Platform: 3.1.2 (follows SemVer — MAJOR.MINOR.PATCH)
 *   Modules: Each module has its own independent version
 *   Database: Migration version tracked separately
 *
 * MODULE DEPLOYMENT PHILOSOPHY:
 *   - Each module (Agents, Documents, RAG, Auth, SDK, etc.) is independently deployable
 *   - Feature flags gate new code paths until confident
 *   - Blue/Green rollout per module in K8s
 *   - Rollback per module in < 30 seconds (revert ConfigMap + rollout undo)
 *
 * CHANGELOG FORMAT (auto-generated from git commits):
 *   feat: — new feature (bumps MINOR)
 *   fix:  — bug fix (bumps PATCH)
 *   breaking: — breaking change (bumps MAJOR)
 *   perf: — performance improvement
 *   sec:  — security patch
 *
 * @module nyv-deployment-version-manager
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('nyv-version-manager');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ModuleId =
  | 'nyv-gateway'         // Express API gateway
  | 'nyv-console'         // Admin console
  | 'nyv-agents'          // ROMA L5 agent runtime
  | 'nyv-documents'       // Document intelligence + storage
  | 'nyv-rag'             // RAG pipeline + GraphRAG
  | 'nyv-auth'            // Authentication + JWT
  | 'nyv-sdk'             // SDK gateway + tracking
  | 'nyv-llm-router'      // LRM router + LLM priority manager
  | 'nyv-model-registry'  // Dynamic model registry
  | 'nyv-feature-flags'   // Feature flag manager
  | 'nyv-tenant-manager'  // SaaS tenant management
  | 'nyv-mcp-tools'       // MCP tool execution
  | 'nyv-voice'           // Voice intelligence
  | 'nyv-compliance'      // Compliance + guardrails
  | 'nyv-queue'           // Job queue
  | 'nyv-notifications'   // WebSocket + notifications
  | 'nyv-payments'        // Razorpay / UPI
  | 'nyv-analytics'       // Cost analytics
  | 'nyv-migrations'      // Database migrations
  | string;               // Allow custom module names

export type ReleaseStatus = 'development' | 'rc' | 'stable' | 'lts' | 'deprecated' | 'eol';
export type DeploymentEnv = 'development' | 'staging' | 'production';
export type RolloutStrategy = 'rolling' | 'blue-green' | 'canary' | 'immediate';

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;  // 'rc.1', 'beta.2'
  build?: string;       // build metadata
}

export interface ModuleVersion {
  moduleId: ModuleId;
  version: SemVer;
  versionString: string;
  status: ReleaseStatus;

  // Deployment state
  deployedAt?: string;
  deployedBy?: string;
  deployedEnv?: DeploymentEnv;
  rolloutStrategy?: RolloutStrategy;
  rolloutPercentage?: number;   // For canary: 0-100

  // Git info
  gitCommit?: string;
  gitBranch?: string;
  gitTag?: string;

  // Dependencies
  requiresMigration?: boolean;
  migrationVersion?: string;
  requiredModuleVersions?: Record<ModuleId, string>;  // min version of deps

  // Feature flags gating this version
  gatedByFlags?: string[];

  // Changelog
  changelog: ChangelogEntry[];

  // Rollback
  previousVersion?: string;
  canRollback: boolean;
}

export interface ChangelogEntry {
  type: 'feat' | 'fix' | 'breaking' | 'perf' | 'sec' | 'docs' | 'refactor' | 'test' | 'chore';
  description: string;
  pr?: string;
  author?: string;
  timestamp: string;
}

export interface PlatformVersion {
  platform: string;              // 'nyayavigya-platform'
  version: SemVer;
  versionString: string;
  releaseDate: string;
  modules: Record<ModuleId, ModuleVersion>;
  status: ReleaseStatus;
  releaseNotes?: string;
}

export interface DeploymentRecord {
  id: string;
  env: DeploymentEnv;
  moduleId: ModuleId;
  fromVersion: string;
  toVersion: string;
  strategy: RolloutStrategy;
  status: 'pending' | 'in-progress' | 'success' | 'failed' | 'rolled-back';
  startedAt: string;
  completedAt?: string;
  deployedBy: string;
  rollbackTriggeredAt?: string;
  rollbackReason?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CURRENT PLATFORM VERSIONS
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_PLATFORM_VERSION: Omit<PlatformVersion, 'modules'> = {
  platform: 'nyayavigya-platform',
  version: { major: 3, minor: 1, patch: 2 },
  versionString: '3.1.2',
  releaseDate: '2026-04-04',
  status: 'stable',
  releaseNotes: 'Enterprise Hardening (T-H1—T-H7): Document Intelligence, GraphRAG, SDK Security, 10M Scale Config, AgentZero Streaming, Route Standardization, StoragePathBuilder fix',
};

const INITIAL_MODULE_VERSIONS: Array<Omit<ModuleVersion, 'changelog'> & { changelog: ChangelogEntry[] }> = [
  {
    moduleId: 'nyv-gateway', version: { major: 3, minor: 1, patch: 2 }, versionString: '3.1.2',
    status: 'stable', deployedEnv: 'development', canRollback: true,
    changelog: [
      { type: 'feat', description: 'Route prefix standardised to /api/jrx/ (T-H6)', timestamp: '2026-04-04' },
      { type: 'fix', description: 'StoragePathBuilder duplicate export removed (T-H7)', timestamp: '2026-04-04' },
    ],
  },
  {
    moduleId: 'nyv-agents', version: { major: 2, minor: 0, patch: 0 }, versionString: '2.0.0',
    status: 'stable', deployedEnv: 'development', canRollback: true,
    changelog: [
      { type: 'feat', description: '148 ROMA L5 agents across 6 jurisdictions in v2 registry', timestamp: '2026-04-01' },
    ],
  },
  {
    moduleId: 'nyv-documents', version: { major: 1, minor: 0, patch: 0 }, versionString: '1.0.0',
    status: 'stable', deployedEnv: 'development', canRollback: false,
    requiresMigration: true, migrationVersion: '0020',
    gatedByFlags: ['nv_document_pipeline'],
    changelog: [
      { type: 'feat', description: 'Document Intelligence Orchestrator (T-H1): upload→store→parse→embed→RAG', timestamp: '2026-04-04' },
      { type: 'feat', description: 'Per-user document namespaces (user:{orgId}:{userId}:docs)', timestamp: '2026-04-04' },
    ],
  },
  {
    moduleId: 'nyv-rag', version: { major: 1, minor: 0, patch: 0 }, versionString: '1.0.0',
    status: 'stable', deployedEnv: 'development', canRollback: false,
    gatedByFlags: ['nv_graphrag_enabled', 'nv_rag_search'],
    changelog: [
      { type: 'feat', description: 'Legal Knowledge GraphRAG (T-H2): entity/edge graph with multi-hop BFS', timestamp: '2026-04-04' },
      { type: 'feat', description: '7-step enhanced RAG pipeline with pre-LLM confidence threshold', timestamp: '2026-04-04' },
    ],
  },
  {
    moduleId: 'nyv-auth', version: { major: 3, minor: 1, patch: 2 }, versionString: '3.1.2',
    status: 'stable', deployedEnv: 'development', canRollback: true,
    changelog: [
      { type: 'feat', description: 'JWT rotation monitor + 30-min auto-refresh', timestamp: '2026-03-01' },
    ],
  },
  {
    moduleId: 'nyv-sdk', version: { major: 5, minor: 0, patch: 0 }, versionString: '5.0.0',
    status: 'stable', deployedEnv: 'development', canRollback: true,
    changelog: [
      { type: 'feat', description: 'SDK v5: HMAC-SHA256 keys, per-tier rate limits (T-H3)', timestamp: '2026-04-04' },
      { type: 'feat', description: 'Concurrent request tracking, 30s key cache', timestamp: '2026-04-04' },
    ],
  },
  {
    moduleId: 'nyv-llm-router', version: { major: 3, minor: 1, patch: 2 }, versionString: '3.1.2',
    status: 'stable', deployedEnv: 'development', canRollback: true,
    changelog: [
      { type: 'feat', description: 'AgentZero 5-level fallback chain with circuit breaker (T-H5)', timestamp: '2026-04-04' },
    ],
  },
  {
    moduleId: 'nyv-model-registry', version: { major: 1, minor: 0, patch: 0 }, versionString: '1.0.0',
    status: 'stable', deployedEnv: 'development', canRollback: false,
    changelog: [
      { type: 'feat', description: 'Dynamic model registry: zero-core-change LLM/SLM/LRM integration', timestamp: '2026-04-04' },
      { type: 'feat', description: 'Config-file, env-var, DB, and API registration channels', timestamp: '2026-04-04' },
    ],
  },
  {
    moduleId: 'nyv-feature-flags', version: { major: 1, minor: 0, patch: 0 }, versionString: '1.0.0',
    status: 'stable', deployedEnv: 'development', canRollback: false,
    changelog: [
      { type: 'feat', description: 'Per-tenant feature flags with kill switches, percentage rollout, A/B testing', timestamp: '2026-04-04' },
    ],
  },
  {
    moduleId: 'nyv-tenant-manager', version: { major: 1, minor: 0, patch: 0 }, versionString: '1.0.0',
    status: 'stable', deployedEnv: 'development', canRollback: false,
    changelog: [
      { type: 'feat', description: 'SaaS tenant manager: 7 tier models, data isolation, budget enforcement', timestamp: '2026-04-04' },
      { type: 'feat', description: 'Jurisdiction-isolated deployment patterns', timestamp: '2026-04-04' },
    ],
  },
  {
    moduleId: 'nyv-mcp-tools', version: { major: 1, minor: 0, patch: 0 }, versionString: '1.0.0',
    status: 'stable', deployedEnv: 'development', canRollback: true,
    changelog: [
      { type: 'feat', description: '53 MCP tools across legal, compliance, court, and document categories', timestamp: '2026-03-01' },
    ],
  },
  {
    moduleId: 'nyv-compliance', version: { major: 3, minor: 1, patch: 2 }, versionString: '3.1.2',
    status: 'stable', deployedEnv: 'development', canRollback: true,
    changelog: [
      { type: 'feat', description: 'ROMA L5 policy engine with jurisdiction compliance validation', timestamp: '2026-03-01' },
    ],
  },
  {
    moduleId: 'nyv-migrations', version: { major: 0, minor: 65, patch: 0 }, versionString: '0.65.0',
    status: 'stable', deployedEnv: 'development', canRollback: false,
    changelog: [
      { type: 'feat', description: '65 DB migrations: 65+ tables across nv_*, nys_*, nm_* schemas', timestamp: '2026-04-04' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// VERSION MANAGER
// ─────────────────────────────────────────────────────────────────────────────

export class NyvDeploymentVersionManager extends EventEmitter {
  private static instance: NyvDeploymentVersionManager;
  private modules = new Map<ModuleId, ModuleVersion>();
  private deploymentHistory: DeploymentRecord[] = [];
  private deploymentIdCounter = 0;

  private constructor() {
    super();
    for (const m of INITIAL_MODULE_VERSIONS) {
      this.modules.set(m.moduleId, m as ModuleVersion);
    }
    logger.info(`[VersionManager] Loaded ${this.modules.size} module versions`);
  }

  static getInstance(): NyvDeploymentVersionManager {
    if (!NyvDeploymentVersionManager.instance) {
      NyvDeploymentVersionManager.instance = new NyvDeploymentVersionManager();
    }
    return NyvDeploymentVersionManager.instance;
  }

  // ── Platform ───────────────────────────────────────────────────────────────

  getPlatformVersion(): PlatformVersion {
    const modules: Record<string, ModuleVersion> = {};
    for (const [id, v] of this.modules) modules[id] = v;
    return { ...CURRENT_PLATFORM_VERSION, modules } as PlatformVersion;
  }

  // ── Module Versioning ──────────────────────────────────────────────────────

  getModule(moduleId: ModuleId): ModuleVersion | undefined {
    return this.modules.get(moduleId);
  }

  getAllModules(): ModuleVersion[] {
    return Array.from(this.modules.values());
  }

  registerModule(version: ModuleVersion): void {
    this.modules.set(version.moduleId, version);
    logger.info(`[VersionManager] Registered: ${version.moduleId}@${version.versionString}`);
  }

  addChangelog(moduleId: ModuleId, entry: Omit<ChangelogEntry, 'timestamp'>): void {
    const mod = this.modules.get(moduleId);
    if (!mod) throw new Error(`Module not found: ${moduleId}`);
    mod.changelog.push({ ...entry, timestamp: new Date().toISOString() });
  }

  bump(moduleId: ModuleId, type: 'major' | 'minor' | 'patch', description: string): ModuleVersion {
    const mod = this.modules.get(moduleId);
    if (!mod) throw new Error(`Module not found: ${moduleId}`);
    const prev = { ...mod.version };
    if (type === 'major') { mod.version.major++; mod.version.minor = 0; mod.version.patch = 0; }
    if (type === 'minor') { mod.version.minor++; mod.version.patch = 0; }
    if (type === 'patch') { mod.version.patch++; }
    mod.versionString = `${mod.version.major}.${mod.version.minor}.${mod.version.patch}`;
    mod.previousVersion = `${prev.major}.${prev.minor}.${prev.patch}`;
    mod.canRollback = true;
    mod.changelog.push({ type: type === 'major' ? 'breaking' : 'feat', description, timestamp: new Date().toISOString() });
    this.emit('module:bumped', { moduleId, from: mod.previousVersion, to: mod.versionString });
    logger.info(`[VersionManager] Bumped ${moduleId}: ${mod.previousVersion} → ${mod.versionString}`);
    return mod;
  }

  // ── Deployment Tracking ────────────────────────────────────────────────────

  recordDeployment(input: Omit<DeploymentRecord, 'id' | 'startedAt' | 'status'>): DeploymentRecord {
    const record: DeploymentRecord = {
      id: `DEP-${String(++this.deploymentIdCounter).padStart(6, '0')}`,
      ...input,
      status: 'in-progress',
      startedAt: new Date().toISOString(),
    };
    this.deploymentHistory.push(record);
    this.emit('deployment:started', record);
    logger.info(`[VersionManager] Deployment started: ${record.id} — ${record.moduleId}@${record.toVersion}`);
    return record;
  }

  completeDeployment(deploymentId: string, success: boolean, error?: string): void {
    const record = this.deploymentHistory.find(r => r.id === deploymentId);
    if (!record) throw new Error(`Deployment not found: ${deploymentId}`);
    record.status = success ? 'success' : 'failed';
    record.completedAt = new Date().toISOString();
    if (!success && error) (record.metadata = record.metadata ?? {}).error = error;
    this.emit(`deployment:${success ? 'success' : 'failed'}`, record);
    logger.info(`[VersionManager] Deployment ${record.id}: ${record.status}`);
  }

  rollback(moduleId: ModuleId, reason: string, initiatedBy: string): void {
    const mod = this.modules.get(moduleId);
    if (!mod?.canRollback || !mod.previousVersion) {
      throw new Error(`Module ${moduleId} cannot be rolled back`);
    }
    const fromVersion = mod.versionString;
    const toVersion = mod.previousVersion;

    const [major, minor, patch] = toVersion.split('.').map(Number);
    mod.version = { major, minor, patch };
    mod.versionString = toVersion;
    mod.previousVersion = undefined;
    mod.canRollback = false;
    mod.changelog.push({
      type: 'fix', description: `Rolled back: ${fromVersion} → ${toVersion} — ${reason}`,
      author: initiatedBy, timestamp: new Date().toISOString(),
    });

    this.emit('module:rolled-back', { moduleId, fromVersion, toVersion, reason });
    logger.warn(`[VersionManager] Rollback: ${moduleId} ${fromVersion} → ${toVersion} (${reason})`);
  }

  // ── History ────────────────────────────────────────────────────────────────

  getDeploymentHistory(moduleId?: ModuleId): DeploymentRecord[] {
    if (moduleId) return this.deploymentHistory.filter(r => r.moduleId === moduleId);
    return [...this.deploymentHistory];
  }

  // ── Changelog Generation ───────────────────────────────────────────────────

  generateChangelog(moduleId?: ModuleId): string {
    const modules = moduleId
      ? [this.modules.get(moduleId)].filter(Boolean) as ModuleVersion[]
      : Array.from(this.modules.values());

    const lines: string[] = [
      `# Jurexio Enterprise Platform ${CURRENT_PLATFORM_VERSION.versionString} Changelog`,
      `*Released: ${CURRENT_PLATFORM_VERSION.releaseDate}*`,
      '',
    ];

    for (const mod of modules) {
      lines.push(`## ${mod.moduleId}@${mod.versionString}`);
      for (const entry of mod.changelog) {
        const icon = { feat: '✨', fix: '🐛', breaking: '💥', perf: '⚡', sec: '🔒', docs: '📝', refactor: '♻️', test: '🧪', chore: '🔧' }[entry.type] ?? '•';
        const pr = entry.pr ? ` ([#${entry.pr}](https://github.com/nyayavigya/platform/pull/${entry.pr}))` : '';
        lines.push(`- ${icon} **${entry.type}**: ${entry.description}${pr}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Compatibility Check ────────────────────────────────────────────────────

  checkCompatibility(moduleId: ModuleId, version: ModuleVersion): { compatible: boolean; issues: string[] } {
    const issues: string[] = [];
    if (version.requiredModuleVersions) {
      for (const [depId, minVersion] of Object.entries(version.requiredModuleVersions)) {
        const dep = this.modules.get(depId as ModuleId);
        if (!dep) { issues.push(`Missing required module: ${depId}`); continue; }
        if (this.compareSemVer(dep.version, this.parseSemVer(minVersion)) < 0) {
          issues.push(`${depId}@${dep.versionString} < required ${minVersion}`);
        }
      }
    }
    return { compatible: issues.length === 0, issues };
  }

  private parseSemVer(versionString: string): SemVer {
    const [major, minor, patch] = versionString.split('.').map(Number);
    return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 };
  }

  private compareSemVer(a: SemVer, b: SemVer): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
  }
}

export const versionManager = NyvDeploymentVersionManager.getInstance();
