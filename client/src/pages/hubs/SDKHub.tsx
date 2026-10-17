import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { hasAccess, type RoleLevel } from '@/lib/rbac-registry';
import { NyvPageShell } from '@/components/NyvPageShell';

const JurexioSDKHub = lazy(() => import('../nyayavigya-sdk-hub'));
const SDKDeveloperConsole = lazy(() => import('../sdk-developer-console'));
const SDKApiPlayground = lazy(() => import('../sdk-api-playground'));
const SDKApiTester = lazy(() => import('../sdk-api-tester'));
const SDKTestingConsole = lazy(() => import('../sdk-testing-console'));
const ClientSdkPlayground = lazy(() => import('../client-sdk-playground'));
const SDKDownloads = lazy(() => import('../SDKDownloads'));
const SdkKeyManagement = lazy(() => import('../sdk-key-management'));
const SdkPlatformOnboarding = lazy(() => import('../sdk-platform-onboarding'));

type TabSpec = { id: string; label: string; minRole: RoleLevel; component: React.LazyExoticComponent<React.ComponentType<unknown>> };

const ALL_TABS: TabSpec[] = [
  { id: 'overview',    label: 'Overview',              minRole: 'user',      component: JurexioSDKHub },
  { id: 'developer',   label: 'Developer Console',     minRole: 'developer', component: SDKDeveloperConsole },
  { id: 'playground',  label: 'API Playground',        minRole: 'developer', component: SDKApiPlayground },
  { id: 'tester',      label: 'API Tester',            minRole: 'developer', component: SDKApiTester },
  { id: 'testing',     label: 'Testing Console',       minRole: 'developer', component: SDKTestingConsole },
  { id: 'client',      label: 'Client SDK Playground', minRole: 'developer', component: ClientSdkPlayground },
  { id: 'downloads',   label: 'Downloads',             minRole: 'developer', component: SDKDownloads },
  { id: 'keys',        label: 'Key Management',        minRole: 'org_admin', component: SdkKeyManagement },
  { id: 'onboarding',  label: 'Platform Onboarding',   minRole: 'developer', component: SdkPlatformOnboarding },
];

export default function SDKHub() {
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
    setLocation(`/sdk-hub?tab=${next}`, { replace: true });
  };

  return (
    <NyvPageShell
      title="SDK Hub"
      description="One stop for SDK overview, key management, downloads, playgrounds and platform onboarding. Tabs are filtered by your role."
      className="./jrx-light-scope"
      testId="sdk-hub"
    >
      <Tabs value={tab} onValueChange={onChange}>
        <TabsList className="flex-wrap h-auto">
          {visibleTabs.map(t => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`sdk-hub-tab-${t.id}`}>
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
    </NyvPageShell>
  );
}
