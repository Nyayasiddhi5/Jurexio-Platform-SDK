import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { hasAccess, type RoleLevel } from '@/lib/rbac-registry';
import ErrorBoundary from '@/components/ErrorBoundary';
import { JrxPageShell } from '@/components/JrxPageShell';

const UniversalChat = lazy(() => import('../UniversalChat'));
const GlobalAgentChat = lazy(() => import('../GlobalAgentChat'));
const LegalChat = lazy(() => import('../legal-chat'));

type TabSpec = {
  id: string;
  label: string;
  minRole: RoleLevel;
  component: React.LazyExoticComponent<React.ComponentType<unknown>>;
};

const ALL_TABS: TabSpec[] = [
  { id: 'legal',     label: 'Legal Chat',     minRole: 'user', component: LegalChat },
  // Universal / Agent remain reachable via ?tab= deep-link until migrated off /api/chat/*.
  { id: 'universal', label: 'Universal Chat', minRole: 'user', component: UniversalChat },
  { id: 'agents',    label: 'Agent Chat',     minRole: 'user', component: GlobalAgentChat },
];

function readTabFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('tab') ?? '';
}

export default function ChatHub() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const role = (user?.role ?? 'user') as RoleLevel;

  const tabFromUrl = readTabFromUrl();
  const visibleTabs = useMemo(() => {
    return ALL_TABS.filter((t) => {
      if (!hasAccess(role, t.minRole)) return false;
      if (t.id === 'legal') return true;
      return tabFromUrl === t.id;
    });
  }, [role, tabFromUrl]);
  const initialTab = visibleTabs.find(t => t.id === tabFromUrl)?.id ?? 'legal';
  const [tab, setTab] = useState<string>(initialTab);

  useEffect(() => {
    const urlTab = readTabFromUrl();
    if (urlTab && visibleTabs.find(t => t.id === urlTab)) setTab(urlTab);
  }, [visibleTabs]);

  useEffect(() => {
    const onPop = () => {
      const urlTab = readTabFromUrl();
      if (urlTab && visibleTabs.find(t => t.id === urlTab)) setTab(urlTab);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [visibleTabs]);

  const onChange = (next: string) => {
    setTab(next);
    setLocation(`/chat?tab=${next}`, { replace: true });
  };

  return (
    <JrxPageShell
      title="Chat Workspace"
      description="Legal Chat is the default workspace. Universal/Agent tabs stay on /api/chat/* until migrated."
      className="./jrx-light-scope"
      testId="chat-hub"
    >
      <Tabs value={tab} onValueChange={onChange}>
        <TabsList>
          {visibleTabs.map(t => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`chat-hub-tab-${t.id}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {visibleTabs.map(t => {
          const Comp = t.component;
          return (
            <TabsContent key={t.id} value={t.id} hidden={tab !== t.id}>
              <Card className="p-0 overflow-hidden min-h-[640px]">
                <ErrorBoundary
                  fallback={
                    <div className="p-6 text-sm text-red-700 bg-red-50 border border-red-200 rounded" data-testid={`error-tab-${t.id}`}>
                      <div className="font-semibold mb-1">Failed to load {t.label}.</div>
                      <div>Try switching tabs or refreshing the page. If this persists, the chat backend may be unavailable.</div>
                    </div>
                  }
                >
                  <Suspense fallback={<div className="p-6 space-y-3" data-testid={`loading-tab-${t.id}`}><Skeleton className="h-8 w-1/3" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>}>
                    {tab === t.id ? <Comp /> : null}
                  </Suspense>
                </ErrorBoundary>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </JrxPageShell>
  );
}
