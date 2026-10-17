import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Router, Route, Switch, useLocation } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { Toaster } from './components/ui/toaster';
import { JrxSkipLink } from './components/JrxSkipLink';
import { ErrorBoundaryWithRetry } from './components/ErrorBoundaryWithRetry';
import { AssistantDrawer } from './components/AssistantDrawer';
import { LanguageProvider } from './contexts/LanguageContext';
import { LoadingSpinner } from './components/ui/loading-spinner';

import NotFound from './pages/not-found';
import Login from './pages/Login';
import IndexLanding from './pages/IndexLanding';
import { roleHomeRelative } from './lib/jrx-role-home';

import { handleError, logError } from './lib/errorHandler';
import { AuthProvider } from './contexts/AuthContext';
import { OrgProvider } from './contexts/OrgContext';
import { clearAuthSession, getStoredUserRaw, setAuthSession } from './lib/auth-session';
import HelpButton from './components/help/HelpButton';
import { ProtectedRoute } from './components/ProtectedRoute';

const IdentityExtraction = lazy(() => import('./pages/identity-extraction'));

const JurexioInstitutional = lazy(() => import('./pages/nyayasiddhi-institutional'));

const JurexioGovernance = lazy(() => import('./pages/nyayasiddhi-governance'));
const ComprehensiveDocumentation = lazy(() => import('./components/ComprehensiveDocumentation'));
const EnforcementMonitoring = lazy(() => import('./pages/EnforcementMonitoring'));

const JurexioAcademy = lazy(() => import('./pages/nyayasiddhi-academy'));

// OrchestrationDashboard: deleted 2026-05-12 (B3) — stale legacy; route redirects to /orchestration?tab=live
// task-158 (2026-05-12) — new console landing dashboard
const ConsoleDashboard = lazy(() => import('./pages/console-dashboard'));
const RomaL5AdminDashboard = lazy(() => import('./pages/roma-l5-admin'));
// AgentOrchestration: still rendered as the Overview tab inside OrchestrationHub.
// /orchestration/legacy was a duplicate mount of the same component on top of an
// orphan simulated `pages/orchestration.tsx` (task-259, 2026-05-13) — the route
// now redirects to /orchestration?tab=overview and the orphan file was deleted.
const AgentRegistry = lazy(() => import('./pages/AgentRegistry'));
const ModelCatalog = lazy(() => import('./pages/ModelCatalog'));
const SDKDownloads = lazy(() => import('./pages/SDKDownloads'));
const A2ACollaborationDashboard = lazy(() => import('./pages/orchestration/A2ACollaborationDashboard'));
const BMADWorkflowVisualizer = lazy(() => import('./pages/orchestration/BMADWorkflowVisualizer'));
const MemoryBrowserCAM = lazy(() => import('./pages/orchestration/MemoryBrowserCAM'));
const GRPOTrainingDashboard = lazy(() => import('./pages/orchestration/GRPOTrainingDashboard'));
const PolicyManagementConsole = lazy(() => import('./pages/orchestration/PolicyManagementConsole'));
const CAMDashboardPage = lazy(() => import('./pages/orchestration/CAMDashboardPage'));
const RouterDecisionsPage = lazy(() => import('./pages/orchestration/RouterDecisionsPage'));
const LineagePage = lazy(() => import('./pages/orchestration/LineagePage'));
const P1AIQualityTest = lazy(() => import('./pages/p1-ai-quality-test'));
const MultimodalStudio = lazy(() => import('./pages/multimodal/MultimodalStudio'));
const UniversalChat = lazy(() => import('./pages/UniversalChat'));
const GlobalAgentChat = lazy(() => import('./pages/GlobalAgentChat'));
const ChatHub = lazy(() => import('./pages/hubs/ChatHub'));
const SDKHubConsolidated = lazy(() => import('./pages/hubs/SDKHub'));
const OrchestrationHubConsolidated = lazy(() => import('./pages/hubs/OrchestrationHub'));
const OperationsHub = lazy(() => import('./pages/hubs/OperationsHub'));
const IntelligenceHubConsolidated = lazy(() => import('./pages/hubs/IntelligenceHub'));
const ArchitectWorkflowBuilder = lazy(() => import('./pages/architect-workflow-builder'));
const HITLDecisionCards = lazy(() => import('./pages/hitl-decision-cards'));
const OrgAdminDashboard = lazy(() => import('./pages/org-admin-dashboard'));
const AgentTestingEnvironment = lazy(() => import('./pages/agent-testing-environment'));
const SDKDeveloperConsole = lazy(() => import('./pages/sdk-developer-console'));
const SDKApiPlayground = lazy(() => import('./pages/sdk-api-playground'));
const AgentWorkspace = lazy(() => import('./pages/agent-workspace'));
const LegalChatPage = lazy(() => import('./pages/legal-chat'));

// ── Billing & Credits Pages ───────────────────────────────────────────────────
const SubscriptionManagement = lazy(() => import('./pages/subscription-management'));
const CreditWallet = lazy(() => import('./pages/credit-wallet'));
const BillingLedger = lazy(() => import('./pages/billing-ledger'));

// ── New Service Pages ─────────────────────────────────────────────────────────
const LRMRouterDashboard = lazy(() => import('./pages/lrm-router-dashboard'));
const RegulatoryMonitor = lazy(() => import('./pages/regulatory-monitor'));
const RBACConsole = lazy(() => import('./pages/rbac-console'));
const SkillsLibrary = lazy(() => import('./pages/skills-library'));
const LLMPriorityDashboard = lazy(() => import('./pages/llm-priority-dashboard'));
const ProviderSecretsSettings = lazy(() => import('./pages/provider-secrets-settings'));
// task-344 (2026-05-13): WhiteLabelAdmin + OrgWhiteLabelAdmin merged into the
// OrgAdminDashboard `branding` tab; the standalone routes redirect there.
const OrgLlmBudgetAdmin = lazy(() => import('./pages/admin/org-llm-budget'));
const AdversarialTesting = lazy(() => import('./pages/adversarial-testing'));
const ModelDriftMonitor = lazy(() => import('./pages/model-drift-monitor'));
// task-344 (2026-05-13): HashChainAudit moved into AuditChain page's `hash-chain` tab.
const JurexioSDKHub = lazy(() => import('./pages/jurexio-sdk-hub'));
const SDKTestingConsole = lazy(() => import('./pages/sdk-testing-console'));
const AgentCreationWizard = lazy(() => import('./pages/agent-creation-wizard'));
const PlatformManagement = lazy(() => import('./pages/platform-management'));
const AgentLiveTesting = lazy(() => import('./pages/agent-live-testing'));

