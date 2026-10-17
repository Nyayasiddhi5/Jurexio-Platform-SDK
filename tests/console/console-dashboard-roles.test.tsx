/**
 * @vitest-environment jsdom
 *
 * task-162 — Console Dashboard role smoke
 *
 * `/console/dashboard` is the new default landing page for every non-admin
 * role (see `RoleHome` in `client/src/App.tsx`):
 *
 *   manager / senior_analyst / analyst / developer / operator / user → /dashboard
 *
 * Because that is the FIRST screen those roles see after login, a regression
 * that breaks the page would silently break the entire post-login experience
 * for the majority of seats. This smoke locks two things per role:
 *
 *   1. `<ConsoleDashboard />` renders without throwing.
 *   2. The four KPI tiles are present: Gateway, Active Agents, HITL Pending,
 *      Self-Healing.
 *
 * The component fetches several `/api/jrx/*` endpoints via React Query +
 * `safeGet` (which swallows errors). We stub `fetch` to return empty 200
 * payloads so the page degrades to its `'—'` placeholder values — that is
 * still enough to render every KPI label, which is what the task requires.
 */
import './setup-jsdom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderWithProviders, screen, makeQueryClient } from './test-utils';
import ConsoleDashboard from '../../client/src/pages/console-dashboard';
import { AuthProvider } from '../../client/src/contexts/AuthContext';
// Vite `?raw` suffix loads the file as a string at transform time — works
// under both node and jsdom envs (no node:fs externalisation issue).
// @ts-expect-error - ?raw query is a Vite/Vitest feature, not declared in TS.
import appTsxSource from '../../client/src/App.tsx?raw';

// Roles that `RoleHome` redirects to `/dashboard` (the ConsoleDashboard).
// Kept in lockstep with `roleHomeMap` in `client/src/App.tsx` — if a role
// is added/removed there, this list must be updated too (and the test will
// catch a mismatch immediately because the missing role silently drops a
// case from the it.each sweep).
const DASHBOARD_ROLES = [
  'user',
  'operator',
  'analyst',
  'senior_analyst',
  'manager',
  'developer',
] as const;

const KPI_LABELS = ['Gateway', 'Active Agents', 'HITL Pending', 'Self-Healing'] as const;

function makeUser(role: string) {
  return {
    id: 1,
    name: `Test ${role}`,
    email: `${role}@example.com`,
    role,
    subscriptionTier: 'enterprise',
    subscriptionStatus: 'active',
  };
}

function stubDashboardFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // Return shape-compatible empty payloads for each endpoint the dashboard
    // probes — the page's `safeGet` + defensive shape-coercion will fall
    // back to '—' / 0 placeholders, which still surfaces every KPI label.
    if (url.includes('/api/jrx/health'))            return json({ status: 'healthy', providers: [] });
    if (url.includes('/api/jrx/healing/health'))    return json({ healthy: true });
    if (url.includes('/api/jrx/registry/agents'))   return json({ total: 0, agents: [] });
    if (url.includes('/api/jrx/hitl/stats'))        return json({ pending: 0 });
    if (url.includes('/api/jrx/activity/recent'))   return json({ events: [] });
    if (url.includes('/api/jrx/protocols'))         return json({ protocols: [] });
    return json({});
  }) as unknown as typeof fetch;
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// Drift guard: parse `roleHomeMap` out of `client/src/App.tsx` and assert
// EVERY role that maps to `/dashboard` is covered by DASHBOARD_ROLES above.
// If a future PR adds a new role to roleHomeMap → /dashboard but forgets to
// extend this smoke, this assertion fails LOUDLY at the top of the suite —
// which is exactly the regression task-162 wants to prevent.
describe('Console Dashboard — role list drift guard (task-162)', () => {
  it('DASHBOARD_ROLES matches every role that RoleHome sends to /dashboard', () => {
    const mapMatch = (appTsxSource as string).match(
      /roleHomeMap\s*:\s*Record<[^>]+>\s*=\s*\{([\s\S]*?)\}\s*;/,
    );
    expect(mapMatch, 'roleHomeMap literal not found in client/src/App.tsx').toBeTruthy();
    const body = mapMatch![1];
    // Lines look like:   manager:         '/dashboard',
    const dashboardRoles = Array.from(
      body.matchAll(/(\w+)\s*:\s*['"]\/dashboard['"]/g),
      (m) => m[1],
    ).sort();
    const covered = [...DASHBOARD_ROLES].sort();
    expect(dashboardRoles, 'DASHBOARD_ROLES drifted from roleHomeMap in App.tsx — update tests/console/console-dashboard-roles.test.tsx').toEqual(covered);
  });
});

describe('Console Dashboard — role landing smoke (task-162)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubDashboardFetch();
    window.localStorage.setItem('token', 'jwt.test.token');
  });

  it.each(DASHBOARD_ROLES)(
    'renders ConsoleDashboard with all four KPI tiles for role: %s',
    async (role) => {
      const user = makeUser(role);
      renderWithProviders(
        <AuthProvider user={user} login={() => {}} logout={() => {}}>
          <ConsoleDashboard />
        </AuthProvider>,
        { queryClient: makeQueryClient() },
      );

      // Greeting strip proves the page mounted without throwing — uses the
      // user's display name pulled from the AuthProvider value above.
      expect(await screen.findByText(`Welcome back, ${user.name}`)).toBeInTheDocument();

      // The four KPI labels MUST all be present. Any missing label means a
      // tile was dropped or the section failed to render — the exact thing
      // task-162 wants to catch loudly in CI.
      for (const label of KPI_LABELS) {
        expect(
          await screen.findByText(label, { selector: 'div' }),
          `KPI tile "${label}" missing for role ${role}`,
        ).toBeInTheDocument();
      }
    },
  );
});
