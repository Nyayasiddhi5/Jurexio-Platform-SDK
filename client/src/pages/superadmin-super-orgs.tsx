/**
 * Jurexio Super Admin — Enterprise Super-Orgs (Task #384)
 *
 * Lets ONE enterprise customer (e.g. "ACME Enterprise") use multiple
 * Jurexio products (NSP + NSI + NSM) under ONE login / ONE bill / ONE
 * admin console. The page lists registered super-orgs, their member
 * (platform, customer-org) tuples, and offers create / attach / detach.
 *
 * Live-wired to /api/jrx/sdk/super-orgs (X-API-Key, admin-scope gated).
 *
 * NOTE: this is a grouping/UI/billing layer ONLY. The RLS policy
 * `customer_org_isolation` (drizzle/0013_customer_org_rls.sql) is
 * unchanged — per-platform rate limits and access scopes continue to be
 * enforced at (platform_id, customer_org_id). Switching between members
 * in this UI re-binds the SDK call to the chosen tuple; nothing here
 * grants cross-tenant data access on its own.
 */

import { getAuthToken } from '@/lib/jrx-auth-token';
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Building2, Plus, RefreshCw, Trash2, Layers, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NyvErrorState } from '@/components/NyvErrorState';

interface SuperOrg {
  id: number;
  name: string;
  slug: string;
  billing_email: string | null;
  status: string;
  member_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface Member {
  platform_id: number;
  customer_org_id: number;
  role: string;
  joined_at?: string;
  platform_name?: string | null;
  customer_external_ref?: string | null;
  customer_display_name?: string | null;
}

const BASE = '/api/jrx/sdk/super-orgs';

function authHeaders(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const tok = getAuthToken();
  if (tok) h['Authorization'] = `Bearer ${tok}`;
  return h;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders(), credentials: 'include' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.success === false) {
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return body.data as T;
}

export default function SuperAdminSuperOrgs(): JSX.Element {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listQ = useQuery<SuperOrg[]>({
    queryKey: ['super-orgs'],
    queryFn: () => getJson<SuperOrg[]>(BASE),
  });

  const detailQ = useQuery<{ members: Member[] } & SuperOrg>({
    queryKey: ['super-orgs', selectedId],
    queryFn: () => getJson(`${BASE}/${selectedId}`),
    enabled: selectedId != null,
  });

  const createM = useMutation({
    mutationFn: async (body: { name: string; slug: string; billing_email?: string }) => {
      const r = await fetch(BASE, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.success === false) throw new Error(j?.error || `HTTP ${r.status}`);
      return j.data as SuperOrg;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-orgs'] });
      setCreateOpen(false);
      toast({ title: 'Super-org saved' });
    },
    onError: (e: any) => toast({ title: 'Save failed', description: e?.message, variant: 'destructive' }),
  });

  const attachM = useMutation({
    mutationFn: async (vars: { superOrgId: number; platform_id: number; customer_org_id: number; role?: string }) => {
      const r = await fetch(`${BASE}/${vars.superOrgId}/members`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          platform_id: vars.platform_id,
          customer_org_id: vars.customer_org_id,
          role: vars.role,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.success === false) throw new Error(j?.error || `HTTP ${r.status}`);
      return j.data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['super-orgs', vars.superOrgId] });
      qc.invalidateQueries({ queryKey: ['super-orgs'] });
      setAttachOpen(null);
      toast({ title: 'Member attached' });
    },
    onError: (e: any) => toast({ title: 'Attach failed', description: e?.message, variant: 'destructive' }),
  });

  const detachM = useMutation({
    mutationFn: async (vars: { superOrgId: number; platform_id: number; customer_org_id: number }) => {
      const r = await fetch(
        `${BASE}/${vars.superOrgId}/members/${vars.platform_id}/${vars.customer_org_id}`,
        { method: 'DELETE', headers: authHeaders(), credentials: 'include' },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.success === false) throw new Error(j?.error || `HTTP ${r.status}`);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['super-orgs', vars.superOrgId] });
      qc.invalidateQueries({ queryKey: ['super-orgs'] });
      toast({ title: 'Member detached' });
    },
    onError: (e: any) => toast({ title: 'Detach failed', description: e?.message, variant: 'destructive' }),
  });

  const items = useMemo(() => listQ.data ?? [], [listQ.data]);

  return (
    <div className="p-6 space-y-6" data-testid="page-superadmin-super-orgs">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Layers className="w-6 h-6" /> Enterprise Super-Orgs
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Group multiple Jurexio products (NSP / NSI / NSM / NYM / …) under
            one enterprise account for unified login, billing and admin. RLS
            isolation between member tenants is preserved.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => listQ.refetch()} data-testid="btn-refresh">
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="btn-create-super-org">
                <Plus className="w-4 h-4 mr-2" /> New Super-Org
              </Button>
            </DialogTrigger>
            <CreateDialog
              onSubmit={(b) => createM.mutate(b)}
              busy={createM.isPending}
            />
          </Dialog>
        </div>
      </div>

      {listQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : listQ.isError ? (
        <NyvErrorState title="Failed to load super-orgs" message={(listQ.error as Error)?.message} onRetry={() => listQ.refetch()} />
      ) : items.length === 0 ? (
        <NyvEmptyState
          icon={Building2}
          title="No enterprise super-orgs yet"
          description="Create one to group multiple product tenants under a single enterprise account."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-2">
            {items.map((s) => (
              <Card
                key={s.id}
                className={selectedId === s.id ? 'border-primary cursor-pointer' : 'cursor-pointer'}
                onClick={() => setSelectedId(s.id)}
                data-testid={`super-org-row-${s.id}`}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.slug}</div>
                  </div>
                  <div className="text-right">
                    <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{s.status}</Badge>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1 justify-end">
                      <Users className="w-3 h-3" /> {s.member_count ?? 0}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="lg:col-span-2">
            {selectedId == null ? (
              <NyvEmptyState icon={Layers} title="Select a super-org" description="Pick one on the left to see its product memberships." />
            ) : detailQ.isLoading ? (
              <Skeleton className="h-60 w-full" />
            ) : detailQ.isError ? (
              <NyvErrorState title="Failed to load detail" message={(detailQ.error as Error)?.message} onRetry={() => detailQ.refetch()} />
            ) : (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>{detailQ.data?.name}</CardTitle>
                    <div className="text-xs text-muted-foreground">
                      {detailQ.data?.slug} · {detailQ.data?.billing_email ?? 'no billing email'}
                    </div>
                  </div>
                  <Dialog open={attachOpen === selectedId} onOpenChange={(o) => setAttachOpen(o ? selectedId : null)}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="btn-attach-member">
                        <Plus className="w-4 h-4 mr-1" /> Attach product
                      </Button>
                    </DialogTrigger>
                    <AttachDialog
                      busy={attachM.isPending}
                      onSubmit={(b) => attachM.mutate({ superOrgId: selectedId, ...b })}
                    />
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {(detailQ.data?.members ?? []).length === 0 ? (
                    <NyvEmptyState icon={Users} title="No product memberships yet" description="Attach a (platform, customer-org) tuple to bring a product under this enterprise account." />
                  ) : (
                    <div className="divide-y">
                      {(detailQ.data?.members ?? []).map((m) => (
                        <div key={`${m.platform_id}:${m.customer_org_id}`} className="py-3 flex items-center justify-between" data-testid={`member-row-${m.platform_id}-${m.customer_org_id}`}>
                          <div>
                            <div className="font-medium">
                              {m.platform_name ?? `platform #${m.platform_id}`} <span className="text-muted-foreground"> · </span>
                              {m.customer_display_name ?? m.customer_external_ref ?? `customer-org #${m.customer_org_id}`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              platform_id={m.platform_id} · customer_org_id={m.customer_org_id} · role={m.role}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => detachM.mutate({ superOrgId: selectedId, platform_id: m.platform_id, customer_org_id: m.customer_org_id })}
                            data-testid={`btn-detach-${m.platform_id}-${m.customer_org_id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateDialog({ onSubmit, busy }: { onSubmit: (b: { name: string; slug: string; billing_email?: string }) => void; busy: boolean }): JSX.Element {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New Enterprise Super-Org</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ACME Enterprise" data-testid="input-name" />
        </div>
        <div>
          <Label>Slug</Label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="acme-enterprise" data-testid="input-slug" />
        </div>
        <div>
          <Label>Billing email (optional)</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@acme.com" data-testid="input-email" />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={busy || !name || !slug}
          onClick={() => onSubmit({ name, slug, billing_email: email || undefined })}
          data-testid="btn-create-submit"
        >
          {busy ? 'Saving…' : 'Create'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AttachDialog({ onSubmit, busy }: { onSubmit: (b: { platform_id: number; customer_org_id: number; role?: string }) => void; busy: boolean }): JSX.Element {
  const [platform, setPlatform] = useState('');
  const [customer, setCustomer] = useState('');
  const [role, setRole] = useState('member');
  const platformN = Number(platform);
  const customerN = Number(customer);
  const valid = Number.isInteger(platformN) && platformN > 0 && Number.isInteger(customerN) && customerN > 0;
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Attach (platform, customer-org)</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>platform_id (sdk_applications.id)</Label>
          <Input type="number" value={platform} onChange={(e) => setPlatform(e.target.value)} data-testid="input-platform-id" />
        </div>
        <div>
          <Label>customer_org_id (nv_customer_organizations.id)</Label>
          <Input type="number" value={customer} onChange={(e) => setCustomer(e.target.value)} data-testid="input-customer-org-id" />
        </div>
        <div>
          <Label>Role</Label>
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="member" data-testid="input-role" />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={busy || !valid}
          onClick={() => onSubmit({ platform_id: platformN, customer_org_id: customerN, role })}
          data-testid="btn-attach-submit"
        >
          {busy ? 'Attaching…' : 'Attach'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
