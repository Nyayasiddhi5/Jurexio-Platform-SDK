export type RoleLevel = 
  | 'super_admin'
  | 'admin'
  | 'platform_admin'
  | 'org_admin' 
  | 'manager'
  | 'senior_analyst'
  | 'sme'
  | 'analyst'
  | 'operator'
  | 'developer'
  | 'viewer'
  | 'guest'
  | 'user';

// Task #156 — `sme` (Subject Matter Expert) is intentionally hard-isolated
// from the main /console RBAC by being assigned rank `0` (below every
// console minRole). The /sme stand-alone shell drives all SME rating
// activity and App.tsx redirects role==='sme' off any /console/* path.
// Earlier drafts placed `sme` between senior_analyst and analyst; that was
// changed in round-2 review to enforce single-purpose SME tooling.
// runs with the 5-criteria GRPO rubric.
export const ROLE_HIERARCHY: Record<RoleLevel, number> = {
  super_admin: 100,
  admin: 95,
  // platform_admin (tier-1) — scoped to ONE platform's orgs/users/keys/limits.
  // Below super_admin/admin (global, tier-2), above org_admin (single org).
  platform_admin: 92,
  org_admin: 90,
  manager: 80,
  senior_analyst: 70,
  sme: 0,
  analyst: 60,
  operator: 50,
  developer: 40,
  viewer: 30,
  user: 20,
  guest: 10,
};

export type FeatureCategory =
  | 'legal_platform'
  | 'sdk_tools'
  | 'auth_security'
  | 'agent_ai'
  | 'orchestration'
  | 'admin'
  | 'testing'
  | 'content'
  | 'enterprise';

export interface FeatureEntry {
  id: string;
  label: string;
  description: string;
  route: string;
  category: FeatureCategory;
  icon: string;
  minRole: RoleLevel;
  requiresOrg?: boolean;
  requiresApp?: boolean;
}

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  legal_platform: 'Legal Platform',
  sdk_tools: 'SDK & Developer Tools',
  auth_security: 'Auth & Security',
  agent_ai: 'Agent & AI',
  orchestration: 'Orchestration Suite',
  admin: 'Administration',
  testing: 'Testing & QA',
  content: 'Content Studio',
  enterprise: 'Enterprise',
};

export const CATEGORY_ICONS: Record<FeatureCategory, string> = {
  legal_platform: 'Scale',
  sdk_tools: 'Code',
  auth_security: 'Shield',
  agent_ai: 'Bot',
  orchestration: 'Workflow',
  admin: 'Settings',
  testing: 'FlaskConical',
  content: 'FileText',
  enterprise: 'Building2',
};

