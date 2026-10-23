import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { hasAccess, type RoleLevel } from '@/lib/rbac-registry';
import { JrxPageShell } from '@/components/JrxPageShell';

// orchestration-dashboard deleted 2026-05-12 (B3) — use canonical live-activity-feed
const OrchestrationDashboard = lazy(() => import('../live-activity-feed'));
const OrgAdminDashboard = lazy(() => import('../org-admin-dashboard'));
const LRMRouterDashboard = lazy(() => import('../lrm-router-dashboard'));
const LLMPriorityDashboard = lazy(() => import('../llm-priority-dashboard'));
const GuardrailDashboard = lazy(() => import('../guardrail-dashboard'));
// Task #194 — canonical aggregator tab wired to /api/jrx/operations/overview
const OperationsOverview = lazy(() => import('../operations-overview'));
// Task #302 — Demo G2C: 4 populated tabs sourced from sdk_usage_metering
const ActiveSessions  = lazy(() => import('../operations/ActiveSessions'));
const ProviderHealth  = lazy(() => import('../operations/ProviderHealth'));
const RecentErrors    = lazy(() => import('../operations/RecentErrors'));
const Throughput      = lazy(() => import('../operations/Throughput'));
const TokenMetrics    = lazy(() => import('../../components/admin/TokenMetricsPanel'));

type TabSpec = {
  id: string;
  label: string;
  minRole: RoleLevel;
  requiresOrg?: boolean;
  component: React.LazyExoticComponent<React.ComponentType<unknown>>;
};

const ALL_TABS: TabSpec[] = [
  { id: 'overview',         label: 'Overview',           minRole: 'analyst',     component: OperationsOverview },
  // Task #302 — Demo G2C populated tabs:
  { id: 'active-sessions',  label: 'Active Sessions',    minRole: 'analyst',     component: ActiveSessions },
  { id: 'provider-health',  label: 'LLM Provider Health',minRole: 'analyst',     component: ProviderHealth },
  { id: 'recent-errors',    label: 'Recent Errors',      minRole: 'analyst',     component: RecentErrors },
  { id: 'throughput',       label: 'Throughput',         minRole: 'analyst',     component: Throughput },
  { id: 'live',             label: 'Live Activity',      minRole: 'analyst',     component: OrchestrationDashboard },
  { id: 'org',              label: 'Org Admin',          minRole: 'org_admin', requiresOrg: true, component: OrgAdminDashboard },
  { id: 'router',           label: 'LRM Router',         minRole: 'analyst',     component: LRMRouterDashboard },
  { id: 'priority',         label: 'LLM Priority',       minRole: 'analyst',     component: LLMPriorityDashboard },
  { id: 'guardrails',       label: 'Guardrails',         minRole: 'super_admin', component: GuardrailDashboard },
  { id: 'tokens',           label: 'Token Metrics',      minRole: 'super_admin', component: TokenMetrics },
];

export default function OperationsHub() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const role = (user?.role ?? 'user') as RoleLevel;
  const isSuperAdmin = role === 'super_admin';
  const hasOrg = !!(user as unknown as { organizationId?: string } | null)?.organizationId;

  const visibleTabs = useMemo(
    () => ALL_TABS.filter(t => hasAccess(role, t.minRole) && (!t.requiresOrg || isSuperAdmin || hasOrg)),
    [role, isSuperAdmin, hasOrg],
  );
  const tabFromUrl = new URLSearchParams(location.split('?')[1] || '').get('tab') ?? '';
  const initialTab = visibleTabs.find(t => t.id === tabFromUrl)?.id ?? visibleTabs[0]?.id ?? 'live';
  const [tab, setTab] = useState<string>(initialTab);

  useEffect(() => { if (tabFromUrl && visibleTabs.find(t => t.id === tabFromUrl)) setTab(tabFromUrl); }, [tabFromUrl, visibleTabs]);

  const onChange = (next: string) => {
    setTab(next);
    setLocation(`/operations?tab=${next}`, { replace: true });
  };

  if (visibleTabs.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">You do not have access to any operations tabs. Required minimum: <code>analyst</code>.</div>;
  }

  return (
    <JrxPageShell
      title="Operations"
      description="Live activity, org admin, router, LLM priority, guardrails — operational dashboards. Tabs filtered by role."
      className="./jrx-light-scope"
      testId="operations-hub"
    >
      <Tabs value={tab} onValueChange={onChange}>
        <TabsList className="flex-wrap h-auto">
          {visibleTabs.map(t => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`ops-hub-tab-${t.id}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {visibleTabs.map(t => {
          const Comp = t.component;
          return (
            <TabsContent key={t.id} value={t.id} hidden={tab !== t.id}>
              <Card className="p-0 overflow-hidden">
                <Suspense fallback={<div className="p-6 space-y-3" data-testid={`loading-tab-${t.id}`}><Skeleton className="h-8 w-1/3" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>}>
                  {tab === t.id ? <Comp /> : null}
                </Suspense>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </JrxPageShell>
  );
}
