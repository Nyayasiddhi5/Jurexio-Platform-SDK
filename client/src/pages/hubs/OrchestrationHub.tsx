import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { hasAccess, type RoleLevel } from '@/lib/rbac-registry';
import { JrxPageShell } from '@/components/JrxPageShell';
import { OrchestrationOsStatusStrip } from '@/components/orchestration/OrchestrationOsStatusStrip';

const AgentOrchestration = lazy(() => import('../AgentOrchestration'));
// orchestration-dashboard deleted 2026-05-12 (B3) — use live-activity-feed
const OrchestrationDashboard = lazy(() => import('../live-activity-feed'));
const CAMDashboardPage = lazy(() => import('../orchestration/CAMDashboardPage'));
const RouterDecisionsPage = lazy(() => import('../orchestration/RouterDecisionsPage'));
const A2ACollaborationDashboard = lazy(() => import('../orchestration/A2ACollaborationDashboard'));
const BMADWorkflowVisualizer = lazy(() => import('../orchestration/BMADWorkflowVisualizer'));
const MemoryBrowserCAM = lazy(() => import('../orchestration/MemoryBrowserCAM'));
const GRPOTrainingDashboard = lazy(() => import('../orchestration/GRPOTrainingDashboard'));
const PolicyManagementConsole = lazy(() => import('../orchestration/PolicyManagementConsole'));
const EnforcementMonitoring = lazy(() => import('../EnforcementMonitoring'));
const OrchestrationTracePane = lazy(() => import('../orchestration/OrchestrationTracePane'));
const CAMTelemetryPage = lazy(() => import('../orchestration/CAMTelemetryPage'));
const SwarmTopologiesPanel = lazy(() => import('../orchestration/SwarmTopologiesPanel'));
const DigitalTwinCreator = lazy(() => import('../digital-twin-creator'));

type TabSpec = { id: string; label: string; minRole: RoleLevel; component: React.LazyExoticComponent<React.ComponentType<unknown>> };

const ALL_TABS: TabSpec[] = [
  { id: 'overview',  label: 'Overview',          minRole: 'operator',        component: AgentOrchestration },
  { id: 'trace',     label: 'Execution Trace',   minRole: 'analyst',         component: OrchestrationTracePane },
  { id: 'live',      label: 'Live Activity',     minRole: 'analyst',         component: OrchestrationDashboard },
  { id: 'swarm',     label: 'Swarm Topologies',  minRole: 'operator',        component: SwarmTopologiesPanel },
  { id: 'digital-twin', label: 'Digital Twin',   minRole: 'analyst',         component: DigitalTwinCreator },
  { id: 'cam',       label: 'Ops dashboard',     minRole: 'analyst',         component: CAMDashboardPage },
  { id: 'cam-telemetry', label: 'CAM 2.0',       minRole: 'analyst',         component: CAMTelemetryPage },
  { id: 'router',    label: 'Router Decisions',  minRole: 'analyst',         component: RouterDecisionsPage },
  { id: 'a2a',       label: 'A2A Collaboration', minRole: 'operator',        component: A2ACollaborationDashboard },
  { id: 'bmad',      label: 'BMAD Workflow',     minRole: 'operator',        component: BMADWorkflowVisualizer },
  { id: 'memory',    label: 'Memory Browser',    minRole: 'analyst',         component: MemoryBrowserCAM },
  { id: 'grpo',      label: 'GRPO Training',     minRole: 'senior_analyst',  component: GRPOTrainingDashboard },
  { id: 'policies',  label: 'Policies',          minRole: 'manager',         component: PolicyManagementConsole },
  { id: 'enforcement', label: 'Enforcement',     minRole: 'analyst',         component: EnforcementMonitoring },
];

export default function OrchestrationHub() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const role = (user?.role ?? 'user') as RoleLevel;

  const visibleTabs = useMemo(() => ALL_TABS.filter(t => hasAccess(role, t.minRole)), [role]);
  const tabFromUrl = new URLSearchParams(location.split('?')[1] || '').get('tab') ?? '';
  const initialTab = visibleTabs.find(t => t.id === tabFromUrl)?.id ?? visibleTabs[0]?.id ?? 'overview';
  const [tab, setTab] = useState<string>(initialTab);

  useEffect(() => { if (tabFromUrl && visibleTabs.find(t => t.id === tabFromUrl)) setTab(tabFromUrl); }, [tabFromUrl, visibleTabs]);

  const onChange = (next: string) => {
    setTab(next);
    setLocation(`/orchestration?tab=${next}`, { replace: true });
  };

  if (visibleTabs.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">You do not have access to any orchestration tabs. Required minimum: <code>operator</code>.</div>;
  }

  return (
    <JrxPageShell
      title="Orchestration Hub"
      description="Agent orchestration, CAM, router decisions, A2A, BMAD, memory, GRPO training and policy management — all under one roof. Tabs are filtered by your role."
      className="./jrx-light-scope"
      testId="orchestration-hub"
    >
      <OrchestrationOsStatusStrip />
      <Tabs value={tab} onValueChange={onChange}>
        <TabsList className="flex-wrap h-auto">
          {visibleTabs.map(t => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`orch-hub-tab-${t.id}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {visibleTabs.map(t => {
          const Comp = t.component;
          return (
            <TabsContent key={t.id} value={t.id} hidden={tab !== t.id}>
              <Card className={t.id === 'trace' ? 'p-0 overflow-visible border-0 shadow-none' : 'p-0 overflow-hidden'}>
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
