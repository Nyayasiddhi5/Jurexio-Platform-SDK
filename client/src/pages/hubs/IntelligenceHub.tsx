import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { hasAccess, type RoleLevel } from '@/lib/rbac-registry';
import { JrxPageShell } from '@/components/JrxPageShell';

const IntelligenceDashboard = lazy(() => import('../intelligence-dashboard'));
const IntelligenceClassify = lazy(() => import('../intelligence-classify'));
const IntelligencePredict = lazy(() => import('../intelligence-predict'));
const IntelligenceResearch = lazy(() => import('../intelligence-research'));
const IntelligenceSentiment = lazy(() => import('../intelligence-sentiment'));
const IntelligenceTranslate = lazy(() => import('../intelligence-translate'));
const GuardrailDashboard = lazy(() => import('../guardrail-dashboard'));
const InstantSearchPage = lazy(() => import('../instant-search'));
const LegalIntelligenceFeedPage = lazy(() => import('../legal-intelligence-feed'));
const LlmRouterAdminPanel = lazy(() => import('../../components/admin/LlmRouterAdminPanel'));

type TabSpec = { id: string; label: string; minRole: RoleLevel; component: React.LazyExoticComponent<React.ComponentType<unknown>> };

const ALL_TABS: TabSpec[] = [
  { id: 'overview',   label: 'Overview',   minRole: 'manager',     component: IntelligenceDashboard },
  { id: 'instant',    label: 'Instant Search', minRole: 'manager', component: InstantSearchPage },
  { id: 'legal-feed', label: 'Legal Feed', minRole: 'manager',     component: LegalIntelligenceFeedPage },
  { id: 'classify',   label: 'Classify',   minRole: 'manager',     component: IntelligenceClassify },
  { id: 'predict',    label: 'Predict',    minRole: 'manager',     component: IntelligencePredict },
  { id: 'research',   label: 'Research',   minRole: 'manager',     component: IntelligenceResearch },
  { id: 'sentiment',  label: 'Sentiment',  minRole: 'manager',     component: IntelligenceSentiment },
  { id: 'translate',  label: 'Translate',  minRole: 'manager',     component: IntelligenceTranslate },
  { id: 'guardrails', label: 'Guardrails', minRole: 'super_admin', component: GuardrailDashboard },
  { id: 'llm-router', label: 'LLM Router', minRole: 'super_admin', component: LlmRouterAdminPanel },
];

export default function IntelligenceHub() {
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
    setLocation(`/intelligence?tab=${next}`, { replace: true });
  };

  if (visibleTabs.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">You do not have access to any intelligence tabs. Required minimum: <code>manager</code>.</div>;
  }

  return (
    <JrxPageShell
      title="Intelligence"
      description="Instant Search, Live Legal Feed, classify, predict, research, sentiment, translate and guardrails. SDK 5.0.7+ · NSP/NYM orchestrate uses full Queen depth."
      className="./jrx-light-scope"
      testId="intelligence-hub"
    >
      <Tabs value={tab} onValueChange={onChange}>
        <TabsList className="flex-wrap h-auto">
          {visibleTabs.map(t => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`int-hub-tab-${t.id}`}>
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
