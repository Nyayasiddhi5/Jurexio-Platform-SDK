import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, Plus, Globe, BarChart3, Palette, Settings, RefreshCw, CheckCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NyvErrorState } from '@/components/NyvErrorState';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
const PARTNER_TIERS = [
  { id: 'starter', label: 'Starter', color: 'bg-gray-100 text-gray-700', features: ['Basic branding', 'Up to 3 jurisdictions', 'Standard API', '10K req/day'] },
  { id: 'professional', label: 'Professional', color: 'bg-blue-100 text-blue-700', features: ['Full branding', 'All 6 jurisdictions', 'Priority API', '100K req/day', 'Custom domain'] },
  { id: 'enterprise', label: 'Enterprise', color: 'bg-purple-100 text-purple-700', features: ['White-label complete', 'All jurisdictions', 'Dedicated infra', 'Unlimited', 'SLA 99.9%'] },
  { id: 'sovereign', label: 'Sovereign', color: 'bg-yellow-100 text-yellow-800', features: ['Air-gapped deployment', 'On-premise SLM', 'Custom training', 'Government-grade', 'Full data sovereignty'] },
];

export default function WhiteLabelAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<any>(null);
  const [form, setForm] = useState({ partnerName: '', tier: 'starter', primaryColor: '#1a56db', logoUrl: '', jurisdictions: ['IN'], contactEmail: '' });

  const { data: partners, isLoading, isError: partnersError, refetch } = useQuery({
    queryKey: [nv('admin/white-label')],
    queryFn: () => apiRequest('GET', nv('admin/white-label')),
    refetchInterval: 60000,
  });

  const { data: partnerStats, isError: partnerStatsError, refetch: refetchPartnerStats } = useQuery({
    queryKey: [nv('admin/white-label'), selectedPartner?.partnerId, 'stats'],
    queryFn: () => selectedPartner ? apiRequest('GET', `${NV_BASE}admin/white-label/${selectedPartner.partnerId}/stats`) : Promise.resolve(null),
    enabled: !!selectedPartner,
  });

  const { data: health, isError: healthError, refetch: refetchHealth } = useQuery({
    queryKey: [nv('admin/white-label/health')],
    queryFn: () => apiRequest('GET', nv('admin/white-label/health')),
  });

  const createPartner = useMutation({
    mutationFn: (data: any) => apiRequest('POST', nv('admin/white-label'), data),
    onSuccess: () => {
      setCreateOpen(false);
      setForm({ partnerName: '', tier: 'starter', primaryColor: '#1a56db', logoUrl: '', jurisdictions: ['IN'], contactEmail: '' });
      qc.invalidateQueries({ queryKey: [nv('admin/white-label')] });
      toast({ title: 'Partner configuration created' });
    },
    onError: () => toast({ title: 'Failed to create partner config', variant: 'destructive' }),
  });

  const handleCreate = () => {
    if (!form.partnerName.trim()) { toast({ title: 'Partner name is required', variant: 'destructive' }); return; }
    createPartner.mutate(form);
  };

  const partnersArr = partners?.data?.configurations || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            White-Label Administration
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Partner brand configuration, feature toggles, and tier management</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild aria-label="Open dialog">
            <Button size="sm"><Plus className="h-4 w-4 mr-2" />New Partner</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Partner Configuration</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label>Partner Name *</Label>
                <Input value={form.partnerName} onChange={e => setForm(f => ({...f, partnerName: e.target.value}))} placeholder="LegalTech Innovations Ltd" className="mt-1" /></div>
              <div><Label>Partner Tier</Label>
                <Select value={form.tier} onValueChange={v => setForm(f => ({...f, tier: v}))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{PARTNER_TIERS.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Primary Color</Label>
                  <div className="flex gap-2 mt-1">
                    <input type="color" value={form.primaryColor} onChange={e => setForm(f => ({...f, primaryColor: e.target.value}))} className="h-9 w-12 rounded border cursor-pointer" />
                    <Input value={form.primaryColor} onChange={e => setForm(f => ({...f, primaryColor: e.target.value}))} className="flex-1" />
                  </div></div>
                <div><Label>Contact Email</Label>
                  <Input type="email" value={form.contactEmail} onChange={e => setForm(f => ({...f, contactEmail: e.target.value}))} placeholder="partner@example.com" className="mt-1" /></div>
              </div>
              <div><Label>Logo URL</Label>
                <Input value={form.logoUrl} onChange={e => setForm(f => ({...f, logoUrl: e.target.value}))} placeholder="https://..." className="mt-1" /></div>
              <Button onClick={handleCreate} className="w-full" disabled={createPartner.isPending}>
                {createPartner.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Create Partner Config
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tier Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {PARTNER_TIERS.map(tier => (
          <Card key={tier.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <Badge className={`${tier.color} mb-3`}>{tier.label}</Badge>
              <ul className="space-y-1">
                {tier.features.map(f => (
                  <li key={f} className="text-xs flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="partners">
        <TabsList aria-label="Navigation tabs">
          <TabsTrigger value="partners" aria-label="partners tab">Partners ({partnersArr.length})</TabsTrigger>
          <TabsTrigger value="stats" disabled={!selectedPartner} aria-label="stats tab">Partner Stats</TabsTrigger>
        </TabsList>

        <TabsContent value="partners" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-80" aria-label="Scrollable content">
                {isLoading ? (
                  <div className="p-4 space-y-2" data-testid="loading-partners">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                  </div>
                ) : partnersError ? (
                  <div className="p-4">
                    <NyvErrorState
                      title="Unable to load partners"
                      description="The white-label partner directory could not be retrieved."
                      onRetry={() => refetch()}
                      variant="card"
                    />
                  </div>
                ) : partnersArr.length === 0 ? (
                  <NyvEmptyState
                    icon={Building2}
                    title="No partner configurations yet"
                    description="Create your first partner above to get started."
                  />
                ) : (
                    <div className="divide-y">
                      {partnersArr.map((partner: any) => {
                        const tier = PARTNER_TIERS.find(t => t.id === partner.tier);
                        return (
                          <div key={partner.id} className="p-4 hover:bg-muted/50 cursor-pointer flex items-center gap-4"
                            onClick={() => setSelectedPartner(partner)}>
                            {partner.brandConfig?.logoUrl ? (
                              <img src={partner.brandConfig.logoUrl} alt={partner.partnerName} className="h-8 w-8 rounded object-contain" />
                            ) : (
                              <div className="h-8 w-8 rounded flex items-center justify-center text-white text-xs font-bold"
                                style={{ backgroundColor: partner.brandConfig?.primaryColor || '#1a56db' }}>
                                {partner.partnerName?.charAt(0)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{partner.partnerName}</span>
                                <Badge className={`text-xs ${tier?.color || ''}`}>{tier?.label || partner.tier}</Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                ID: {partner.partnerId} · {partner.jurisdictions?.join(', ') || 'All jurisdictions'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {partner.isActive ? (
                                <Badge className="bg-green-100 text-green-700 text-xs">Active</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs" role="status">Inactive</Badge>
                              )}
                              <BarChart3 className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          {selectedPartner && partnerStats?.data ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Object.entries(partnerStats.data).filter(([k]) => typeof partnerStats.data[k] !== 'object').map(([key, val]) => (
                <Card key={key}><CardContent className="p-4">
                  <div className="text-2xl font-bold">{String(val)}</div>
                  <div className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                </CardContent></Card>
              ))}
            </div>
          ) : (
            <Alert role="alert"><AlertDescription>Select a partner from the Partners tab to view their stats.</AlertDescription></Alert>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