export const FEATURE_REGISTRY: FeatureEntry[] = [
  { id: 'jurexio', label: 'Jurexio Dashboard', description: 'Central SDK administration dashboard', route: '/dashboard', category: 'legal_platform', icon: 'Monitor', minRole: 'user' },
  // Jurexio Citizen Chat removed from central console (lives in NYM downstream client) — v5.0.1
  { id: 'nyayasiddhi-professional', label: 'Jurexio Professional™', description: 'Practice management OS for lawyers', route: '/nyayasiddhi-professional', category: 'legal_platform', icon: 'Briefcase', minRole: 'user' },
  { id: 'nyayasiddhi-ministry', label: 'Jurexio Ministry™', description: 'Sovereign regulatory & government legal infrastructure', route: '/governance', category: 'legal_platform', icon: 'Landmark', minRole: 'analyst' },
  { id: 'nyayasiddhi-academy', label: 'Jurexio Academy™', description: 'Legal intelligence training platform', route: '/academy', category: 'legal_platform', icon: 'GraduationCap', minRole: 'user' },

  // 2026-05-09 consolidation: route fields point to canonical /sdk-hub tabs.
  // RBAC is enforced both here (registry) AND inside SDKHub per-tab (hasAccess).
  { id: 'sdk-hub', label: 'SDK Hub', description: 'Consolidated SDK overview, downloads, key management, playgrounds, testing & onboarding', route: '/sdk-hub?tab=overview', category: 'sdk_tools', icon: 'Code2', minRole: 'user' },
  { id: 'sdk-console', label: 'SDK Developer Console', description: 'Manage apps, API keys, and agents', route: '/sdk-hub?tab=developer', category: 'sdk_tools', icon: 'Terminal', minRole: 'developer' },
  { id: 'sdk-playground', label: 'SDK API Playground', description: 'Interactive API testing tool', route: '/sdk-hub?tab=playground', category: 'sdk_tools', icon: 'Play', minRole: 'developer' },
  { id: 'sdk-tester', label: 'SDK API Tester', description: 'Postman-style API testing', route: '/sdk-hub?tab=tester', category: 'sdk_tools', icon: 'Beaker', minRole: 'developer' },
  { id: 'sdk-testing', label: 'SDK Testing Console', description: 'Automated SDK regression suite', route: '/sdk-hub?tab=testing', category: 'sdk_tools', icon: 'MonitorCheck', minRole: 'developer' },
  { id: 'sdk-client', label: 'Client SDK Playground', description: 'Browser/RN SDK live preview', route: '/sdk-hub?tab=client', category: 'sdk_tools', icon: 'Beaker', minRole: 'developer' },
  { id: 'sdk-onboarding', label: 'SDK Platform Onboarding', description: 'Wizard to provision a new platform/app', route: '/sdk-hub?tab=onboarding', category: 'sdk_tools', icon: 'Zap', minRole: 'developer' },
  { id: 'sdk-keys', label: 'SDK Key Management', description: 'Generate, rotate, revoke API keys', route: '/sdk-hub?tab=keys', category: 'sdk_tools', icon: 'Key', minRole: 'org_admin' },
  { id: 'sdk-downloads', label: 'SDK Downloads', description: 'SDK packages and documentation', route: '/sdk-hub?tab=downloads', category: 'sdk_tools', icon: 'Download', minRole: 'developer' },

  { id: 'enforcement', label: 'Enforcement Monitoring', description: 'Guardrails & compliance monitoring', route: '/enforcement', category: 'auth_security', icon: 'ShieldCheck', minRole: 'analyst' },
  { id: 'agent-flows', label: 'Agent Flows Dashboard', description: 'Topology · Security pipeline · Compliance · Context engineering', route: '/agent-flows', category: 'orchestration', icon: 'GitMerge', minRole: 'analyst' },

  { id: 'agent-testing', label: 'Agent Testing', description: 'Test and validate legal agents', route: '/agent-testing', category: 'agent_ai', icon: 'FlaskConical', minRole: 'developer' },
  { id: 'agent-orchestration', label: 'Agent Orchestration', description: 'Manage agent workflows', route: '/orchestration', category: 'agent_ai', icon: 'Network', minRole: 'operator' },
  { id: 'agent-registry', label: 'Agent Registry', description: 'Browse ROMA L5 legal agents', route: '/agents', category: 'agent_ai', icon: 'List', minRole: 'operator' },
  { id: 'model-catalog', label: 'Model Catalog', description: 'LLM model management', route: '/model-catalog', category: 'agent_ai', icon: 'Brain', minRole: 'analyst' },
  { id: 'superagent', label: 'SuperAgent', description: 'Multi-agent task execution', route: '/superagent', category: 'agent_ai', icon: 'Zap', minRole: 'operator' },
  { id: 'universal-chat', label: 'Universal Chat', description: 'AI chat interface', route: '/chat', category: 'agent_ai', icon: 'MessageCircle', minRole: 'user' },
  { id: 'global-agent-chat', label: 'Global Agent Chat', description: 'World-class agent interface', route: '/global-chat', category: 'agent_ai', icon: 'Globe', minRole: 'user' },
  { id: 'multimodal', label: 'Multimodal Studio', description: 'Vision, speech & document processing', route: '/multimodal', category: 'agent_ai', icon: 'Layers', minRole: 'developer' },

  { id: 'a2a', label: 'A2A Collaboration', description: 'Agent-to-agent protocol hub', route: '/orchestration/a2a', category: 'orchestration', icon: 'GitBranch', minRole: 'operator' },
  { id: 'bmad', label: 'BMAD Workflows', description: 'Workflow visualization', route: '/orchestration/bmad', category: 'orchestration', icon: 'Workflow', minRole: 'operator' },
  { id: 'cam', label: 'CAM Dashboard', description: 'Context-aware memory management', route: '/orchestration/cam', category: 'orchestration', icon: 'Database', minRole: 'analyst' },
  { id: 'memory-browser', label: 'Memory Browser', description: 'Agent memory inspection', route: '/orchestration/memory', category: 'orchestration', icon: 'Search', minRole: 'analyst' },
  { id: 'grpo', label: 'GRPO Training', description: 'Response optimization training', route: '/orchestration/grpo', category: 'orchestration', icon: 'TrendingUp', minRole: 'senior_analyst' },
  { id: 'policies', label: 'Policy Management', description: 'Policy & compliance controls', route: '/orchestration/policies', category: 'orchestration', icon: 'FileCheck', minRole: 'manager' },
  { id: 'orchestration-dashboard', label: 'Orchestration Dashboard', description: 'Orchestration overview', route: '/orchestration-dashboard', category: 'orchestration', icon: 'BarChart3', minRole: 'analyst' },

  { id: 'command-center', label: 'Operations Hub', description: 'Unified operations center', route: '/operations', category: 'admin', icon: 'Monitor', minRole: 'user' },
  { id: 'org-admin', label: 'Organization Admin', description: 'Organization management', route: '/org-admin', category: 'admin', icon: 'Building', minRole: 'org_admin', requiresOrg: true },
  // admin-console + realtime-dashboard removed 2026-05-06 (Phase A T001): admin-console
  // page never had its own component (route mapped to <CommandCentre>); realtime-dashboard
  // succeeded by Phase C scaffold /live-activity-feed (JrxSidebar.tsx:90, App.tsx:409).
  { id: 'architect', label: 'Architect Builder', description: 'Visual org design tool', route: '/architect', category: 'admin', icon: 'PenTool', minRole: 'manager' },
  { id: 'hitl', label: 'HITL Decision Cards', description: 'Human-in-the-loop approvals', route: '/decision-cards', category: 'admin', icon: 'CheckSquare', minRole: 'operator' },
  { id: 'digital-twin', label: 'Digital Twin', description: 'System digital twin view', route: '/digital-twin', category: 'admin', icon: 'Eye', minRole: 'super_admin' },
  { id: 'agent-activity', label: 'Agent Activity', description: 'Real-time agent monitoring', route: '/agent-activity', category: 'admin', icon: 'Activity', minRole: 'analyst' },
  // Session-10 Batch D (2026-05-10) — read-only operator view of the 5 cross-cutting
  // governance services (maker-checker, security-monitor, cost-opt, concurrency,
  // org-rate-limit). All panels gated by JRX_F_GOV_* flags + admin SDK scope.
  { id: 'governance-surface', label: 'Governance Surface', description: 'Maker-Checker · Security Monitor · Cost Optimizer · Concurrency · Org Rate Limit', route: '/superadmin/governance', category: 'admin', icon: 'ShieldCheck', minRole: 'super_admin' },

  { id: 'nyayasiddhi-institutional', label: 'Jurexio Institutional™', description: 'Legal governance platform for large firms', route: '/institutional', category: 'enterprise', icon: 'Building2', minRole: 'manager', requiresOrg: true },
  // enterprise-dashboard removed 2026-05-06 (Phase A) — unified-enterprise-dashboard.tsx deleted.

  { id: 'feature-test', label: 'Feature Testing', description: 'Feature validation dashboard', route: '/feature-test', category: 'testing', icon: 'TestTube', minRole: 'developer' },
  { id: 'p1-quality', label: 'P1 AI Quality Test', description: 'AI quality assessment', route: '/test/p1-quality', category: 'testing', icon: 'Award', minRole: 'senior_analyst' },
  { id: 'sdlc', label: 'SDLC Dashboard', description: 'Development lifecycle', route: '/sdlc', category: 'testing', icon: 'GitPullRequest', minRole: 'developer' },

  { id: 'content-studio', label: 'Content Studio', description: 'Marketing content for legal firms', route: '/content-studio', category: 'content', icon: 'PenSquare', minRole: 'analyst' },
];

export function hasAccess(userRole: string, minRole: RoleLevel): boolean {
  const userLevel = ROLE_HIERARCHY[userRole as RoleLevel] ?? ROLE_HIERARCHY.guest;
  const requiredLevel = ROLE_HIERARCHY[minRole] ?? 0;
  return userLevel >= requiredLevel;
}

export function getAccessibleFeatures(userRole: string): FeatureEntry[] {
  return FEATURE_REGISTRY.filter(f => hasAccess(userRole, f.minRole));
}

export function getFeaturesByCategory(features: FeatureEntry[]): Record<FeatureCategory, FeatureEntry[]> {
  const grouped: Record<string, FeatureEntry[]> = {};
  for (const f of features) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  }
  return grouped as Record<FeatureCategory, FeatureEntry[]>;
}
