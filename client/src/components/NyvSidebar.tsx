/**
 * NyvSidebar — Jurexio Enterprise Command Center
 *
 * task-344 (2026-05-13) — 50 → 25 entry consolidation. The 7 enterprise
 * sections are now: Dashboard / Chat / Agents / Orchestration /
 * SDK & Models / Governance & Compliance / Admin & Settings. Every prior
 * sidebar item remains reachable as a hub-tab deep-link or a 301-style
 * redirect (see App.tsx — `task-344` markers). Per-item minRole still
 * gates super-admin entries.
 *
 * Previous (B4, 2026-05-12) — 11 → 7 section consolidation per
 * CONSOLE-AUDIT-2026-05-12 §5.
 *
 * Previous: 11 sections / ~110 items, with overlapping entries (Realtime
 * Activity in both Agents and Operations; Lineage/Memory/Hash-Chain
 * duplicating Audit Chain; "Platform v5 (internal)" exposing implementation
 * detail). Result: ~50 sidebar items across 7 sections.
 *
 * Current → target mapping (every prior entry preserved as a route in
 * App.tsx; many are now reached via hub tabs rather than top-level sidebar
 * entries — bookmarks and deep-links continue to work):
 *
 *   1. Workspace               (Home + per-user)         [user]
 *      ← Dashboard · Overview · Chat · Documents · My Approvals · Skills · Billing · Ledger
 *
 *   2. Agents & Orchestration                            [operator]
 *      ← Agent Registry · Orchestration Hub (a2a/bmad/cam/router/lineage/memory tabs)
 *        · Create Agent (covers /create-agent + /agent-wizard) · Live Testing
 *        · Scorecard · Activity Feed (canonical — was duplicated as Realtime
 *        Activity + Live Activity Feed) · Workspace · SuperAgent
 *        · Digital Twin · Subagents (ClaWdBot/OpenBot/AutomateAI via Skillshop)
 *
 *   3. Intelligence & Models                             [analyst]
 *      ← Research Dashboard · Models & Routing · LRM Dashboard · NLP Tools
 *        (single entry — Classify/Predict/Sentiment/Translate/NER/Legal NER/
 *        Summarize/OCR/Forensics/Identity all reachable via tabs) · Multimodal
 *        Studio · Workflows (Architect)
 *
 *   4. Knowledge                                         [operator]
 *      ← Prompt Library · RAG Knowledge Base · Statutes & Citations · Tools/MCP
 *
 *   5. Operations                                        [operator]
 *      ← Platform Health · Operations Hub · Cost Optimizer · Drift Monitor
 *        · Activity Feed · Regulatory Monitor · LLM Priority · Provider Failover
 *
 *   6. Governance & Compliance                           [analyst]
 *      ← HITL Decisions · Audit Chain (Hash-Chain dedup'd) · Lineage Browser
 *        · Memory Browser · Guardrails · Policies · Enforcement · LLM Judge
 *        · Adversarial Testing · RBAC Console · ISO 42001/SOC2 · DPDPA
 *        · EU AI Act · GRPO Training
 *
 *   7. Platform Admin                                    [org_admin+]
 *      ← Organisations · Modules · Org Console · Federated Tenants · White-Label
 *        · SDK Hub (Developer/Playground/Tester/Onboarding/Keys/Testing/Schema
 *          /Smoke/SDLC all consolidated as SDK Hub tabs)
 *      [super_admin only]
 *      ← Super-Admin Overview · Platform Registry · LLM Budget · Agent Matrix
 *        · Governance Surface · Provider Failover (Admin) · ROMA L5 Admin
 *        · Digital Twin (admin) · Platform v5 (internal — single entry into
 *          /platform-v5/orch; the 9 sub-pages remain reachable as routes
 *          for capability testing)
 *
 * Collapsed/expanded state per section persists in localStorage under key
 * `nv_sidebar_state` (JSON map of section.id → boolean).
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { navigateExternalOrConsole } from '@/lib/jrx-console-routes';
import { cn } from '@/lib/utils';
import { CUSTOMER_ORGS_MIN_ROLE } from '@/lib/rbac-customer-orgs';
import {
  LayoutDashboard, Building2, Cpu, Shield, BarChart3,
  Key, Users, Settings, ChevronDown, ChevronRight,
  Brain, FileSearch, Scale, BookOpen,
  Code2, Beaker, Zap, Bot, Workflow,
  MessageSquare, CreditCard,
  ShieldCheck, AlertTriangle, Activity, Layers, Newspaper,
  MonitorCheck, Lock, HelpCircle,
  PanelLeftClose, PanelLeft, Globe2, User,
  Receipt, Database, GitBranch, Network, Search,
  FlaskConical, Wand2, Gavel,
  Server, Sliders,
  PackageSearch, ScrollText, Palette, Pyramid,
  Briefcase, GitCompareArrows, Archive, ToggleLeft,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: string;
  badgeColor?: string;
  new?: boolean;
  minRole?: string;
}

interface NavSection {
  id: string;
  title: string;
  icon: React.ElementType;
  color: string;
  items: NavItem[];
  minRole?: string;
  roles?: string[];
}

// ─── Role Hierarchy ───────────────────────────────────────────────────────────

const ROLE_LEVELS: Record<string, number> = {
  super_admin: 100,
  enterprise_admin: 80,
  org_admin: 70,
  manager: 60,
  senior_analyst: 55,
  analyst: 50,
  developer: 45,
  operator: 40,
  user: 10,
};

function hasRole(userRole: string, minRole: string): boolean {
  return (ROLE_LEVELS[userRole] ?? 0) >= (ROLE_LEVELS[minRole] ?? 0);
}

// ─── Sidebar collapse-state persistence ──────────────────────────────────────

const SIDEBAR_STATE_KEY = 'nv_sidebar_state';

function loadSidebarState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistSidebarState(state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage may be unavailable (Safari private mode etc.) */
  }
}

