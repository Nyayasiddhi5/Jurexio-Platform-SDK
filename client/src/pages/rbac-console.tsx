import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Shield, CheckCircle, XCircle, Users, Lock, Activity, Search, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { formatDistanceToNow } from 'date-fns';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
const ROLES = [
  { id: 'super_admin', label: 'Super Admin', level: 9, color: 'bg-red-100 text-red-800', desc: 'Tier-2 — full platform, global registry/models/keys. Jurexio internal only' },
  { id: 'platform_admin', label: 'Platform Admin', level: 8, color: 'bg-orange-100 text-orange-800', desc: 'Tier-1 — manages ONE platform\'s orgs, users, SDK keys & rate-limits (scoped to their platform)' },
  { id: 'enterprise_admin', label: 'Enterprise Admin', level: 7, color: 'bg-purple-100 text-purple-800', desc: 'Full org access + user management + billing' },
  { id: 'manager', label: 'Manager', level: 6, color: 'bg-blue-100 text-blue-800', desc: 'Team + case management' },
  { id: 'operator', label: 'Operator', level: 5, color: 'bg-cyan-100 text-cyan-800', desc: 'Day-to-day operational access' },
  { id: 'analyst', label: 'Analyst', level: 4, color: 'bg-green-100 text-green-800', desc: 'Read + analytics' },
  { id: 'developer', label: 'Developer', level: 3, color: 'bg-yellow-100 text-yellow-800', desc: 'API + SDK + skills access' },
  { id: 'user', label: 'User', level: 2, color: 'bg-gray-100 text-gray-700', desc: 'Own resources only' },
  { id: 'readonly', label: 'Read Only', level: 1, color: 'bg-slate-100 text-slate-600', desc: 'View-only, no modifications' },
];

