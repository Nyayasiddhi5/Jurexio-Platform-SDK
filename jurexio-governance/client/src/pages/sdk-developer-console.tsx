import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  LayoutDashboard,
  AppWindow,
  Key,
  Bot,
  BarChart3,
  Plus,
  Eye,
  Pause,
  XCircle,
  RotateCcw,
  Copy,
  Check,
  Loader2,
  Trash2,
  AlertTriangle,
  Activity,
  Coins,
  Zap,
  Clock,
  Shield,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { PageLoading } from '@/components/ui/page-loading';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

const APP_TYPES = [
  { value: 'jurexio-citizen', label: 'Jurexio Citizen' },
  { value: 'nyayasiddhi_professional', label: 'Jurexio Professional™' },
  { value: 'nyayasiddhi_institutional', label: 'Jurexio Institutional™' },
  { value: 'nyayasiddhi_governance', label: 'Jurexio Ministry™' },
  { value: 'nyayasiddhi_academy', label: 'Jurexio Academy™' },
  { value: 'nyayasiddhi_automation', label: 'Jurexio Automation SDK' },
  { value: 'custom', label: 'Custom' },
];

// v5.0.0: All 7 jurisdiction registries supported by the SDK.
const JURISDICTIONS = [
  { value: 'IN', label: 'India (IN)' },
  { value: 'UK', label: 'United Kingdom (UK)' },
  { value: 'US', label: 'United States (US)' },
  { value: 'GC', label: 'GCC (GC)' },
  { value: 'EU', label: 'European Union (EU)' },
  { value: 'SG', label: 'Singapore (SG)' },
  { value: 'DEFAULT', label: 'Default (Cross-jurisdiction)' },
];

const AVAILABLE_SCOPES = [
  'research:read',
  'documents:read',
  'documents:write',
  'agents:execute',
  'agents:read',
  'usage:read',
  'translate:read',
  'ocr:read',
  'payments:read',
  'payments:write',
  '*',
];

function statusBadgeVariant(status: string) {
  switch (status) {
    case 'active': return 'default' as const;
    case 'suspended': return 'secondary' as const;
    case 'revoked': return 'destructive' as const;
    default: return 'outline' as const;
  }
}