// ─── 7-section IA (B4 — task-179, 2026-05-12) ────────────────────────────────
// Exported as the single source of truth for the sidebar tree. NyvBreadcrumbs
// (task-180/B5) derives its path → section/item index directly from this list,
// so adding a sidebar item automatically gives that route a breadcrumb.

export const SECTIONS: NavSection[] = [
  // 1. DASHBOARD — daily-driver entries, all roles ─────────────────────────
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    color: 'text-[#C7B15B]',
    minRole: 'user',
    items: [
      { label: 'Dashboard',    path: '/dashboard',            icon: LayoutDashboard },
      { label: 'Billing',      path: '/billing/subscription', icon: CreditCard      },
    ],
  },

  // 2. CHAT — single entry; Universal/Agent/Legal handled as ChatHub tabs ─
  {
    id: 'chat',
    title: 'Chat',
    icon: MessageSquare,
    color: 'text-[#C7B15B]',
    minRole: 'user',
    items: [
      { label: 'Chat', path: '/chat', icon: MessageSquare },
    ],
  },

  // 2b. LEGAL — document automation + chat + orchestration + compliance hubs
  {
    id: 'legal',
    title: 'Legal',
    icon: Scale,
    color: 'text-[#C7B15B]',
    minRole: 'user',
    items: [
      { label: 'Document AI Hub', path: '/document-ai-hub', icon: FileSearch },
      { label: 'Legal Drafting', path: '/legal-drafting', icon: FileSearch },
      { label: 'Matter Vault', path: '/matter-vault', icon: Archive, minRole: 'operator' },
      { label: 'Redline & Merge', path: '/document-redline', icon: GitCompareArrows },
      { label: 'Legal Chat',      path: '/chat?tab=legal', icon: MessageSquare },
      { label: 'Instant Search',  path: '/instant-search', icon: Search },
      { label: 'Live Legal Feed', path: '/legal-intelligence-feed', icon: Newspaper, minRole: 'operator' },
      { label: 'Knowledge Plane', path: '/nys-knowledge-plane', icon: BookOpen, minRole: 'operator' },
      { label: 'Statutes & Citations', path: '/statutes-citations', icon: ScrollText },
      { label: 'Regulatory Monitor', path: '/regulatory', icon: Activity, minRole: 'operator' },
      { label: 'Compliance',      path: '/dpdpa-compliance', icon: ShieldCheck, minRole: 'analyst' },
    ],
  },

  // 3. AGENTS — registry, lifecycle, testing ───────────────────────────────
  {
    id: 'agents',
    title: 'Agents',
    icon: Bot,
    color: 'text-[#C7B15B]',
    minRole: 'operator',
    items: [
      { label: 'Agent Gallery', path: '/agent-registry',     icon: Bot          },
      { label: 'ROMA L5 Admin',    path: '/roma-l5-admin', icon: Network,     minRole: 'analyst'   },
      { label: 'Digital Twin',   path: '/digital-twin-creator', icon: Users,  minRole: 'analyst'   },
      { label: 'Create Agent',   path: '/create-agent',       icon: Wand2,         minRole: 'developer' },
      { label: 'Live Testing',   path: '/agent-live-testing', icon: FlaskConical,  minRole: 'analyst'   },
      { label: 'My Approvals',   path: '/my-approvals',       icon: ShieldCheck    },
    ],
  },

  // 4. ORCHESTRATION — orch hub, workflows, ops dashboards ────────────────
  // A2A/BMAD/CAM/Router/Lineage/Memory all live as OrchestrationHub tabs.
  {
    id: 'orchestration',
    title: 'Orchestration',
    icon: Workflow,
    color: 'text-[#C7B15B]',
    minRole: 'operator',
    items: [
      { label: 'Orchestration Hub', path: '/orchestration',       icon: Workflow     },
      { label: 'Workflows',         path: '/architect',           icon: GitBranch,    minRole: 'manager' },
      { label: 'Operations Hub',    path: '/operations',          icon: MonitorCheck, minRole: 'analyst' },
      { label: 'Platform Health',   path: '/platform-health-map', icon: Activity     },
    ],
  },

  // 5. SDK & MODELS — developer surface + model/intelligence catalogues ───
  // SDK Hub absorbs Developer/Playground/Tester/Onboarding/Keys/Testing/
  // Schema/Smoke/SDLC/Feature-Test via ?tab= deep-links (see App.tsx
  // task-344 redirects).
  //
  // Section minRole is set to the LOWEST item minRole so that any user who
  // can see at least one item in the section also sees the section header.
  // (`developer = 45 < analyst = 50` in ROLE_LEVELS — gating the section at
  // 'analyst' would have blocked developer users from seeing SDK Hub /
  // Multimodal Studio entirely.)
  {
    id: 'sdk-models',
    title: 'SDK & Models',
    icon: Code2,
    color: 'text-[#C7B15B]',
    // Lowest item minRole = 'developer' (SDK Hub, Multimodal Studio).
    // 'developer' = 45 < 'analyst' = 50, so an analyst-gated section would
    // hide the developer items entirely (NV-RBAC consistency, task-344).
    minRole: 'developer',
    items: [
      // SDK Hub route is `minRole="user"`, but we still surface it from the
      // SDK section only to developer+ to keep the IA persona-clean.
      { label: 'SDK Hub',           path: '/sdk-hub?tab=overview',   icon: Code2,    minRole: 'developer' },
      { label: 'Model Catalog',     path: '/model-catalog',          icon: Cpu,      minRole: 'analyst'   },
      { label: 'LLM Provider Keys', path: '/superadmin/provider-secrets', icon: Key, minRole: 'super_admin' },
      { label: 'Intelligence',      path: '/intelligence',           icon: Brain,    minRole: 'manager'   },
      { label: 'Multimodal Studio', path: '/multimodal',             icon: Palette,  minRole: 'developer' },
    ],
  },

  // 6. GOVERNANCE & COMPLIANCE ────────────────────────────────────────────
  // ISO 42001 / SOC2, EU AI Act, DPDPA all reachable via /superadmin/compliance
  // (which already tabs across them). Hash-chain folded into Audit Chain.
  //
  // Section minRole = 'operator' (the lowest item minRole — HITL Decisions)
  // so operators see the Governance section with just the entries they can
  // actually open. Per-item minRole then mirrors each route's actual
  // ProtectedRoute config in App.tsx (audit-chain → org_admin,
  // dpdpa → analyst, policies/RBAC → manager).
  {
    id: 'governance',
    title: 'Governance & Compliance',
    icon: Shield,
    color: 'text-[#C7B15B]',
    // Lowest item minRole = 'operator' (HITL Decisions). Section gate must
    // not be stricter than the lowest item or it hides entries the user is
    // otherwise allowed to access (NV-RBAC consistency, task-344).
    minRole: 'operator',
    items: [
      // task-344 (2026-05-13) — Governance consolidated to 5 entries.
      // Guardrails, Enforcement, ISO 42001/SOC2, US State Privacy, and
      // EU AI Act were folded into hub tabs:
      //   • /intelligence/guardrails  → /intelligence?tab=guardrails
      //   • /enforcement             → /orchestration?tab=enforcement
      //   • /superadmin/compliance, /us-state-privacy, /eu-ai-compliance
      //                              → tabs of /superadmin/compliance
      // (and DPDPA itself is the analyst-facing landing — the "Compliance"
      // entry below). Routes for those URLs remain in App.tsx so deep
      // links still resolve; they're just not surfaced in the sidebar.
      { label: 'HITL Decisions', path: '/hitl-decision-cards',  icon: Scale,       minRole: 'operator'  },
      { label: 'Audit Chain',    path: '/audit-chain',          icon: Lock,        minRole: 'org_admin' },
      { label: 'Policies',       path: '/orchestration/policies', icon: Gavel,     minRole: 'manager'   },
      { label: 'Compliance',     path: '/dpdpa-compliance',     icon: ShieldCheck, minRole: 'analyst'   },
      { label: 'RBAC Console',   path: '/rbac-console',         icon: Users,       minRole: 'manager'   },
    ],
  },

  // 7. ADMIN & SETTINGS — org_admin+ ; super_admin entries per-row gated ──
  // /white-label and /admin/white-label both redirect to /org-admin?tab=branding;
  // /org-platform-settings redirects to /org-admin?tab=platform.
  {
    id: 'admin-settings',
    title: 'Admin & Settings',
    icon: Settings,
    color: 'text-[#C7B15B]',
    minRole: 'org_admin',
    items: [
      { label: 'Org Console',          path: '/org-admin',                icon: Building2 },
      // task-354 (2026-05-13) — partner-platform view of downstream customer firms.
      // minRole pulled from CUSTOMER_ORGS_MIN_ROLE so this entry, the App.tsx
      // ProtectedRoute, and the server-side platform_admin layer (see
      // src/services/rbac/jrx-customer-org-rbac.ts) all agree.
      { label: 'Customer Orgs',        path: '/customer-orgs',            icon: Briefcase, minRole: CUSTOMER_ORGS_MIN_ROLE },
      { label: 'Organisations',        path: '/superadmin/organisations', icon: Globe2,   minRole: 'super_admin' },
      { label: 'Enterprise Super-Orgs',path: '/superadmin/super-orgs',    icon: Globe2,   minRole: 'super_admin' },
      { label: 'Platform Registry',    path: '/superadmin/platforms',     icon: Layers,   minRole: 'super_admin' },
      { label: 'Feature Flags',        path: '/superadmin/feature-flags', icon: ToggleLeft, minRole: 'super_admin' },
      { label: 'Platform v5 Internal', path: '/platform-v5',              icon: Server,   minRole: 'super_admin' },
      { label: 'Federated Tenants',    path: '/superadmin/federated-tenants', icon: Globe2, minRole: 'super_admin' },
      { label: 'Provider Failover',    path: '/superadmin/provider-failover', icon: AlertTriangle, minRole: 'super_admin' },
      { label: 'Super Admin Compliance', path: '/superadmin/compliance',  icon: ShieldCheck, minRole: 'super_admin' },
    ],
  },
];