export default function RBACConsole() {
  const { toast } = useToast();
  const [checkRole, setCheckRole] = useState('');
  const [checkResource, setCheckResource] = useState('');
  const [checkAction, setCheckAction] = useState('');
  const [checkResult, setCheckResult] = useState<any>(null);
  const [auditRoleFilter, setAuditRoleFilter] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: [nv('rbac/roles')],
    queryFn: () => apiRequest('GET', nv('rbac/roles')),
  });

  const { data: audit, isLoading: auditLoading, refetch: refetchAudit } = useQuery({
    queryKey: [nv('rbac/audit-log'), auditRoleFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '50' });
      if (auditRoleFilter && auditRoleFilter !== 'all') params.set('role', auditRoleFilter);
      return apiRequest('GET', `${nv('rbac/audit-log')}?${params}`);
    },
    refetchInterval: 30000,
  });

  const { data: health } = useQuery({
    queryKey: [nv('rbac/health')],
    queryFn: () => apiRequest('GET', nv('rbac/health')),
  });

  const checkAccess = useMutation({
    mutationFn: (data: any) => apiRequest('POST', nv('rbac/check'), data),
    onSuccess: (data) => setCheckResult(data?.data),
    onError: () => toast({ title: 'Access check failed', variant: 'destructive' }),
  });

  const handleCheck = () => {
    if (!checkRole || !checkResource || !checkAction) {
      toast({ title: 'All fields required for access check', variant: 'destructive' }); return;
    }
    checkAccess.mutate({ role: checkRole, resource: checkResource, action: checkAction });
  };

  const auditArr = audit?.data?.entries || [];
  const filteredAudit = auditSearch
    ? auditArr.filter((e: any) => JSON.stringify(e).toLowerCase().includes(auditSearch.toLowerCase()))
    : auditArr;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            RBAC + ABAC Console
          </h1>
          <p className="text-muted-foreground text-sm mt-1">8-role Zero Trust hierarchy — Role-Based + Attribute-Based Access Control</p>
        </div>
        <Badge className={`${health?.data?.status === 'healthy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {health?.data?.status || 'checking...'}
        </Badge>
      </div>

      <Tabs defaultValue="roles">
        <TabsList aria-label="Navigation tabs">
          <TabsTrigger value="roles" aria-label="roles tab"><Users className="h-4 w-4 mr-1" />Role Matrix</TabsTrigger>
          <TabsTrigger value="check" aria-label="check tab"><Lock className="h-4 w-4 mr-1" />Access Check</TabsTrigger>
          <TabsTrigger value="audit" aria-label="audit tab"><Activity className="h-4 w-4 mr-1" />Audit Log</TabsTrigger>
        </TabsList>

        {/* Role Matrix */}
        <TabsContent value="roles" className="mt-4">
          <div className="space-y-3">
            {(roles?.data?.roles || ROLES).map((role: any, idx: number) => {
              const staticRole = ROLES.find(r => r.id === (role.id || role.role));
              return (
                <Card key={role.id || role.role || idx}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Badge className={`${staticRole?.color || 'bg-gray-100'} text-sm px-3 py-1`}>
                          {staticRole?.label || role.name || role.role}
                        </Badge>
                        <div>
                          <div className="text-sm font-medium">Level {staticRole?.level || idx + 1} Access</div>
                          <div className="text-xs text-muted-foreground">{staticRole?.desc || role.description || ''}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {(role.permissions || []).slice(0, 8).map((perm: string) => (
                          <Badge key={perm} variant="outline" className="text-xs" role="status">{perm}</Badge>
                        ))}
                        {(role.permissions || []).length > 8 && (
                          <Badge variant="secondary" className="text-xs" role="status">+{(role.permissions || []).length - 8} more</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {rolesLoading && ROLES.map(role => (
              <Card key={role.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Badge className={`${role.color} text-sm px-3 py-1`}>{role.label}</Badge>
                    <div>
                      <div className="text-sm font-medium">Level {role.level} Access</div>
                      <div className="text-xs text-muted-foreground">{role.desc}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Access Check */}
        <TabsContent value="check" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Check Access Permission</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Role</Label>
                  <Select value={checkRole} onValueChange={setCheckRole} aria-label="Select option">
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select role..." /></SelectTrigger>
                    <SelectContent>{ROLES.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Resource</Label>
                  <Select value={checkResource} onValueChange={setCheckResource} aria-label="Select option">
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select resource..." /></SelectTrigger>
                    <SelectContent>
                      {['agents', 'contracts', 'filings', 'cases', 'users', 'analytics', 'billing', 'skills', 'admin', 'rbac', 'regulatory'].map(r => (
                        <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Action</Label>
                  <Select value={checkAction} onValueChange={setCheckAction} aria-label="Select option">
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select action..." /></SelectTrigger>
                    <SelectContent>
                      {['read', 'write', 'delete', 'admin', 'execute', 'export'].map(a => (
                        <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCheck} className="w-full" disabled={checkAccess.isPending}>
                  {checkAccess.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
                  Check Access
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
              <CardContent>
                {checkResult ? (
                  <div className="space-y-4">
                    <div className={`flex items-center gap-3 p-4 rounded-lg ${checkResult.allowed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                      {checkResult.allowed
                        ? <CheckCircle className="h-8 w-8 text-green-600" />
                        : <XCircle className="h-8 w-8 text-red-600" />}
                      <div>
                        <div className={`text-xl font-bold ${checkResult.allowed ? 'text-green-700' : 'text-red-700'}`}>
                          {checkResult.allowed ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {checkRole} → {checkResource} → {checkAction}
                        </div>
                      </div>
                    </div>
                    {checkResult.reason && (
                      <Alert role="alert"><AlertDescription className="text-sm">{checkResult.reason}</AlertDescription></Alert>
                    )}
                    {checkResult.conditions && (
                      <div>
                        <h4 className="font-semibold text-sm mb-2">Conditions Applied</h4>
                        <div className="space-y-1">
                          {checkResult.conditions.map((c: string, i: number) => (
                            <div key={i} className="text-xs flex items-center gap-2">
                              <CheckCircle className="h-3 w-3 text-blue-500" />{c}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p>Run an access check to see results here.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Audit Log */}
        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Access Audit Log</CardTitle>
                <div className="flex gap-2">
                  <Input placeholder="Search audit..." value={auditSearch} onChange={e => setAuditSearch(e.target.value)}
                    className="w-48 h-8 text-sm" prefix={<Search className="h-4 w-4" />} />
                  <Select value={auditRoleFilter} onValueChange={setAuditRoleFilter} aria-label="Select option">
                    <SelectTrigger className="w-32 h-8 text-sm"><SelectValue placeholder="All roles" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All roles</SelectItem>
                      {ROLES.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => refetchAudit()}><RefreshCw className="h-4 w-4" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-96" aria-label="Scrollable content">
                {auditLoading ? (
                  <div className="p-4 space-y-2" data-testid="loading-audit">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : filteredAudit.length === 0 ? (
                  <NyvEmptyState icon={Activity} title="No audit entries found" description="Audit log entries will appear here as access checks occur." />
                ) : (
                  <div className="divide-y text-sm">
                    {filteredAudit.map((entry: any, idx: number) => (
                      <div key={entry.id || idx} className="p-3 hover:bg-muted/50 flex items-center gap-3">
                        {entry.allowed || entry.action === 'granted'
                          ? <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                          : <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs" role="status">{entry.role || entry.actorRole}</Badge>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono text-xs">{entry.resource}</span>
                            <span className="text-muted-foreground">:</span>
                            <span className="text-xs">{entry.action}</span>
                          </div>
                          {entry.reason && <div className="text-xs text-muted-foreground truncate">{entry.reason}</div>}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {entry.createdAt ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
