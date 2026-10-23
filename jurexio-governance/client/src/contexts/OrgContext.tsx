import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * OrgContext — Active organisation selector for multi-tenant operators.
 *
 * Why this exists:
 *   Super-admins and operators with cross-org scope need a persistent
 *   "currently active org" identity that travels with every page. Without
 *   it, Org Admin / Billing / Audit / RBAC pages have to guess which org
 *   the operator means, and dashboards default to "first org returned by
 *   the API" — which is fragile and confusing.
 *
 * Behaviour:
 *   - Fetches /api/jrx/enterprise/admin/organizations once on auth.
 *   - Selects active org from localStorage `nyv.activeOrgId` if present,
 *     otherwise the user's bound `organizationId`, otherwise first.
 *   - Exposes setActiveOrgId() which persists to localStorage and emits
 *     a window event ("nyv:org-changed") so legacy pages can react.
 *   - Memoises the active org object for cheap consumer access.
 *
 * For users without multi-org scope (operator/analyst/user), this still
 * works — they just see a single (their own) organisation in the chip.
 *
 * SDK v5.0.0 polish-sprint D3 (gap F1).
 */
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';

export interface Organization {
  id: number | string;
  name: string;
  description?: string | null;
  plan?: string;
  isActive?: boolean;
  createdAt?: string;
}

interface OrgContextValue {
  organizations: Organization[];
  activeOrgId: number | string | null;
  activeOrg: Organization | null;
  setActiveOrgId: (id: number | string) => void;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const OrgContext = createContext<OrgContextValue>({
  organizations: [],
  activeOrgId: null,
  activeOrg: null,
  setActiveOrgId: () => {},
  isLoading: false,
  error: null,
  refresh: async () => {},
});

const STORAGE_KEY = 'nyv.activeOrgId';

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<number | string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrganizations = useCallback(async () => {
    if (!user) {
      setOrganizations([]);
      setActiveOrgIdState(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = typeof window !== 'undefined' ? getAuthToken() : null;
      const res = await fetch(nv('enterprise/admin/organizations'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) {
        // 403 is expected for low-privilege users — they get an empty list, not an error.
        if (res.status === 403 || res.status === 401) {
          // Fall back to the user's bound org if present.
          if (user.organizationId) {
            const fallback: Organization = {
              id: user.organizationId,
              name: 'My Organisation',
            };
            setOrganizations([fallback]);
            setActiveOrgIdState(fallback.id);
          } else {
            setOrganizations([]);
            setActiveOrgIdState(null);
          }
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const orgs: Organization[] = json?.data ?? json?.organizations ?? json ?? [];
      setOrganizations(orgs);

      // Pick the active org: stored > user-bound > first.
      const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      const storedNum = stored !== null && stored !== '' ? (Number.isNaN(Number(stored)) ? stored : Number(stored)) : null;
      const inList = (id: number | string | null) =>
        id !== null && orgs.some(o => String(o.id) === String(id));
      const next =
        (inList(storedNum) ? storedNum : null) ??
        (user.organizationId && inList(user.organizationId) ? user.organizationId : null) ??
        orgs[0]?.id ??
        null;
      setActiveOrgIdState(next ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load organisations');
      setOrganizations([]);
      setActiveOrgIdState(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const setActiveOrgId = useCallback((id: number | string) => {
    setActiveOrgIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
      window.dispatchEvent(new CustomEvent('nyv:org-changed', { detail: { id } }));
    } catch {
      /* noop */
    }
  }, []);

  const activeOrg = useMemo(
    () => organizations.find(o => String(o.id) === String(activeOrgId)) ?? null,
    [organizations, activeOrgId],
  );

  const value: OrgContextValue = useMemo(
    () => ({
      organizations,
      activeOrgId,
      activeOrg,
      setActiveOrgId,
      isLoading,
      error,
      refresh: fetchOrganizations,
    }),
    [organizations, activeOrgId, activeOrg, setActiveOrgId, isLoading, error, fetchOrganizations],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}