// ── Aliases for sidebar links that lacked dedicated dashboards (2026-05-12 fix) ─
// Routes /agent-activity, /agent-flows, /digital-twin, /feature-test were referenced
// in App.tsx without imports → ReferenceError at runtime. Repoint to the closest
// existing operational pages so the routes load instead of crashing.
const AgentActivityDashboard = lazy(() => import('./pages/live-activity-feed'));
// AgentFlowsDashboard: deleted 2026-05-12 (B3) — stale legacy; /agent-flows redirects to /orchestration?tab=live
const DigitalTwinDashboard   = lazy(() => import('./pages/digital-twin-creator'));
// task-344 (2026-05-13): /feature-test now redirects to /sdk-hub?tab=testing.
const SDLCDashboard          = lazy(() => import('./pages/smoke-harness-console'));
const AutomationDashboard    = lazy(() => import('./pages/automateai-builder'));

// ── Customer Agentic Products (May–Sep 2026 Build) ────────────────────────────
const ClaWdBotConsole = lazy(() => import('./pages/clawdbot-console'));
const ClientSdkPlayground = lazy(() => import('./pages/client-sdk-playground'));
const OpenBotStudio = lazy(() => import('./pages/openbot-studio'));
const AutomateAIBuilder = lazy(() => import('./pages/automateai-builder'));
const DigitalTwinCreator = lazy(() => import('./pages/digital-twin-creator'));
const SkillsMarketplace = lazy(() => import('./pages/skills-marketplace'));

// ── Super Admin Pages ─────────────────────────────────────────────────────────
const SuperAdminPlatformRegistry = lazy(() => import('./pages/superadmin-platform-registry'));
const SuperAdminOrganisations    = lazy(() => import('./pages/superadmin-organisations'));
const SuperAdminSuperOrgs        = lazy(() => import('./pages/superadmin-super-orgs'));
const SuperAdminLlmBudget        = lazy(() => import('./pages/superadmin-llm-budget'));
const SuperAdminCompliance       = lazy(() => import('./pages/superadmin-compliance'));
const SuperAdminAgentMatrix      = lazy(() => import('./pages/superadmin-agent-matrix'));
const SuperAdminGovernance       = lazy(() => import('./pages/superadmin-governance'));
const SuperAdminFederatedTenants = lazy(() => import('./pages/superadmin-federated-tenants'));
const SuperAdminProviderFailover = lazy(() => import('./pages/superadmin-provider-failover'));
const SuperAdminFeatureFlags     = lazy(() => import('./pages/superadmin-feature-flags'));

// ── Task #109 (2026-05-11) — Platform-v5 admin pages, one per /api/nv5/* namespace ─
const PlatformV5Hub           = lazy(() => import('./pages/platform-v5'));
const PlatformV5Orch          = lazy(() => import('./pages/platform-v5/orch'));
const PlatformV5Multimodal    = lazy(() => import('./pages/platform-v5/multimodal'));
const PlatformV5Voice         = lazy(() => import('./pages/platform-v5/voice'));
const PlatformV5Workflows     = lazy(() => import('./pages/platform-v5/workflows'));
const PlatformV5DocAi         = lazy(() => import('./pages/platform-v5/doc-ai'));
const BulkDocUpload           = lazy(() => import('./pages/bulk-doc-upload'));
const FederatedTenants        = lazy(() => import('./pages/federated-tenants'));
// task-344 (2026-05-13): /realtime-activity now redirects to /live-activity-feed.
const ProviderFailover        = lazy(() => import('./pages/provider-failover'));
const AuditChain              = lazy(() => import('./pages/audit-chain'));
const PlatformV5LegalPipeline = lazy(() => import('./pages/platform-v5/legal-pipeline'));
const PlatformV5Compliance    = lazy(() => import('./pages/platform-v5/compliance'));
const PlatformV5Internal      = lazy(() => import('./pages/platform-v5/internal'));
const PlatformV5Gov           = lazy(() => import('./pages/platform-v5/gov'));

// ── Intelligence Hub Pages ────────────────────────────────────────────────────
const IntelligenceDashboard    = lazy(() => import('./pages/intelligence-dashboard'));
// ── Intelligence Hub — E3–E9 + Client Detail ─────────────────────────────────
const IntelligencePredict      = lazy(() => import('./pages/intelligence-predict'));
const IntelligenceResearch     = lazy(() => import('./pages/intelligence-research'));
const IntelligenceClassify     = lazy(() => import('./pages/intelligence-classify'));
const IntelligenceSentiment    = lazy(() => import('./pages/intelligence-sentiment'));
const IntelligenceTranslate    = lazy(() => import('./pages/intelligence-translate'));
const GuardrailDashboard       = lazy(() => import('./pages/guardrail-dashboard'));

// ── SDK Console Pages ─────────────────────────────────────────────────────────
const SdkPlatformOnboarding = lazy(() => import('./pages/sdk-platform-onboarding'));
const SdkKeyManagement      = lazy(() => import('./pages/sdk-key-management'));
// task-354 (2026-05-13) — partner-platform view of downstream customer firms
const CustomerOrgsPage      = lazy(() => import('./pages/customer-orgs'));
const CustomerOrgDetailPage = lazy(() => import('./pages/customer-org-detail'));
import { CUSTOMER_ORGS_MIN_ROLE } from '@/lib/rbac-customer-orgs';
const SdkApiTester          = lazy(() => import('./pages/sdk-api-tester'));

// ── Firm Practice Management Pages ───────────────────────────────────────────
const OnboardingWizard    = lazy(() => import('./pages/onboarding'));

// ── User Profile + Org Settings ──────────────────────────────────────────────
const UserProfile         = lazy(() => import('./pages/user-profile'));
// task-344 (2026-05-13): OrgPlatformSettings merged into OrgAdminDashboard `platform` tab.
// Phase 5 (Session-15 v13, 2026-05-11) — per-org console overlay editor
const OrgConsoleLayoutPage = lazy(() => import('./pages/admin/OrgConsoleLayout'));

// ─── Phase C scaffolds (added 2026-05-06) — see src/routes/jrx-phase-c-stubs-routes.ts ───
const PlatformHealthMap = lazy(() => import('./pages/platform-health-map'));
const LiveActivityFeed = lazy(() => import('./pages/live-activity-feed'));
const MyApprovals = lazy(() => import('./pages/my-approvals'));
const DocumentAiHub = lazy(() => import('./pages/document-ai-hub'));
const LegalDrafting = lazy(() => import('./pages/legal-drafting'));
const DocumentRedline = lazy(() => import('./pages/document-redline'));
const OcrExtraction = lazy(() => import('./pages/ocr-extraction'));
const AutofillQaReview = lazy(() => import('./pages/autofill-qa-review'));
const Summarization = lazy(() => import('./pages/summarization'));
const PromptLibrary = lazy(() => import('./pages/prompt-library'));
const RagKnowledgeBase = lazy(() => import('./pages/rag-knowledge-base'));
const NysKnowledgePlane = lazy(() => import('./pages/nys-knowledge-plane'));
const InstantSearchPage = lazy(() => import('./pages/instant-search'));
const LegalIntelligenceFeedPage = lazy(() => import('./pages/legal-intelligence-feed'));
const MatterVault = lazy(() => import('./pages/matter-vault'));
const ToolsMcp = lazy(() => import('./pages/tools-mcp'));
const McpConnectors = lazy(() => import('./pages/mcp-connectors'));
const StatutesCitations = lazy(() => import('./pages/statutes-citations'));
const JurisdictionMapping = lazy(() => import('./pages/jurisdiction-mapping'));
const WebScrapingTargets = lazy(() => import('./pages/web-scraping-targets'));
const DpdpaCompliance = lazy(() => import('./pages/dpdpa-compliance'));
const SmokeHarnessConsole = lazy(() => import('./pages/smoke-harness-console'));
const DatabaseSchema = lazy(() => import('./pages/database-schema'));

