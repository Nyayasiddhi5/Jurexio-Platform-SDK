/**
 * Task #156 — Stand-alone SME Legal Chat shell.
 *
 * Mounted at /sme/* (separate Wouter Router base from the main /console
 * shell). Auth: shares the gateway's JWT (localStorage 'token') with the
 * main console — an SME logged in here can open /console and vice-versa.
 *
 * The SmeAuthShell holds its own user state so the shared AuthProvider
 * (which is presentational — App.tsx is the canonical state holder for
 * the main console) wires correctly here without depending on App.tsx.
 */
import { Router, Route, Switch, useLocation } from 'wouter';
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Toaster } from '@/components/ui/toaster';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { clearAuthSession, getStoredUserRaw, setAuthSession } from '@/lib/auth-session';
import { consoleHomePath } from '@/lib/jrx-role-home';

const SmeLogin = lazy(() => import('./SmeLogin'));
const SmeSetup = lazy(() => import('./SmeSetup'));
const SmeWorkspace = lazy(() => import('./SmeWorkspace'));

const SME_ROLES = new Set(['sme', 'super_admin', 'superadmin']);
const SME_BASE =
  typeof window !== 'undefined' && window.location.pathname.startsWith('/legalchat')
    ? '/legalchat'
    : '/sme';

const withBase = (path: string): string => `${SME_BASE}${path}`;

interface StoredUser {
  id: string | number;
  email: string;
  role: string;
  name?: string;
  full_name?: string;
  organizationId?: string | number;
  organization_id?: string | number;
}

interface AuthUser {
  id: string | number;
  name: string;
  email: string;
  role: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  organizationId?: string | number;
  organization_id?: string | number;
}

function toAuthUser(raw: StoredUser): AuthUser {
  return {
    id: raw.id,
    name: raw.name || raw.full_name || raw.email,
    email: raw.email,
    role: raw.role,
    subscriptionTier: 'sme',
    subscriptionStatus: 'active',
    organizationId: raw.organizationId ?? raw.organization_id,
    organization_id: raw.organization_id ?? raw.organizationId,
  };
}

function SmeAuthShell({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = getStoredUserRaw();
      if (raw) setUser(toAuthUser(JSON.parse(raw) as StoredUser));
    } catch { /* ignore corrupt */ }
    setReady(true);
  }, []);

  const login = useCallback((u: AuthUser) => {
    setUser(u);
    const token = localStorage.getItem('token') || localStorage.getItem('nyv_token') || '';
    if (token) setAuthSession(token, u);
    else localStorage.setItem('user', JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    clearAuthSession();
    window.location.href = withBase('/login');
  }, []);

  if (!ready) return <CenteredLoader text="Loading SME workspace…" />;
  return (
    <AuthProvider user={user} login={login} logout={logout}>
      {children}
    </AuthProvider>
  );
}

function SmeGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [, setLoc] = useLocation();
  useEffect(() => { if (!user) setLoc('/login'); }, [user, setLoc]);
  if (!user) return <CenteredLoader text="Redirecting to sign-in…" />;
  const role = String(user.role || '').toLowerCase();
  if (!SME_ROLES.has(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white"
        style={{ background: 'linear-gradient(135deg,#0E1830,#152448 50%,#152448)' }}>
        <div className="max-w-md text-center p-8 rounded-xl border"
          style={{ background: '#152448', borderColor: '#2B384C' }}>
          <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Merriweather, serif' }}>
            LegalChat workspace
          </h1>
          <p className="text-sm mb-4" style={{ color: '#8B9DC3' }}>
            This URL is for SME LegalChat sessions. Platform admins should use the Jurexio Console.
          </p>
          <a href={consoleHomePath(user.role)}
            className="inline-block px-4 py-2 rounded font-semibold text-sm"
            style={{ background: '#C7B15B', color: '#152448' }}>
            Open platform console
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function CenteredLoader({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-white"
      style={{ background: 'linear-gradient(135deg,#0E1830,#152448 50%,#152448)' }}>
      <div className="text-center">
        <LoadingSpinner />
        <div className="mt-3 text-sm text-[#C7B15B]">{text}</div>
      </div>
    </div>
  );
}

export default function SmeApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <SmeAuthShell>
          <Router base={SME_BASE}>
            <Suspense fallback={<CenteredLoader text="Loading SME workspace…" />}>
              <Switch>
                <Route path="/login" component={SmeLogin} />
                <Route path="/setup" component={SmeSetup} />
                <Route path="/" component={() => {
                  // Strict canonical SME entry: any hit on /sme or /sme/
                  // redirects to /sme/chat so the URL bar always reflects
                  // the workspace route the runbook references.
                  if (
                    typeof window !== 'undefined' &&
                    window.location.pathname.replace(/\/$/, '') === SME_BASE
                  ) {
                    window.history.replaceState(null, '', withBase('/chat'));
                  }
                  return <SmeGate><SmeWorkspace /></SmeGate>;
                }} />
                <Route path="/chat" component={() => (
                  <SmeGate><SmeWorkspace /></SmeGate>
                )} />
                <Route>
                  {() => {
                    // Unknown /sme/* path → redirect to /sme/chat for the
                    // strict canonical entry per the runbook.
                    if (
                      typeof window !== 'undefined' &&
                      ![withBase('/login'), withBase('/setup'), withBase('/chat')].includes(window.location.pathname)
                    ) {
                      window.history.replaceState(null, '', withBase('/chat'));
                    }
                    return <SmeGate><SmeWorkspace /></SmeGate>;
                  }}
                </Route>
              </Switch>
            </Suspense>
            <Toaster />
          </Router>
        </SmeAuthShell>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