export default function SDKDeveloperConsole() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [activeTab, setActiveTab] = useState('overview');
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [usagePeriod, setUsagePeriod] = useState('month');

  const [createAppOpen, setCreateAppOpen] = useState(false);
  const [createAppForm, setCreateAppForm] = useState({
    appName: '', appType: 'custom', description: '', jurisdiction: 'IN',
    rateLimitPerMinute: 60, dailyTokenBudget: 1000000, monthlyTokenBudget: 30000000,
  });

  const [detailAppId, setDetailAppId] = useState<number | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [updateForm, setUpdateForm] = useState<Record<string, string | number>>({});

  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createKeyForm, setCreateKeyForm] = useState({ name: '', scopes: [] as string[], expiresAt: '' });
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const [assignAgentsOpen, setAssignAgentsOpen] = useState(false);
  const [agentIdsInput, setAgentIdsInput] = useState('');

  const { data: overview, isLoading: overviewLoading } = useQuery<Record<string, any>>({
    queryKey: ['/api/v1/console/overview'],
  });

  const { data: apps, isLoading: appsLoading } = useQuery({
    queryKey: ['/api/v1/console/apps'],
  });

  const appsList = Array.isArray(apps) ? apps : [];

  const { data: appDetail } = useQuery({
    queryKey: ['/api/v1/console/apps', detailAppId],
    queryFn: () => apiRequest(`/api/v1/console/apps/${detailAppId}`),
    enabled: !!detailAppId,
  });

  const { data: apiKeys, isLoading: keysLoading } = useQuery({
    queryKey: ['/api/v1/console/apps', selectedAppId, 'keys'],
    queryFn: () => apiRequest(`/api/v1/console/apps/${selectedAppId}/keys`),
    enabled: !!selectedAppId,
  });

  const { data: assignedAgents, isLoading: agentsLoading } = useQuery({
    queryKey: ['/api/v1/console/apps', selectedAppId, 'agents'],
    queryFn: () => apiRequest(`/api/v1/console/apps/${selectedAppId}/agents`),
    enabled: !!selectedAppId,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['/api/v1/console/apps', selectedAppId, 'usage', usagePeriod],
    queryFn: () => apiRequest(`/api/v1/console/apps/${selectedAppId}/usage?period=${usagePeriod}`),
    enabled: !!selectedAppId,
  });

  const createAppMutation = useMutation({
    mutationFn: () => apiRequest('/api/v1/console/apps', 'POST', createAppForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/overview'] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps'] });
      setCreateAppOpen(false);
      setCreateAppForm({ appName: '', appType: 'custom', description: '', jurisdiction: 'IN', rateLimitPerMinute: 60, dailyTokenBudget: 1000000, monthlyTokenBudget: 30000000 });
      toast({ title: 'Application Created', description: 'Your new SDK application has been created successfully.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const suspendAppMutation = useMutation({
    mutationFn: (appId: number) => apiRequest(`/api/v1/console/apps/${appId}/suspend`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps'] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/overview'] });
      toast({ title: 'App Suspended' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const revokeAppMutation = useMutation({
    mutationFn: (appId: number) => apiRequest(`/api/v1/console/apps/${appId}/revoke`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps'] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/overview'] });
      toast({ title: 'App Revoked' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const activateAppMutation = useMutation({
    mutationFn: (appId: number) => apiRequest(`/api/v1/console/apps/${appId}/activate`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps'] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/overview'] });
      toast({ title: 'App Activated', description: 'Application has been reactivated successfully.' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const rotateSecretMutation = useMutation({
    mutationFn: (appId: number) => apiRequest(`/api/v1/console/apps/${appId}/rotate-secret`, 'POST'),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps'] });
      toast({ title: 'Client Secret Rotated', description: `New secret: ${data?.clientSecret || 'Check app details'}` });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const updateAppMutation = useMutation({
    mutationFn: (params: { appId: number; updates: Record<string, string | number> }) =>
      apiRequest(`/api/v1/console/apps/${params.appId}`, 'PUT', params.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps'] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps', detailAppId] });
      setDetailDialogOpen(false);
      toast({ title: 'Application Updated' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const createKeyMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/console/apps/${selectedAppId}/keys`, 'POST', {
        name: createKeyForm.name,
        scopes: createKeyForm.scopes,
        expiresAt: createKeyForm.expiresAt || undefined,
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps', selectedAppId, 'keys'] });
      setNewlyCreatedKey(data?.rawKey || data?.apiKey || data?.key || JSON.stringify(data));
      setCreateKeyForm({ name: '', scopes: [], expiresAt: '' });
      toast({ title: 'API Key Created' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: (keyId: number) =>
      apiRequest(`/api/v1/console/apps/${selectedAppId}/keys/${keyId}/revoke`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps', selectedAppId, 'keys'] });
      toast({ title: 'API Key Revoked' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const activateKeyMutation = useMutation({
    mutationFn: (keyId: number) =>
      apiRequest(`/api/v1/console/apps/${selectedAppId}/keys/${keyId}/activate`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps', selectedAppId, 'keys'] });
      toast({ title: 'API Key Activated', description: 'API key has been reactivated successfully.' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const assignAgentsMutation = useMutation({
    mutationFn: (agents: string[]) =>
      apiRequest(`/api/v1/console/apps/${selectedAppId}/agents`, 'POST', { agents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps', selectedAppId, 'agents'] });
      setAssignAgentsOpen(false);
      setAgentIdsInput('');
      toast({ title: 'Agents Assigned' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const removeAgentMutation = useMutation({
    mutationFn: (agentId: string) =>
      apiRequest(`/api/v1/console/apps/${selectedAppId}/agents/${agentId}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/console/apps', selectedAppId, 'agents'] });
      toast({ title: 'Agent Removed' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const handleCopyKey = () => {
    if (newlyCreatedKey) {
      navigator.clipboard.writeText(newlyCreatedKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    }
  };

  const toggleScope = (scope: string) => {
    setCreateKeyForm(prev => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter(s => s !== scope)
        : [...prev.scopes, scope],
    }));
  };

  const openDetailDialog = (app: Record<string, unknown>) => {
    setDetailAppId(app.id as number);
    setUpdateForm({
      appName: (app.appName as string) || '',
      description: (app.description as string) || '',
    });
    setDetailDialogOpen(true);
  };

  const appSelectDropdown = (
    <Select value={selectedAppId} onValueChange={setSelectedAppId} aria-label="Select option">
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Select an application" />
      </SelectTrigger>
      <SelectContent>
        {appsList.map((app: Record<string, unknown>) => (
          <SelectItem key={String(app.id)} value={String(app.id)}>
            {String(app.appName)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <img 
              src="/images/nyayasiddhi-logo.jpeg" 
              alt="Jurexio" 
              className="w-12 h-12 rounded-lg shadow-md"
            />
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3 font-heading" style={{ color: '#152448' }}>
                <Shield className="h-8 w-8" style={{ color: '#152448' }} />
                Jurexio SDK — Developer Console
              </h1>
              <p style={{ color: '#152448' }} className="mt-1">Manage applications, API keys, agents, and usage analytics</p>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6" aria-label="Navigation tabs">
            <TabsTrigger value="overview" className="gap-2" aria-label="overview tab">
              <LayoutDashboard className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="applications" className="gap-2" aria-label="applications tab">
              <AppWindow className="h-4 w-4" />
              Applications
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="gap-2" aria-label="api keys tab">
              <Key className="h-4 w-4" />
              API Keys
            </TabsTrigger>
            <TabsTrigger value="agents" className="gap-2" aria-label="agents tab">
              <Bot className="h-4 w-4" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="usage" className="gap-2" aria-label="usage tab">
              <BarChart3 className="h-4 w-4" />
              Usage & Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {overviewLoading ? (
              <PageLoading rows={5} />
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Total Apps</CardDescription>
                      <CardTitle className="text-2xl">{overview?.totalApps ?? 0}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <AppWindow className="h-5 w-5 text-muted-foreground" />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Active Apps</CardDescription>
                      <CardTitle className="text-2xl">{overview?.activeApps ?? 0}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Activity className="h-5 w-5 text-emerald-500" />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Requests (30d)</CardDescription>
                      <CardTitle className="text-2xl">{overview?.last30Days?.totalRequests?.toLocaleString() ?? 0}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Zap className="h-5 w-5 text-gold-500" />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Tokens (30d)</CardDescription>
                      <CardTitle className="text-2xl">{overview?.last30Days?.totalTokensUsed?.toLocaleString() ?? 0}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Coins className="h-5 w-5" style={{ color: '#152448' }} />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Est. Cost (30d)</CardDescription>
                      <CardTitle className="text-2xl">${overview?.last30Days?.totalEstimatedCost ?? '0.00'}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <BarChart3 className="h-5 w-5 text-gold-500" />
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Application Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Requests</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(overview?.apps || []).map((app: Record<string, unknown>) => (
                          <TableRow key={String(app.id)}>
                            <TableCell className="font-medium">{String(app.appName)}</TableCell>
                            <TableCell>{String(app.appType)}</TableCell>
                            <TableCell>
                              <Badge variant={statusBadgeVariant(String(app.status))}>{String(app.status)}</Badge>
                            </TableCell>
                            <TableCell>{((app.usage as Record<string, unknown>)?.requestCount as number)?.toLocaleString() ?? '-'}</TableCell>
                            <TableCell>{((app.usage as Record<string, unknown>)?.totalTokensUsed as number)?.toLocaleString() ?? '-'}</TableCell>
                            <TableCell>${String((app.usage as Record<string, unknown>)?.totalEstimatedCost ?? '-')}</TableCell>
                          </TableRow>
                        ))}
                        {(!overview?.apps || overview.apps.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No applications yet. Create one to get started.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="applications">
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Applications</h2>
                <Dialog open={createAppOpen} onOpenChange={setCreateAppOpen}>
                  <DialogTrigger asChild aria-label="Open dialog">
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Application
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Create New Application</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Application Name *</Label>
                        <Input
                          value={createAppForm.appName}
                          onChange={(e) => setCreateAppForm(f => ({ ...f, appName: e.target.value }))}
                          placeholder="My SDK App"
                        />
                      </div>
                      <div>
                        <Label>Application Type</Label>
                        <Select value={createAppForm.appType} onValueChange={(v) => setCreateAppForm(f => ({ ...f, appType: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {APP_TYPES.map(t => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Textarea
                          value={createAppForm.description}
                          onChange={(e) => setCreateAppForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="Describe your application..."
                        />
                      </div>
                      <div>
                        <Label>Jurisdiction</Label>
                        <Select value={createAppForm.jurisdiction} onValueChange={(v) => setCreateAppForm(f => ({ ...f, jurisdiction: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {JURISDICTIONS.map(j => (
                              <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label>Rate Limit/min</Label>
                          <Input
                            type="number"
                            value={createAppForm.rateLimitPerMinute}
                            onChange={(e) => setCreateAppForm(f => ({ ...f, rateLimitPerMinute: parseInt(e.target.value) || 60 }))}
                          />
                        </div>
                        <div>
                          <Label>Daily Token Budget</Label>
                          <Input
                            type="number"
                            value={createAppForm.dailyTokenBudget}
                            onChange={(e) => setCreateAppForm(f => ({ ...f, dailyTokenBudget: parseInt(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <Label>Monthly Token Budget</Label>
                          <Input
                            type="number"
                            value={createAppForm.monthlyTokenBudget}
                            onChange={(e) => setCreateAppForm(f => ({ ...f, monthlyTokenBudget: parseInt(e.target.value) || 0 }))}
                          />
                        </div>
                      </div>
                      <Button
                        className="w-full"
                        onClick={() => createAppMutation.mutate()}
                        disabled={!createAppForm.appName || createAppMutation.isPending}
                      >
                        {createAppMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Create Application
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {appsLoading ? (
                <PageLoading rows={4} />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Client ID</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {appsList.map((app: Record<string, unknown>) => (
                          <TableRow key={String(app.id)}>
                            <TableCell className="font-medium">{String(app.appName)}</TableCell>
                            <TableCell>{String(app.appType)}</TableCell>
                            <TableCell>
                              <Badge variant={statusBadgeVariant(String(app.status))}>{String(app.status)}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{String(app.clientId || '-')}</TableCell>
                            <TableCell>{app.createdAt ? new Date(String(app.createdAt)).toLocaleDateString() : '-'}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="sm" onClick={() => openDetailDialog(app)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => suspendAppMutation.mutate(app.id as number)}
                                  disabled={String(app.status) !== 'active'}
                                >
                                  <Pause className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => revokeAppMutation.mutate(app.id as number)}
                                  disabled={String(app.status) === 'revoked'}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => rotateSecretMutation.mutate(app.id as number)}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                                {(String(app.status) === 'suspended' || String(app.status) === 'revoked') && (
                                  <Button variant="outline" size="sm" onClick={() => activateAppMutation.mutate(app.id as number)}>
                                    <Check className="h-3 w-3 mr-1" /> Activate
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {appsList.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No applications found. Create one to get started.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Application Details</DialogTitle>
                  </DialogHeader>
                  {appDetail ? (
                    <ScrollArea className="max-h-[60vh]" aria-label="Scrollable content">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="text-muted-foreground">Client ID</Label>
                            <p className="font-mono text-sm">{String(appDetail.clientId || '-')}</p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Status</Label>
                            <p><Badge variant={statusBadgeVariant(String(appDetail.status))}>{String(appDetail.status)}</Badge></p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Type</Label>
                            <p>{String(appDetail.appType)}</p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Jurisdiction</Label>
                            <p>{String(appDetail.jurisdiction || '-')}</p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Rate Limit</Label>
                            <p>{String(appDetail.rateLimitPerMinute || '-')}/min</p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Created</Label>
                            <p>{appDetail.createdAt ? new Date(String(appDetail.createdAt)).toLocaleString() : '-'}</p>
                          </div>
                        </div>
                        <Separator />
                        <div>
                          <Label>Update Name</Label>
                          <Input
                            value={String(updateForm.appName || '')}
                            onChange={(e) => setUpdateForm(f => ({ ...f, appName: e.target.value }))}
                          />
                        </div>
                        <div>
                          <Label>Update Description</Label>
                          <Textarea
                            value={String(updateForm.description || '')}
                            onChange={(e) => setUpdateForm(f => ({ ...f, description: e.target.value }))}
                          />
                        </div>
                        <Button
                          onClick={() => detailAppId && updateAppMutation.mutate({ appId: detailAppId, updates: updateForm })}
                          disabled={updateAppMutation.isPending}
                        >
                          {updateAppMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Save Changes
                        </Button>
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          </TabsContent>

          <TabsContent value="api-keys">
            <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                {appSelectDropdown}
                {selectedAppId && (
                  <Dialog open={createKeyOpen} onOpenChange={(open) => { setCreateKeyOpen(open); if (!open) { setNewlyCreatedKey(null); setKeyCopied(false); } }}>
                    <DialogTrigger asChild aria-label="Open dialog">
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Generate API Key
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>{newlyCreatedKey ? 'API Key Created' : 'Generate API Key'}</DialogTitle>
                      </DialogHeader>
                      {newlyCreatedKey ? (
                        <div className="space-y-4">
                          <Alert role="alert">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              Save this key now — it won't be shown again.
                            </AlertDescription>
                          </Alert>
                          <div className="flex items-center gap-2">
                            <Input value={newlyCreatedKey} readOnly className="font-mono text-xs" />
                            <Button variant="outline" size="sm" onClick={handleCopyKey}>
                              {keyCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <Label>Key Name *</Label>
                            <Input
                              value={createKeyForm.name}
                              onChange={(e) => setCreateKeyForm(f => ({ ...f, name: e.target.value }))}
                              placeholder="Production API Key"
                            />
                          </div>
                          <div>
                            <Label>Scopes</Label>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                              {AVAILABLE_SCOPES.map(scope => (
                                <div key={scope} className="flex items-center gap-2">
                                  <Checkbox
                                    id={`scope-${scope}`}
                                    checked={createKeyForm.scopes.includes(scope)}
                                    onCheckedChange={() => toggleScope(scope)}
                                  />
                                  <Label htmlFor={`scope-${scope}`} className="text-sm font-mono">{scope}</Label>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label>Expires At (optional)</Label>
                            <Input
                              type="date"
                              value={createKeyForm.expiresAt}
                              onChange={(e) => setCreateKeyForm(f => ({ ...f, expiresAt: e.target.value }))}
                            />
                          </div>
                          <Button
                            className="w-full"
                            onClick={() => createKeyMutation.mutate()}
                            disabled={!createKeyForm.name || createKeyMutation.isPending}
                          >
                            {createKeyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Generate Key
                          </Button>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                )}
              </div>

              {!selectedAppId ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    Select an application to manage its API keys.
                  </CardContent>
                </Card>
              ) : keysLoading ? (
                <PageLoading rows={4} />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Scopes</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Last Used</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(Array.isArray(apiKeys) ? apiKeys : []).map((key: Record<string, unknown>) => (
                          <TableRow key={String(key.id)}>
                            <TableCell className="font-medium">{String(key.name)}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {(Array.isArray(key.scopes) ? key.scopes : []).map((s: string) => (
                                  <Badge key={s} variant="outline" className="text-xs" role="status">{s}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={String(key.status) === 'active' ? 'default' : 'destructive'}>
                                {String(key.status)}
                              </Badge>
                            </TableCell>
                            <TableCell>{key.createdAt ? new Date(String(key.createdAt)).toLocaleDateString() : '-'}</TableCell>
                            <TableCell>{key.lastUsedAt ? new Date(String(key.lastUsedAt)).toLocaleDateString() : 'Never'}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => revokeKeyMutation.mutate(key.id as number)}
                                disabled={String(key.status) === 'revoked'}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                              {!key.isActive && (
                                <Button variant="outline" size="sm" onClick={() => activateKeyMutation.mutate(key.id as number)}>
                                  <Check className="h-3 w-3 mr-1" /> Activate
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!Array.isArray(apiKeys) || apiKeys.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No API keys found. Generate one to get started.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="agents">
            <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                {appSelectDropdown}
                {selectedAppId && (
                  <Dialog open={assignAgentsOpen} onOpenChange={setAssignAgentsOpen}>
                    <DialogTrigger asChild aria-label="Open dialog">
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Assign Agents
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Assign Agents</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Agent IDs (comma-separated)</Label>
                          <Textarea
                            value={agentIdsInput}
                            onChange={(e) => setAgentIdsInput(e.target.value)}
                            placeholder="agent-1, agent-2, agent-3"
                          />
                        </div>
                        <Button
                          className="w-full"
                          onClick={() => {
                            const agents = agentIdsInput.split(',').map(s => s.trim()).filter(Boolean);
                            if (agents.length > 0) assignAgentsMutation.mutate(agents);
                          }}
                          disabled={!agentIdsInput.trim() || assignAgentsMutation.isPending}
                        >
                          {assignAgentsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Assign Agents
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>

              {!selectedAppId ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    Select an application to manage its agents.
                  </CardContent>
                </Card>
              ) : agentsLoading ? (
                <PageLoading rows={4} />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Agent ID</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Assigned At</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(Array.isArray(assignedAgents) ? assignedAgents : []).map((agent: Record<string, unknown>) => (
                          <TableRow key={String(agent.agentId || agent.id)}>
                            <TableCell className="font-mono">{String(agent.agentId || agent.id)}</TableCell>
                            <TableCell>
                              <Badge variant="default" role="status">{String(agent.status || 'assigned')}</Badge>
                            </TableCell>
                            <TableCell>{agent.assignedAt || agent.createdAt ? new Date(String(agent.assignedAt || agent.createdAt)).toLocaleDateString() : '-'}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeAgentMutation.mutate(String(agent.agentId || agent.id))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!Array.isArray(assignedAgents) || assignedAgents.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                              No agents assigned. Assign agents to this application.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="usage">
            <div className="space-y-6">
              <div className="flex items-center gap-4 flex-wrap">
                {appSelectDropdown}
                <Select value={usagePeriod} onValueChange={setUsagePeriod} aria-label="Select option">
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Last 24 Hours</SelectItem>
                    <SelectItem value="week">Last 7 Days</SelectItem>
                    <SelectItem value="month">Last 30 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!selectedAppId ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    Select an application to view usage analytics.
                  </CardContent>
                </Card>
              ) : usageLoading ? (
                <PageLoading rows={5} />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Request Count</CardDescription>
                        <CardTitle className="text-2xl">{usageData?.requestCount?.toLocaleString() ?? 0}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Zap className="h-5 w-5 text-gold-500" />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Total Tokens</CardDescription>
                        <CardTitle className="text-2xl">{usageData?.totalTokensUsed?.toLocaleString() ?? 0}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Coins className="h-5 w-5" style={{ color: '#152448' }} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Estimated Cost</CardDescription>
                        <CardTitle className="text-2xl">${usageData?.totalEstimatedCost ?? '0.00'}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <BarChart3 className="h-5 w-5 text-gold-500" />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Avg Latency</CardDescription>
                        <CardTitle className="text-2xl">{usageData?.avgLatencyMs ?? usageData?.averageLatency ?? '-'}ms</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Clock className="h-5 w-5 text-orange-500" />
                      </CardContent>
                    </Card>
                  </div>

                  {usageData?.breakdown && Array.isArray(usageData.breakdown) && usageData.breakdown.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Usage Breakdown</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Agent</TableHead>
                              <TableHead>Requests</TableHead>
                              <TableHead>Tokens</TableHead>
                              <TableHead>Cost</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {usageData.breakdown.map((item: Record<string, unknown>, idx: number) => (
                              <TableRow key={idx}>
                                <TableCell>{String(item.agentId || item.agent || '-')}</TableCell>
                                <TableCell>{(item.requestCount as number)?.toLocaleString() ?? '-'}</TableCell>
                                <TableCell>{(item.tokensUsed as number)?.toLocaleString() ?? '-'}</TableCell>
                                <TableCell>${String(item.estimatedCost ?? '-')}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}