// ── Sprint Week Days 4-6: Intelligence, Testing, Compliance Pages ────────────
const LlmJudgeConsole       = lazy(() => import('./pages/llm-judge-console'));
const DocumentForensics     = lazy(() => import('./pages/document-forensics'));
const CostOptimizer         = lazy(() => import('./pages/cost-optimizer'));
const LegalNerExplorer      = lazy(() => import('./pages/legal-ner-explorer'));
const EuAiCompliance        = lazy(() => import('./pages/eu-ai-compliance'));
// task-345: dedicated US state-privacy + federal-compliance Console page.
const UsStatePrivacy        = lazy(() => import('./pages/us-state-privacy'));
// task-357: dedicated BIPA §15(b) written-consent + revocation page.
const BipaConsent           = lazy(() => import('./pages/bipa-consent'));
const AgentScorecard        = lazy(() => import('./pages/agent-scorecard'));

import { JrxConsoleSidebar } from './components/JrxConsoleSidebar';
import { JrxTopBar } from './components/JrxTopBar';
import { JrxBreadcrumbs } from './components/JrxBreadcrumbs';

// Sidebar-aware layout — hides sidebar/topbar on login/landing to avoid flash
function WithSidebar({ user, children }: { user: unknown; children: React.ReactNode }) {
  const [location] = useLocation();
  const noChrome = !user || location === '/' || location === '/login';
  if (noChrome) return <>{children}</>;
  return (
    <div className="flex" style={{ minHeight: '100vh' }}>
      <JrxConsoleSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <JrxTopBar />
        <JrxBreadcrumbs />
        <div className="flex-1 overflow-y-auto jrx-light-scope bg-[#F8FAFC]">{children}</div>
      </div>
    </div>
  );
}

const RedirectTo = ({ to }: { to: string }) => {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to);
  }, [to, setLocation]);
  return null;
};

const RedirectExternal = ({ to }: { to: string }) => {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.location.href = to;
    }
  }, [to]);
  return null;
};

// Role-specific home redirect — sends each role to their most relevant landing page
function RoleHome({ user }: { user: User | null }) {
  const dest = user ? roleHomeRelative(user.role) : '/login';
  return <RedirectTo to={dest} />;
}

const ErrorFallback = ({ error, context, resetError }: { error: Error; context: string; resetError: () => void }) => (
  <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, rgba(10,42,102,0.05), rgba(10,42,102,0.1))' }}>
    <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
      <div className="text-6xl mb-4" style={{ color: '#C7B15B' }}>⚠️</div>
      <h1 className="text-2xl font-bold mb-4" style={{ color: '#152448' }}>Critical Error</h1>
      <p className="mb-4" style={{ color: '#666' }}>Context: {context}</p>
      <p className="text-sm mb-6" style={{ color: '#999' }}>{error.message}</p>
      <button 
        onClick={resetError}
        className="text-white px-6 py-2 rounded-lg transition-opacity hover:opacity-90"
        style={{ background: '#152448' }}
      >
        Reload Application
      </button>
    </div>
  </div>
);