// ─── SidebarItem Component ────────────────────────────────────────────────────

interface SidebarItemProps {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick: (path: string) => void;
}

function SidebarItem({ item, isActive, collapsed, onClick }: SidebarItemProps) {
  const Icon = item.icon;
  return (
    <button
      onClick={() => onClick(item.path)}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left',
        'text-xs font-medium transition-all duration-150 group',
        isActive
          ? 'bg-[#152448] text-white shadow-sm'
          : 'text-white/70 hover:text-white hover:bg-white/10',
      )}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', isActive ? 'text-[#C7B15B]' : 'text-white/50 group-hover:text-white/80')} aria-hidden="true" />
      {!collapsed && (
        <span className="flex-1 truncate">{item.label}</span>
      )}
      {!collapsed && item.new && (
        <span className="ml-auto px-1 py-0.5 rounded text-[9px] font-bold bg-[#C7B15B] text-slate-900 leading-none flex-shrink-0">NEW</span>
      )}
      {!collapsed && item.badge && (
        <span className={cn('ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-none flex-shrink-0', item.badgeColor ?? 'bg-blue-500/20 text-blue-300')}>
          {item.badge}
        </span>
      )}
    </button>
  );
}

// ─── SidebarSection Component ─────────────────────────────────────────────────

interface SidebarSectionProps {
  section: NavSection;
  visibleItems: NavItem[];
  currentPath: string;
  collapsed: boolean;
  onNavigate: (path: string) => void;
  open: boolean;
  onToggle: (id: string) => void;
}