interface User {
  id: string | number;
  name: string;
  email: string;
  avatar?: string;
  role: string;
  subscriptionTier: string;
  subscriptionStatus: string;
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState(null, '', '/console/');
    }
  }, []);

  useEffect(() => {
    document.title = 'Jurexio Legal SDK - India\'s Sovereign Legal AI OS';

    const checkAuthentication = async () => {
      try {
        const storedToken = localStorage.getItem('token');
        const storedUser = getStoredUserRaw();
        
        if (storedToken && storedUser) {
          try {
            const userData = JSON.parse(storedUser);
            setUser({
              id: userData.id,
              name: userData.name || userData.email,
              email: userData.email,
              avatar: userData.avatar,
              role: userData.role,
              subscriptionTier: userData.subscriptionTier || userData.subscriptionPlan || 'alpha',
              subscriptionStatus: userData.subscriptionStatus || 'active'
            });

            let response = await fetch('/api/auth/me', {
              headers: { Authorization: `Bearer ${storedToken}` },
              credentials: 'include',
            });
            if (response.status === 404) {
              response = await fetch('/api/jrx/auth/me', {
                headers: { Authorization: `Bearer ${storedToken}` },
                credentials: 'include',
              });
            }

            if (response.ok) {
              const serverData = await response.json();
              if (serverData.user) {
                const canonicalUser = {
                  id: serverData.user.id,
                  name: serverData.user.name || serverData.user.email,
                  email: serverData.user.email,
                  avatar: serverData.user.avatar || serverData.user.avatarUrl,
                  role: serverData.user.role,
                  subscriptionTier: serverData.user.subscriptionTier || serverData.user.subscriptionPlan || 'alpha',
                  subscriptionStatus: serverData.user.subscriptionStatus || 'active'
                };
                setAuthSession(storedToken, canonicalUser);
                setUser(canonicalUser);
              }
            } else if (response.status === 401 || response.status === 403) {
              console.warn('Token validation failed - logging out');
              clearAuthSession();
              setUser(null);
            }
          } catch (parseError) {
            console.error('Failed to parse stored user:', parseError);
            clearAuthSession();
            setUser(null);
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAuthentication();
  }, []);

  const handleLoginSuccess = (userData: User) => {
    setUser(userData);
    setError(null);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }
    clearAuthSession();
    setUser(null);
    window.location.href = '/';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-royal-blue-50 to-gold-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-royal-blue-600 mx-auto mb-4"></div>
          <p className="text-royal-blue-400">Loading Jurexio Legal SDK...</p>
        </div>
      </div>
    );
  }

  // Task #156 — Hard isolation: an authenticated SME may only operate
  // the /sme shell. If they ever land on /console, redirect them out.
  if (user && String(user.role).toLowerCase() === 'sme'
      && typeof window !== 'undefined'
      && !window.location.pathname.startsWith('/sme')) {
    window.location.href = '/sme';
    return null;
  }

  if (error && error.includes('critical')) {
    return <ErrorFallback error={new Error(error)} context="App Initialization" resetError={() => window.location.reload()} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
      <AuthProvider user={user} login={handleLoginSuccess} logout={handleLogout}>
        <OrgProvider>
        <ErrorBoundaryWithRetry>
          <JrxSkipLink />
          <div className="min-h-screen bg-background" id="main-content" role="main" aria-label="Jurexio Legal AI Platform">
            <Router base="/console">
              <WithSidebar user={user}>
              <Suspense fallback={<LoadingSpinner />}>
              <Switch>
                {/* ══════════════════════════════════════════════
                    SECTION 1 — NYAYAVIGYA AI COMMAND CENTRE
                    Canonical: /command-centre
                ══════════════════════════════════════════════ */}
                {/* task-158 — new landing dashboard (KPI cards + live widgets) */}
                <Route path="/dashboard">{() => <ProtectedRoute minRole="user"><ConsoleDashboard /></ProtectedRoute>}</Route>
                {/* task-344 (2026-05-13): /command-centre, /admin, /admin-console all collapse to /dashboard. */}
                <Route path="/command-centre">{() => <RedirectTo to="/dashboard" />}</Route>
                <Route path="/admin">{() => <RedirectTo to="/dashboard" />}</Route>
                <Route path="/admin-console">{() => <RedirectTo to="/dashboard" />}</Route>
                <Route path="/roma-l5-admin">{() => <ProtectedRoute minRole="user"><RomaL5AdminDashboard /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 2 — ORG & TEAM ADMINISTRATION
                    Canonical: /org-admin
                ══════════════════════════════════════════════ */}
                <Route path="/org-admin">{() => <ProtectedRoute minRole="org_admin" requiresOrg><OrgAdminDashboard /></ProtectedRoute>}</Route>
                {/* task: alias dedupe — /org-admin-dashboard was a duplicate-component route; canonical is /org-admin. Redirect preserves deep links/bookmarks. */}
                <Route path="/org-admin-dashboard">{() => <RedirectTo to="/org-admin" />}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 3 — AI AGENT OPERATIONS
                    Canonical: /orchestration, /agents, /agent-registry, /model-catalog
                ══════════════════════════════════════════════ */}
                {/* Consolidated Orchestration Hub (2026-05-09) — canonical /orchestration */}
                <Route path="/orchestration">{() => <ProtectedRoute minRole="operator"><OrchestrationHubConsolidated /></ProtectedRoute>}</Route>
                {/* /orchestration/legacy: deleted 2026-05-13 (task-259) — was a duplicate mount of AgentOrchestration on top of an orphan simulated `pages/orchestration.tsx` (hardcoded sample agents, fake setInterval chatter). Overview tab of /orchestration already renders AgentOrchestration with real /api/jrx/agents data. */}
                <Route path="/orchestration/legacy">{() => <RedirectTo to="/orchestration?tab=overview" />}</Route>
                <Route path="/legal-chat">{() => <RedirectTo to="/chat?tab=legal" />}</Route>
                <Route path="/orchestration/a2a">{() => <ProtectedRoute minRole="operator"><A2ACollaborationDashboard /></ProtectedRoute>}</Route>
                <Route path="/orchestration/bmad">{() => <ProtectedRoute minRole="operator"><BMADWorkflowVisualizer /></ProtectedRoute>}</Route>
                <Route path="/orchestration/cam">{() => <ProtectedRoute minRole="analyst"><CAMDashboardPage /></ProtectedRoute>}</Route>
                <Route path="/orchestration/router-decisions">{() => <ProtectedRoute minRole="analyst"><RouterDecisionsPage /></ProtectedRoute>}</Route>
                <Route path="/orchestration/lineage/:requestId">{() => <ProtectedRoute minRole="analyst"><LineagePage /></ProtectedRoute>}</Route>
                <Route path="/orchestration/memory">{() => <ProtectedRoute minRole="analyst"><MemoryBrowserCAM /></ProtectedRoute>}</Route>
                <Route path="/orchestration/grpo">{() => <ProtectedRoute minRole="senior_analyst"><GRPOTrainingDashboard /></ProtectedRoute>}</Route>
                <Route path="/orchestration/policies">{() => <ProtectedRoute minRole="manager"><PolicyManagementConsole /></ProtectedRoute>}</Route>
                {/* task-298 (Demo G1B) — canonical Console URLs:
                      /console/policy-management
                      /console/policy-enforcement-monitoring
                      /console/dpdpa-compliance
                    Wouter mounts every <Route> below under <Router base="/console">,
                    so the relative `path="/policy-management"` resolves to the
                    external URL `/console/policy-management`. Do not duplicate
                    these routes outside the base — that breaks the Switch. */}
                <Route path="/policy-management">{() => <ProtectedRoute minRole="manager"><PolicyManagementConsole /></ProtectedRoute>}</Route>
                <Route path="/policy-enforcement-monitoring">{() => <ProtectedRoute minRole="analyst"><EnforcementMonitoring /></ProtectedRoute>}</Route>
                {/* task-344 (2026-05-13): /agents and /superagent collapse into the canonical /agent-registry surface. */}
                <Route path="/agents">{() => <RedirectTo to="/agent-registry" />}</Route>
                <Route path="/agent-registry">{() => <ProtectedRoute minRole="operator"><AgentRegistry /></ProtectedRoute>}</Route>
                <Route path="/model-catalog">{() => <ProtectedRoute minRole="analyst"><ModelCatalog /></ProtectedRoute>}</Route>
                <Route path="/superagent">{() => <RedirectTo to="/agent-registry" />}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 4 — MONITORING & OBSERVABILITY
                    Canonical: /live-activity-feed, /orchestration-dashboard,
                               /agent-activity, /digital-twin
                    Note: /realtime-dashboard removed 2026-05-06 (Phase A T001) —
                    successor is /live-activity-feed (Phase C scaffold).
                ══════════════════════════════════════════════ */}
                <Route path="/orchestration-dashboard">{() => <RedirectTo to="/orchestration?tab=live" />}</Route>
                {/* Operations Hub (2026-05-09) — consolidated operational dashboards */}
                <Route path="/operations">{() => <ProtectedRoute minRole="analyst"><OperationsHub /></ProtectedRoute>}</Route>
                <Route path="/agent-activity">{() => <ProtectedRoute minRole="analyst"><AgentActivityDashboard /></ProtectedRoute>}</Route>
                {/* role aligned with /digital-twin-creator (same underlying page) — was super_admin */}
                <Route path="/digital-twin">{() => <ProtectedRoute minRole="analyst"><DigitalTwinDashboard /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 5 — GOVERNANCE & COMPLIANCE
                    Canonical: /decision-cards, /architect
                ══════════════════════════════════════════════ */}
                <Route path="/decision-cards">{() => <ProtectedRoute minRole="operator"><HITLDecisionCards /></ProtectedRoute>}</Route>
                <Route path="/hitl-decision-cards">{() => <ProtectedRoute minRole="operator"><HITLDecisionCards /></ProtectedRoute>}</Route>
                <Route path="/architect">{() => <ProtectedRoute minRole="manager"><ArchitectWorkflowBuilder /></ProtectedRoute>}</Route>
                {/* Session-10 Batch D (2026-05-10) — governance surface for /api/nv5/gov/* */}
                <Route path="/superadmin/governance">{() => <ProtectedRoute minRole="super_admin"><SuperAdminGovernance /></ProtectedRoute>}</Route>
                <Route path="/governance-surface">{() => <ProtectedRoute minRole="super_admin"><SuperAdminGovernance /></ProtectedRoute>}</Route>
                <Route path="/superadmin/federated-tenants">{() => <ProtectedRoute minRole="super_admin"><SuperAdminFederatedTenants /></ProtectedRoute>}</Route>
                <Route path="/superadmin/provider-failover">{() => <ProtectedRoute minRole="super_admin"><SuperAdminProviderFailover /></ProtectedRoute>}</Route>

                {/* Task #109 (2026-05-11) — Platform-v5 admin family for the 9 /api/nv5/* namespaces. */}
                <Route path="/platform-v5">{() => <ProtectedRoute minRole="super_admin"><PlatformV5Hub /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/orch">{() => <ProtectedRoute minRole="super_admin"><PlatformV5Orch /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/multimodal">{() => <ProtectedRoute minRole="super_admin"><PlatformV5Multimodal /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/voice">{() => <ProtectedRoute minRole="super_admin"><PlatformV5Voice /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/workflows">{() => <ProtectedRoute minRole="super_admin"><PlatformV5Workflows /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/doc-ai">{() => <ProtectedRoute minRole="super_admin"><PlatformV5DocAi /></ProtectedRoute>}</Route>
                <Route path="/bulk-doc-upload">{() => <ProtectedRoute minRole="user"><BulkDocUpload /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/legal-pipeline">{() => <ProtectedRoute minRole="super_admin"><PlatformV5LegalPipeline /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/compliance">{() => <ProtectedRoute minRole="super_admin"><PlatformV5Compliance /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/internal">{() => <ProtectedRoute minRole="super_admin"><PlatformV5Internal /></ProtectedRoute>}</Route>
                <Route path="/platform-v5/gov">{() => <ProtectedRoute minRole="super_admin"><PlatformV5Gov /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 6 — SDK DEVELOPER TOOLS
                    Canonical: /sdk-console, /sdk-playground, /sdk-downloads,
                               /agent-testing, /sdlc, /multimodal
                ══════════════════════════════════════════════ */}
                {/* Consolidated 2026-05-09: legacy SDK paths redirect to /sdk-hub tabs (RBAC enforced inside the hub). */}
                <Route path="/sdk-console">{() => <RedirectTo to="/sdk-hub?tab=developer" />}</Route>
                <Route path="/sdk-playground">{() => <RedirectTo to="/sdk-hub?tab=playground" />}</Route>
                {/* ─── Phase C scaffolds (added 2026-05-06) — backed by /api/jrx/phase-c/* (501 stubs) ─── */}
                <Route path="/platform-health-map">{() => <ProtectedRoute minRole="operator"><PlatformHealthMap /></ProtectedRoute>}</Route>
                <Route path="/live-activity-feed">{() => <ProtectedRoute minRole="user"><LiveActivityFeed /></ProtectedRoute>}</Route>
                <Route path="/my-approvals">{() => <ProtectedRoute minRole="operator"><MyApprovals /></ProtectedRoute>}</Route>
                <Route path="/document-ai-hub">{() => <ProtectedRoute minRole="user"><DocumentAiHub /></ProtectedRoute>}</Route>
                <Route path="/legal-drafting">{() => <ProtectedRoute minRole="user"><LegalDrafting /></ProtectedRoute>}</Route>
                <Route path="/document-redline">{() => <ProtectedRoute minRole="user"><DocumentRedline /></ProtectedRoute>}</Route>
                <Route path="/ocr-extraction">{() => <ProtectedRoute minRole="user"><OcrExtraction /></ProtectedRoute>}</Route>
                <Route path="/autofill-qa">{() => <ProtectedRoute minRole="user"><AutofillQaReview /></ProtectedRoute>}</Route>
                <Route path="/summarization">{() => <ProtectedRoute minRole="user"><Summarization /></ProtectedRoute>}</Route>
                <Route path="/prompt-library">{() => <ProtectedRoute minRole="operator"><PromptLibrary /></ProtectedRoute>}</Route>
                <Route path="/rag-knowledge-base">{() => <ProtectedRoute minRole="operator"><RagKnowledgeBase /></ProtectedRoute>}</Route>
                <Route path="/nys-knowledge-plane">{() => <ProtectedRoute minRole="operator"><NysKnowledgePlane /></ProtectedRoute>}</Route>
                <Route path="/instant-search">{() => <ProtectedRoute minRole="user"><InstantSearchPage /></ProtectedRoute>}</Route>
                <Route path="/legal-intelligence-feed">{() => <ProtectedRoute minRole="operator"><LegalIntelligenceFeedPage /></ProtectedRoute>}</Route>
                <Route path="/matter-vault">{() => <ProtectedRoute minRole="operator"><MatterVault /></ProtectedRoute>}</Route>
                <Route path="/tools-mcp">{() => <ProtectedRoute minRole="developer"><ToolsMcp /></ProtectedRoute>}</Route>
                <Route path="/mcp-connectors">{() => <ProtectedRoute minRole="developer"><McpConnectors /></ProtectedRoute>}</Route>
                <Route path="/statutes-citations">{() => <ProtectedRoute minRole="user"><StatutesCitations /></ProtectedRoute>}</Route>
                <Route path="/jurisdiction-mapping">{() => <ProtectedRoute minRole="analyst"><JurisdictionMapping /></ProtectedRoute>}</Route>
                <Route path="/web-scraping-targets">{() => <ProtectedRoute minRole="operator"><WebScrapingTargets /></ProtectedRoute>}</Route>
                <Route path="/dpdpa-compliance">{() => <ProtectedRoute minRole="analyst"><DpdpaCompliance /></ProtectedRoute>}</Route>
                <Route path="/us-state-privacy">{() => <ProtectedRoute minRole="analyst"><UsStatePrivacy /></ProtectedRoute>}</Route>
                <Route path="/bipa-consent">{() => <ProtectedRoute minRole="user"><BipaConsent /></ProtectedRoute>}</Route>
                <Route path="/smoke-harness-console">{() => <RedirectTo to="/dashboard" />}</Route>
                <Route path="/database-schema">{() => <ProtectedRoute minRole="developer"><DatabaseSchema /></ProtectedRoute>}</Route>
                <Route path="/sdk-downloads">{() => <RedirectTo to="/sdk-hub?tab=downloads" />}</Route>
                <Route path="/agent-testing">{() => <ProtectedRoute minRole="developer"><AgentTestingEnvironment /></ProtectedRoute>}</Route>
                <Route path="/sdlc">{() => <RedirectTo to="/dashboard" />}</Route>
                <Route path="/multimodal">{() => <ProtectedRoute minRole="developer"><MultimodalStudio /></ProtectedRoute>}</Route>
                {/* task-344 (2026-05-13): /feature-test collapses into the SDK Hub testing tab. */}
                <Route path="/feature-test">{() => <RedirectTo to="/sdk-hub?tab=testing" />}</Route>
                <Route path="/test/p1-quality">{() => <ProtectedRoute minRole="senior_analyst"><P1AIQualityTest /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 6b — CUSTOMER AGENTIC PRODUCTS
                    ClaWdBot, OpenBot, AutomateAI, TwinDesk, SkillShop, SDK Playground
                ══════════════════════════════════════════════ */}
                <Route path="/clawdbot">{() => <ProtectedRoute minRole="operator"><ClaWdBotConsole /></ProtectedRoute>}</Route>
                <Route path="/clawdbot-console">{() => <ProtectedRoute minRole="operator"><ClaWdBotConsole /></ProtectedRoute>}</Route>
                <Route path="/openbot">{() => <ProtectedRoute minRole="operator"><OpenBotStudio /></ProtectedRoute>}</Route>
                <Route path="/openbot-studio">{() => <ProtectedRoute minRole="operator"><OpenBotStudio /></ProtectedRoute>}</Route>
                <Route path="/automateai">{() => <ProtectedRoute minRole="operator"><AutomateAIBuilder /></ProtectedRoute>}</Route>
                <Route path="/automateai-builder">{() => <ProtectedRoute minRole="operator"><AutomateAIBuilder /></ProtectedRoute>}</Route>
                <Route path="/twindesk">{() => <ProtectedRoute minRole="analyst"><DigitalTwinCreator /></ProtectedRoute>}</Route>
                <Route path="/digital-twin-creator">{() => <ProtectedRoute minRole="analyst"><DigitalTwinCreator /></ProtectedRoute>}</Route>
                <Route path="/skillshop">{() => <ProtectedRoute minRole="user"><SkillsMarketplace /></ProtectedRoute>}</Route>
                <Route path="/skills-marketplace">{() => <ProtectedRoute minRole="user"><SkillsMarketplace /></ProtectedRoute>}</Route>
                <Route path="/client-sdk-playground">{() => <RedirectTo to="/sdk-hub?tab=client" />}</Route>
                <Route path="/sdk-playground-v2">{() => <RedirectTo to="/sdk-hub?tab=client" />}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 7 — AI CHAT & WORKSPACE
                    Canonical: /chat, /global-chat, /workspace
                ══════════════════════════════════════════════ */}
                {/* Consolidated Chat Hub (2026-05-09) — canonical /chat */}
                <Route path="/chat">{() => <ProtectedRoute minRole="user"><ChatHub /></ProtectedRoute>}</Route>
                <Route path="/legalchat">{() => <RedirectExternal to="/legalchat/chat" />}</Route>
                <Route path="/legalchat/chat">{() => <RedirectExternal to="/legalchat/chat" />}</Route>
                {/* task-249: explicit alias so /universal-chat is a stable, greppable canonical entry */}
                <Route path="/universal-chat">{() => <RedirectTo to="/chat?tab=universal" />}</Route>
                <Route path="/global-chat">{() => <RedirectTo to="/chat?tab=agents" />}</Route>
                <Route path="/workspace/:id">{() => <ProtectedRoute minRole="operator"><AgentWorkspace /></ProtectedRoute>}</Route>
                <Route path="/workspace">{() => <ProtectedRoute minRole="operator"><AgentWorkspace /></ProtectedRoute>}</Route>
                {/* /content-studio removed 2026-05-11 (Phase 3 audit): out of v5.0.1 scope */}

                {/* ══════════════════════════════════════════════
                    SECTION 8 — PRODUCT PLATFORMS
                    Each platform has ONE canonical route
                ══════════════════════════════════════════════ */}
                <Route path="/identity-extraction">{() => <ProtectedRoute minRole="user"><IdentityExtraction /></ProtectedRoute>}</Route>
                {/* role aligned with /automateai (same underlying page) — was user */}
                <Route path="/automation">{() => <ProtectedRoute minRole="operator"><AutomationDashboard /></ProtectedRoute>}</Route>
                <Route path="/institutional">{() => <ProtectedRoute minRole="manager" requiresOrg><JurexioInstitutional /></ProtectedRoute>}</Route>
                <Route path="/governance">{() => <ProtectedRoute minRole="analyst"><JurexioGovernance /></ProtectedRoute>}</Route>
                <Route path="/ministry">{() => <ProtectedRoute minRole="analyst"><JurexioGovernance /></ProtectedRoute>}</Route>
                <Route path="/enforcement">{() => <ProtectedRoute minRole="analyst"><EnforcementMonitoring /></ProtectedRoute>}</Route>
                <Route path="/academy">{() => <RedirectTo to="/dashboard" />}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 8b — ONBOARDING
                ══════════════════════════════════════════════ */}
                <Route path="/onboarding">{() => <OnboardingWizard />}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 9 — NEW SERVICES
                    LRM Router, Regulatory,
                    RBAC, Skills, LLM Priority, White-Label,
                    Adversarial, Drift, Hash Chain
                ══════════════════════════════════════════════ */}
                <Route path="/lrm-dashboard">{() => <ProtectedRoute minRole="analyst"><LRMRouterDashboard /></ProtectedRoute>}</Route>

                <Route path="/regulatory">{() => <ProtectedRoute minRole="analyst"><RegulatoryMonitor /></ProtectedRoute>}</Route>
                {/* task-350: alias matches the deep-link contract used by /console/us-state-privacy framework cards */}
                <Route path="/regulatory-monitor">{() => <ProtectedRoute minRole="analyst"><RegulatoryMonitor /></ProtectedRoute>}</Route>



                <Route path="/rbac-console">{() => <ProtectedRoute minRole="manager"><RBACConsole /></ProtectedRoute>}</Route>

                <Route path="/billing/subscription">{() => <ProtectedRoute minRole="user"><SubscriptionManagement /></ProtectedRoute>}</Route>
                <Route path="/billing/credits">{() => <ProtectedRoute minRole="user"><CreditWallet /></ProtectedRoute>}</Route>
                <Route path="/billing/ledger">{() => <ProtectedRoute minRole="user"><BillingLedger /></ProtectedRoute>}</Route>

                <Route path="/skills">{() => <ProtectedRoute minRole="developer"><SkillsLibrary /></ProtectedRoute>}</Route>

                <Route path="/llm-priority">{() => <ProtectedRoute minRole="analyst"><LLMPriorityDashboard /></ProtectedRoute>}</Route>

                {/* task-344 (2026-05-13): /white-label and /admin/white-label both collapse into the Org Admin branding tab. */}
                <Route path="/white-label">{() => <RedirectTo to="/org-admin?tab=branding" />}</Route>
                <Route path="/admin/white-label">{() => <RedirectTo to="/org-admin?tab=branding" />}</Route>
                <Route path="/admin/llm-budget">{() => <ProtectedRoute minRole="org_admin" requiresOrg><OrgLlmBudgetAdmin /></ProtectedRoute>}</Route>

                <Route path="/adversarial">{() => <ProtectedRoute minRole="developer"><AdversarialTesting /></ProtectedRoute>}</Route>
                <Route path="/adversarial-testing">{() => <ProtectedRoute minRole="developer"><AdversarialTesting /></ProtectedRoute>}</Route>

                <Route path="/drift-monitor">{() => <ProtectedRoute minRole="analyst"><ModelDriftMonitor /></ProtectedRoute>}</Route>
                <Route path="/model-drift">{() => <ProtectedRoute minRole="analyst"><ModelDriftMonitor /></ProtectedRoute>}</Route>

                {/* task-344 (2026-05-13): /hash-chain (and the legacy /hash-chain-audit alias) collapse into the Audit Chain page's hash-chain tab. */}
                <Route path="/hash-chain">{() => <RedirectTo to="/audit-chain?tab=hash-chain" />}</Route>
                <Route path="/hash-chain-audit">{() => <RedirectTo to="/audit-chain?tab=hash-chain" />}</Route>

                <Route path="/agent-flows">{() => <RedirectTo to="/orchestration?tab=live" />}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 11 — SUPER ADMIN
                    Canonical: /superadmin/*
                ══════════════════════════════════════════════ */}
                <Route path="/superadmin/platforms">{() => <ProtectedRoute minRole="super_admin"><SuperAdminPlatformRegistry /></ProtectedRoute>}</Route>
                <Route path="/superadmin/feature-flags">{() => <ProtectedRoute minRole="super_admin"><SuperAdminFeatureFlags /></ProtectedRoute>}</Route>
                <Route path="/superadmin/organisations">{() => <ProtectedRoute minRole="super_admin"><SuperAdminOrganisations /></ProtectedRoute>}</Route>
                <Route path="/superadmin/super-orgs">{() => <ProtectedRoute minRole="super_admin"><SuperAdminSuperOrgs /></ProtectedRoute>}</Route>
                <Route path="/superadmin/llm-budget">{() => <ProtectedRoute minRole="super_admin"><SuperAdminLlmBudget /></ProtectedRoute>}</Route>
                <Route path="/superadmin/provider-secrets">{() => <ProtectedRoute minRole="super_admin"><ProviderSecretsSettings /></ProtectedRoute>}</Route>
                <Route path="/settings/provider-secrets">{() => <ProtectedRoute minRole="super_admin"><ProviderSecretsSettings /></ProtectedRoute>}</Route>
                <Route path="/superadmin/compliance">{() => <ProtectedRoute minRole="super_admin"><SuperAdminCompliance /></ProtectedRoute>}</Route>
                <Route path="/superadmin/agents">{() => <ProtectedRoute minRole="super_admin"><SuperAdminAgentMatrix /></ProtectedRoute>}</Route>
                <Route path="/superadmin/overview">{() => <RedirectTo to="/operations?tab=overview" />}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 12 — INTELLIGENCE HUB (E1–E10)
                    Canonical: /intelligence/*
                ══════════════════════════════════════════════ */}
                {/* Intelligence Hub (2026-05-09) — consolidated tabbed surface; legacy /intelligence/* still served below */}
                <Route path="/intelligence">{() => <ProtectedRoute minRole="manager"><IntelligenceHubConsolidated /></ProtectedRoute>}</Route>
                <Route path="/intelligence/dashboard">{() => <ProtectedRoute minRole="manager"><IntelligenceDashboard /></ProtectedRoute>}</Route>
                <Route path="/intelligence/predict">{() => <ProtectedRoute minRole="manager"><IntelligencePredict /></ProtectedRoute>}</Route>
                <Route path="/intelligence/research">{() => <ProtectedRoute minRole="manager"><IntelligenceResearch /></ProtectedRoute>}</Route>
                <Route path="/intelligence/classify">{() => <ProtectedRoute minRole="manager"><IntelligenceClassify /></ProtectedRoute>}</Route>
                <Route path="/intelligence/sentiment">{() => <ProtectedRoute minRole="manager"><IntelligenceSentiment /></ProtectedRoute>}</Route>
                <Route path="/intelligence/translate">{() => <ProtectedRoute minRole="manager"><IntelligenceTranslate /></ProtectedRoute>}</Route>
                <Route path="/intelligence/guardrails">{() => <ProtectedRoute minRole="super_admin"><GuardrailDashboard /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 12B — SPRINT WEEK: INTELLIGENCE + TESTING + COMPLIANCE
                ══════════════════════════════════════════════ */}
                <Route path="/llm-judge">{() => <ProtectedRoute minRole="org_admin"><LlmJudgeConsole /></ProtectedRoute>}</Route>
                <Route path="/testing/llm-judge">{() => <ProtectedRoute minRole="org_admin"><LlmJudgeConsole /></ProtectedRoute>}</Route>
                <Route path="/document-forensics">{() => <ProtectedRoute minRole="user"><DocumentForensics /></ProtectedRoute>}</Route>
                <Route path="/forensics">{() => <ProtectedRoute minRole="user"><DocumentForensics /></ProtectedRoute>}</Route>
                <Route path="/cost-optimizer">{() => <ProtectedRoute minRole="analyst"><CostOptimizer /></ProtectedRoute>}</Route>
                <Route path="/federated-tenants">{() => <ProtectedRoute minRole="org_admin"><FederatedTenants /></ProtectedRoute>}</Route>
                {/* task-344 (2026-05-13): /realtime-activity collapses into the canonical /live-activity-feed. */}
                <Route path="/realtime-activity">{() => <RedirectTo to="/live-activity-feed" />}</Route>
                <Route path="/provider-failover">{() => <ProtectedRoute minRole="operator"><ProviderFailover /></ProtectedRoute>}</Route>
                <Route path="/audit-chain">{() => <ProtectedRoute minRole="org_admin"><AuditChain /></ProtectedRoute>}</Route>
                <Route path="/cost-optimization">{() => <ProtectedRoute minRole="analyst"><CostOptimizer /></ProtectedRoute>}</Route>
                <Route path="/legal-ner">{() => <ProtectedRoute minRole="user"><LegalNerExplorer /></ProtectedRoute>}</Route>
                <Route path="/ner-explorer">{() => <ProtectedRoute minRole="user"><LegalNerExplorer /></ProtectedRoute>}</Route>
                <Route path="/eu-ai-compliance">{() => <ProtectedRoute minRole="analyst"><EuAiCompliance /></ProtectedRoute>}</Route>
                <Route path="/eu-ai-compliance/control/:id">{(params) => <ProtectedRoute minRole="analyst"><EuAiCompliance initialControlId={params.id} /></ProtectedRoute>}</Route>
                <Route path="/compliance/eu-ai-act">{() => <ProtectedRoute minRole="analyst"><EuAiCompliance /></ProtectedRoute>}</Route>
                <Route path="/agent-scorecard">{() => <ProtectedRoute minRole="org_admin"><AgentScorecard /></ProtectedRoute>}</Route>
                <Route path="/testing/scorecard">{() => <ProtectedRoute minRole="org_admin"><AgentScorecard /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 14 — USER PROFILE + ORG SETTINGS
                    2FA, sessions, org per-platform config
                ══════════════════════════════════════════════ */}
                <Route path="/user/profile">{() => <ProtectedRoute minRole="user"><UserProfile /></ProtectedRoute>}</Route>
                <Route path="/user-profile">{() => <ProtectedRoute minRole="user"><UserProfile /></ProtectedRoute>}</Route>
                {/* task-344 (2026-05-13): /org-platform-settings collapses into the Org Admin platform tab. */}
                <Route path="/org/platform-settings">{() => <RedirectTo to="/org-admin?tab=platform" />}</Route>
                <Route path="/org-platform-settings">{() => <RedirectTo to="/org-admin?tab=platform" />}</Route>
                {/* Phase 5 (Session-15 v13, 2026-05-11) — per-org console layout overlay editor */}
                <Route path="/admin/org-console-layout">{() => <ProtectedRoute minRole="org_admin" requiresOrg><OrgConsoleLayoutPage /></ProtectedRoute>}</Route>
                <Route path="/org/console-layout">{() => <ProtectedRoute minRole="org_admin" requiresOrg><OrgConsoleLayoutPage /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 13 — SDK CONSOLE EXTENDED
                    Key management, onboarding wizard, API tester
                ══════════════════════════════════════════════ */}
                <Route path="/sdk/onboarding">{() => <RedirectTo to="/sdk-hub?tab=onboarding" />}</Route>
                <Route path="/sdk/api-tester">{() => <RedirectTo to="/sdk-hub?tab=tester" />}</Route>
                <Route path="/sdk-key-management">{() => <RedirectTo to="/sdk-hub?tab=keys" />}</Route>
                <Route path="/sdk-onboarding">{() => <RedirectTo to="/sdk-hub?tab=onboarding" />}</Route>
                {/* task-354 (2026-05-13) — Customer Orgs (partner-platform view).
                    minRole comes from CUSTOMER_ORGS_MIN_ROLE so route gating, sidebar
                    gating, and the server-side classifyLayer() never drift apart. */}
                <Route path="/customer-orgs">{() => <ProtectedRoute minRole={CUSTOMER_ORGS_MIN_ROLE}><CustomerOrgsPage /></ProtectedRoute>}</Route>
                <Route path="/customer-orgs/:id">{() => <ProtectedRoute minRole={CUSTOMER_ORGS_MIN_ROLE}><CustomerOrgDetailPage /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    SECTION 10 — NYAYASIDDHI ENTERPRISE SDK HUB
                    Canonical: /sdk-hub (global enterprise console)
                    Aliases: /, /dashboard, /home
                ══════════════════════════════════════════════ */}
                {/* Consolidated SDK Hub (2026-05-09) — canonical /sdk-hub with sub-tabs */}
                <Route path="/sdk-hub">{() => <ProtectedRoute minRole="user"><SDKHubConsolidated /></ProtectedRoute>}</Route>
                <Route path="/sdk-hub/legacy">{() => <ProtectedRoute minRole="user"><JurexioSDKHub /></ProtectedRoute>}</Route>
                {/* NV-CONSOLE-WIRE-001: the legacy `/home` → SDK-hub alias was shadowing
                    the role-based landing below (Wouter first-match). `/home` now falls
                    through to RoleHome so post-login lands users on their role home. */}
                {/* task-158 — legacy `/dashboard` alias removed; canonical /dashboard is the new ConsoleDashboard at line 390 */}
                <Route path="/p1-ai-quality">{() => <ProtectedRoute minRole="analyst"><P1AIQualityTest /></ProtectedRoute>}</Route>
                <Route path="/sdk-testing">{() => <RedirectTo to="/sdk-hub?tab=testing" />}</Route>
                <Route path="/api-testing">{() => <RedirectTo to="/sdk-hub?tab=testing" />}</Route>
                <Route path="/agent-wizard">{() => <ProtectedRoute minRole="developer"><AgentCreationWizard /></ProtectedRoute>}</Route>
                <Route path="/create-agent">{() => <ProtectedRoute minRole="developer"><AgentCreationWizard /></ProtectedRoute>}</Route>
                <Route path="/platform-management">{() => <RedirectTo to="/superadmin/platforms" />}</Route>
                <Route path="/jurexio-citizen">{() => <RedirectTo to="/chat?tab=legal" />}</Route>
                <Route path="/platform-config">{() => <ProtectedRoute minRole="org_admin" requiresOrg><PlatformManagement /></ProtectedRoute>}</Route>
                <Route path="/agent-live-testing">{() => <ProtectedRoute minRole="analyst"><AgentLiveTesting /></ProtectedRoute>}</Route>

                {/* ══════════════════════════════════════════════
                    AUTHENTICATION
                ══════════════════════════════════════════════ */}
                <Route path="/login">
                  {() => user ? <RoleHome user={user} /> : <Login onLoginSuccess={handleLoginSuccess} />}
                </Route>
                <Route path="/home">{() => <RoleHome user={user} />}</Route>

                {/* NV-CONSOLE-WIRE-001: Help & Docs (sidebar footer link) — wire the
                    previously-orphan ComprehensiveDocumentation page; was a dead /help link. */}
                <Route path="/help">{() => <ProtectedRoute minRole="user"><ComprehensiveDocumentation /></ProtectedRoute>}</Route>

                {/* Landing & Fallback */}
                <Route path="/" component={IndexLanding} />
                <Route component={NotFound} />
              </Switch>
              </Suspense>
              </WithSidebar>
          <HelpButton />
        </Router>
        </div>
        <Toaster />
        <AssistantDrawer />
      </ErrorBoundaryWithRetry>
        </OrgProvider>
      </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}