function SidebarSection({ section, visibleItems, currentPath, collapsed, onNavigate, open, onToggle }: SidebarSectionProps) {
  const Icon = section.icon;

  if (!visibleItems.length) return null;

  if (collapsed) {
    return (
      <div className="mb-1" role="navigation" aria-label={section.title}>
        <div className={cn('flex items-center justify-center py-1.5 mb-0.5', section.color)}>
          <Icon className="w-4 h-4" aria-hidden="true" />
        </div>
        {visibleItems.map(item => (
          <SidebarItem
            key={item.path}
            item={item}
            isActive={currentPath === item.path || currentPath.startsWith(item.path + '/')}
            collapsed={true}
            onClick={onNavigate}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="mb-1" role="navigation" aria-label={section.title}>
      <button
        onClick={() => onToggle(section.id)}
        className={cn('w-full flex items-center gap-2 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest cursor-pointer select-none', section.color, 'hover:opacity-80 transition-opacity')}
        aria-expanded={open}
        aria-label={`Toggle ${section.title} section`}
      >
        <Icon className="w-3 h-3" aria-hidden="true" />
        <span className="flex-1 text-left">{section.title}</span>
        {open ? <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" /> : <ChevronRight className="w-3 h-3 opacity-60" aria-hidden="true" />}
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 pl-1">
          {visibleItems.map(item => (
            <SidebarItem
              key={item.path}
              item={item}
              isActive={currentPath === item.path || currentPath.startsWith(item.path + '/')}
              collapsed={false}
              onClick={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── NyvSidebar Main Component ────────────────────────────────────────────────

interface NyvSidebarProps {
  className?: string;
}

export function NyvSidebar({ className }: NyvSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const userRole = (user as { role?: string })?.role ?? 'user';

  // Per-section open/closed map, persisted in localStorage["nv_sidebar_state"].
  const [sectionState, setSectionState] = useState<Record<string, boolean>>(() => loadSidebarState());

  useEffect(() => {
    persistSidebarState(sectionState);
  }, [sectionState]);

  const toggleSection = useCallback((id: string) => {
    setSectionState(prev => {
      // Default state is "open" — so the first toggle should close it.
      const current = prev[id] ?? true;
      return { ...prev, [id]: !current };
    });
  }, []);

  const handleNavigate = useCallback((path: string) => {
    navigateExternalOrConsole(path, navigate);
  }, [navigate]);

  // Filter sections by role, then per-item by minRole (so super_admin-only
  // items inside a section visible to org_admin are correctly hidden).
  const visibleSections = SECTIONS
    .filter(section => {
      if (section.roles) return section.roles.some(r => r === userRole);
      if (section.minRole) return hasRole(userRole, section.minRole);
      return true;
    })
    .map(section => ({
      section,
      items: section.items.filter(item => !item.minRole || hasRole(userRole, item.minRole)),
    }))
    .filter(({ items }) => items.length > 0);

  return (
    <aside
      className={cn(
        'flex flex-col bg-[#2B384C] border-r border-white/10',
        'transition-all duration-200 ease-in-out flex-shrink-0',
        collapsed ? 'w-12' : 'w-56',
        className,
      )}
      aria-label="Jurexio navigation sidebar"
      role="navigation"
    >
      {/* Header */}
      <div className={cn('flex items-center border-b border-white/10 flex-shrink-0', collapsed ? 'justify-center py-2.5' : 'gap-2 px-3 py-2.5')}>
        {!collapsed && (
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5 min-w-0 flex-1 hover:opacity-80 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-[#C7B15B] rounded"
            aria-label="Back to dashboard home"
            data-testid="sidebar-home-logo"
          >
            <img
              src="/nyayasiddhi-icon.png"
              alt="Jurexio"
              className="w-7 h-7 rounded object-contain flex-shrink-0 bg-white"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.src = '/nyayasiddhi-logo.png';
              }}
            />
            <div className="w-6 h-6 rounded bg-[#152448] items-center justify-center flex-shrink-0 hidden" aria-hidden="true">
              <Scale className="w-3.5 h-3.5 text-[#C7B15B]" />
            </div>
            <div className="min-w-0 text-left">
              <div className="text-[10px] font-heading font-bold text-white truncate leading-none tracking-wide">NYAYASIDDHI</div>
              <div className="text-[8px] text-[#C7B15B]/80 truncate leading-tight">Justice. Powered by Precision.</div>
            </div>
          </button>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="w-7 h-7 rounded bg-white flex items-center justify-center hover:opacity-80 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-[#C7B15B] overflow-hidden"
            aria-label="Back to dashboard home"
            data-testid="sidebar-home-logo-collapsed"
          >
            <img src="/nyayasiddhi-icon.png" alt="" className="w-7 h-7 object-contain" aria-hidden="true" />
          </button>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex-shrink-0 p-0.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft className="w-3.5 h-3.5" aria-hidden="true" /> : <PanelLeftClose className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      </div>

      {/* Role badge */}
      {!collapsed && userRole && (
        <div className="px-3 py-1.5 border-b border-white/10">
          <div className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase',
            userRole === 'super_admin' ? 'bg-red-500/20 text-red-300' :
            userRole === 'org_admin' ? 'bg-amber-500/20 text-amber-300' :
            userRole === 'developer' ? 'bg-green-500/20 text-green-300' :
            'bg-blue-500/20 text-blue-300',
          )}>
            <Shield className="w-2.5 h-2.5" aria-hidden="true" />
            {userRole.replace(/_/g, ' ')}
          </div>
        </div>
      )}

      {/* Nav Sections */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5 space-y-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700">
        {visibleSections.map(({ section, items }) => (
          <SidebarSection
            key={section.id}
            section={section}
            visibleItems={items}
            currentPath={location}
            collapsed={collapsed}
            onNavigate={handleNavigate}
            open={sectionState[section.id] ?? true}
            onToggle={toggleSection}
          />
        ))}
      </div>

      {/* Footer */}
      <div className={cn('border-t border-white/10 flex-shrink-0', collapsed ? 'py-2 flex flex-col items-center gap-1' : 'p-2 space-y-0.5')}>
        {!collapsed ? (
          <>
            <button
              onClick={() => handleNavigate('/user/profile')}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors',
                location === '/user/profile' ? 'bg-[#152448] text-white' : 'text-white/70 hover:text-white hover:bg-white/10',
              )}
              aria-label="Profile and security settings"
              aria-current={location === '/user/profile' ? 'page' : undefined}
            >
              <User className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              <span>Profile & Security</span>
            </button>
            <button
              onClick={() => handleNavigate('/help')}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Help and documentation"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Help & Docs</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => handleNavigate('/user/profile')}
              className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Profile"
              title="Profile & Security"
            >
              <User className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              onClick={() => handleNavigate('/help')}
              className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Help"
              title="Help"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

export default NyvSidebar;
