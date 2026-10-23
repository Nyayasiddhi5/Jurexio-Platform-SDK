/**
 * User Profile — Security Settings, 2FA Setup, Session Management
 * Tabs: Profile / Security (TOTP 2FA) / Sessions
 * Jurexio Enterprise Platform 1.0.0 — NEVER bump version.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { PageLoading } from '@/components/ui/page-loading';
import {
  User, Shield, Monitor, Save, RefreshCw, LogOut,
  Smartphone, CheckCircle, AlertTriangle, Copy, Eye, EyeOff,
  Globe, Clock, Lock, Key, Trash2, Camera,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
// ─── Types ───────────────────────────────────────────────────────────────────

interface UserSession {
  id: string;
  deviceName: string;
  ipAddress: string;
  location: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
  isCurrent: boolean;
}

interface TwoFactorStatus {
  enabled: boolean;
  backupCodesRemaining: number;
  lastVerified?: string;
  qrCodeUrl?: string;
  secret?: string;
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const u = user as { id?: string; name?: string; email?: string; role?: string; avatar?: string } | null;
  const [name, setName] = useState(u?.name ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest('PUT', nv('user/profile'), { name });
      const stored = JSON.parse(localStorage.getItem('user') ?? '{}');
      localStorage.setItem('user', JSON.stringify({ ...stored, name }));
      toast({ title: 'Profile updated successfully' });
    } catch {
      toast({ title: 'Failed to update profile', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const roleDisplay: Record<string, { label: string; color: string }> = {
    super_admin:      { label: 'Super Admin',       color: 'bg-red-50 text-red-700 border-red-200' },
    enterprise_admin: { label: 'Enterprise Admin',  color: 'bg-purple-50 text-purple-700 border-purple-200' },
    org_admin:        { label: 'Org Admin',         color: 'bg-amber-50 text-amber-700 border-amber-200' },
    manager:          { label: 'Manager',           color: 'bg-blue-50 text-blue-700 border-blue-200' },
    senior_analyst:   { label: 'Sr. Analyst',       color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    analyst:          { label: 'Analyst',           color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    developer:        { label: 'Developer',         color: 'bg-green-50 text-green-700 border-green-200' },
    user:             { label: 'User',              color: 'bg-slate-100 text-slate-700 border-slate-300' },
  };
  const role = roleDisplay[u?.role ?? 'user'] ?? roleDisplay['user'];

  return (
    <div className="space-y-5 max-w-lg">
      {/* Avatar section */}
      <Card className="bg-white border-slate-200">
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#152448] to-[#1a4a9a] flex items-center justify-center text-xl font-bold text-[#C7B15B]">
                {(u?.name ?? u?.email ?? 'U').substring(0, 2).toUpperCase()}
              </div>
              <button className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-slate-200 hover:bg-slate-600 border border-slate-300 flex items-center justify-center transition-colors" aria-label="Change avatar">
                <Camera className="w-2.5 h-2.5 text-slate-700" />
              </button>
            </div>
            <div>
              <div className="text-base font-semibold text-slate-800">{u?.name ?? u?.email}</div>
              <div className="text-xs text-slate-700 mb-1.5">{u?.email}</div>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', role.color)}>{role.label}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit form */}
      <Card className="bg-white border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-slate-800">Personal Information</CardTitle>
          <CardDescription className="text-xs text-slate-700">Update your display name and contact details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs text-slate-600 mb-1.5 block">Display Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className="bg-slate-50 border-slate-200 text-slate-800 text-sm"
              placeholder="Your full name"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-600 mb-1.5 block">Email Address</Label>
            <Input
              value={u?.email ?? ''}
              disabled
              className="bg-slate-100/50 border-slate-200 text-slate-700 text-sm cursor-not-allowed"
            />
            <p className="text-[10px] text-slate-600 mt-1">Email cannot be changed. Contact your administrator.</p>
          </div>
          <div>
            <Label className="text-xs text-slate-600 mb-1.5 block">Platform Role</Label>
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-100/50 border border-slate-200 rounded-md">
              <Shield className="w-3.5 h-3.5 text-slate-700" />
              <span className="text-sm text-slate-600">{role.label}</span>
              <span className="text-[10px] text-slate-600 ml-auto">Assigned by org admin</span>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} size="sm" className="bg-[#152448] hover:bg-[#0d3580] text-white">
            {saving ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5 mr-1.5" />Save Changes</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Security / 2FA Tab ───────────────────────────────────────────────────────

function SecurityTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<'idle' | 'setup' | 'verify'>('idle');
  const [code, setCode] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { data, isLoading } = useQuery<{ data: TwoFactorStatus }>({
    queryKey: [nv('user/2fa/status')],
    queryFn: () => apiRequest('GET', nv('user/2fa/status')),
  });
  const tfaStatus = data?.data;

  const setupMutation = useMutation({
    mutationFn: () => apiRequest('POST', nv('user/2fa/setup'), {}),
    onSuccess: () => { setStep('setup'); qc.invalidateQueries({ queryKey: [nv('user/2fa/status')] }); },
    onError:   () => toast({ title: 'Failed to initiate 2FA setup', variant: 'destructive' }),
  });

  const verifyMutation = useMutation({
    mutationFn: (token: string) => apiRequest('POST', nv('user/2fa/verify'), { token }),
    onSuccess: () => {
      setStep('idle'); setCode('');
      toast({ title: '2FA enabled successfully' });
      qc.invalidateQueries({ queryKey: [nv('user/2fa/status')] });
    },
    onError: () => toast({ title: 'Invalid verification code', variant: 'destructive' }),
  });

  const disableMutation = useMutation({
    mutationFn: (token: string) => apiRequest('DELETE', nv('user/2fa'), { token }),
    onSuccess: () => {
      setCode(''); setStep('idle');
      toast({ title: '2FA disabled' });
      qc.invalidateQueries({ queryKey: [nv('user/2fa/status')] });
    },
    onError: () => toast({ title: 'Invalid code — 2FA not disabled', variant: 'destructive' }),
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => apiRequest('PUT', nv('user/password'), { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      toast({ title: 'Password changed successfully' });
    },
    onError: () => toast({ title: 'Password change failed', variant: 'destructive' }),
  });

  const handlePasswordChange = () => {
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) { toast({ title: 'Passwords do not match', variant: 'destructive' }); return; }
    if (newPassword.length < 8) { toast({ title: 'Password must be at least 8 characters', variant: 'destructive' }); return; }
    changePasswordMutation.mutate();
  };

  const setupData = setupMutation.data?.data as { qrCodeUrl?: string; secret?: string } | undefined;

  return (
    <div className="space-y-5 max-w-lg">
      {/* 2FA Card */}
      <Card className="bg-white border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm text-slate-800 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[#C7B15B]" />
                Two-Factor Authentication
              </CardTitle>
              <CardDescription className="text-xs text-slate-700 mt-1">Add an extra layer of security to your account using a TOTP authenticator app</CardDescription>
            </div>
            {!isLoading && (
              <Badge className={cn('text-[10px]', tfaStatus?.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-300')}>
                {tfaStatus?.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <PageLoading rows={2} label="Loading 2FA status" />
          ) : tfaStatus?.enabled ? (
            <div className="space-y-4">
              <Alert className="bg-emerald-50 border-emerald-200">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <AlertDescription className="text-xs text-emerald-700 ml-2">
                  2FA is active. {tfaStatus.backupCodesRemaining} backup codes remaining.
                  {tfaStatus.lastVerified && ` Last verified: ${new Date(tfaStatus.lastVerified).toLocaleDateString()}`}
                </AlertDescription>
              </Alert>
              {step === 'idle' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStep('verify')}
                  className="border-red-700 text-red-400 hover:text-red-300 hover:border-red-600"
                >
                  Disable 2FA
                </Button>
              )}
              {step === 'verify' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">Enter your authenticator app code to confirm disabling 2FA:</p>
                  <div className="flex gap-2">
                    <Input
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit code"
                      maxLength={6}
                      className="bg-slate-50 border-slate-200 text-slate-800 text-sm font-mono w-36"
                    />
                    <Button size="sm" onClick={() => disableMutation.mutate(code)} disabled={code.length < 6 || disableMutation.isPending}
                      className="bg-red-600 hover:bg-red-700 text-white">
                      {disableMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Confirm Disable'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setStep('idle'); setCode(''); }} className="text-slate-600">Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ) : step === 'idle' ? (
            <Button size="sm" onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending} className="bg-[#152448] hover:bg-[#0d3580] text-white">
              {setupMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Setting up…</> : <><Smartphone className="w-3.5 h-3.5 mr-1.5" />Enable 2FA</>}
            </Button>
          ) : step === 'setup' && setupData ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>
              {setupData.qrCodeUrl && (
                <div className="w-36 h-36 bg-white rounded-lg flex items-center justify-center mx-auto p-2">
                  <img src={setupData.qrCodeUrl} alt="2FA QR Code" className="w-full h-full object-contain" />
                </div>
              )}
              {setupData.secret && (
                <div>
                  <p className="text-xs text-slate-700 mb-1">Or enter this manual key:</p>
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                    <code className={cn('text-xs font-mono flex-1', showSecret ? 'text-[#152448]' : 'text-slate-600 select-none')}>
                      {showSecret ? setupData.secret : '•'.repeat(setupData.secret.length)}
                    </code>
                    <button onClick={() => setShowSecret(s => !s)} className="text-slate-700 hover:text-slate-700" aria-label="Toggle secret visibility">
                      {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(setupData.secret!); toast({ title: 'Secret copied' }); }}
                      className="text-slate-700 hover:text-slate-700" aria-label="Copy secret">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-slate-600 mb-2">Enter the 6-digit code from your authenticator app:</p>
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    className="bg-slate-50 border-slate-200 text-slate-800 text-sm font-mono w-32 tracking-widest"
                  />
                  <Button size="sm" onClick={() => verifyMutation.mutate(code)} disabled={code.length < 6 || verifyMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {verifyMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Verify & Enable'}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card className="bg-white border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-slate-800 flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#C7B15B]" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs text-slate-600 mb-1 block">Current Password</Label>
            <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
              className="bg-slate-50 border-slate-200 text-slate-800 text-sm" />
          </div>
          <div>
            <Label className="text-xs text-slate-600 mb-1 block">New Password</Label>
            <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="bg-slate-50 border-slate-200 text-slate-800 text-sm" />
          </div>
          <div>
            <Label className="text-xs text-slate-600 mb-1 block">Confirm New Password</Label>
            <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="bg-slate-50 border-slate-200 text-slate-800 text-sm" />
          </div>
          <Button size="sm" onClick={handlePasswordChange} disabled={changePasswordMutation.isPending || !currentPassword || !newPassword}
            className="bg-[#152448] hover:bg-[#0d3580] text-white">
            {changePasswordMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Changing…</> : <><Key className="w-3.5 h-3.5 mr-1.5" />Change Password</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sessions Tab ─────────────────────────────────────────────────────────────

function SessionsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<{ data: { sessions: UserSession[] } }>({
    queryKey: [nv('user/sessions')],
    queryFn: () => apiRequest('GET', nv('user/sessions')),
    refetchInterval: 30000,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `${NV_BASE}user/sessions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [nv('user/sessions')] });
      toast({ title: 'Session revoked' });
    },
    onError: () => toast({ title: 'Failed to revoke session', variant: 'destructive' }),
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', nv('user/sessions/all')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [nv('user/sessions')] });
      toast({ title: 'All other sessions revoked' });
    },
  });

  const sessions = data?.data?.sessions ?? [];
  const otherSessions = sessions.filter(s => !s.isCurrent);

  const deviceIcon = (ua: string) => {
    if (ua.toLowerCase().includes('mobile') || ua.toLowerCase().includes('android') || ua.toLowerCase().includes('iphone')) return Smartphone;
    return Monitor;
  };

  return (
    <div className="space-y-5 max-w-lg">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Active Sessions</h2>
          <p className="text-xs text-slate-700 mt-0.5">{sessions.length} session{sessions.length !== 1 ? 's' : ''} found across your devices</p>
        </div>
        {otherSessions.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => { if (window.confirm('Revoke all other sessions? You will remain logged in on this device only.')) revokeAllMutation.mutate(); }} disabled={revokeAllMutation.isPending}
            className="border-red-700 text-red-400 hover:text-red-300 hover:border-red-600 text-xs">
            {revokeAllMutation.isPending ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <LogOut className="w-3 h-3 mr-1" />}
            Revoke All Other
          </Button>
        )}
      </div>

      {isLoading ? (
        <PageLoading rows={3} label="Loading sessions" />
      ) : error ? (
        <JrxEmptyState icon={AlertTriangle} title="Could not load sessions" description="Session management requires nv_user_sessions table access." size="sm" />
      ) : sessions.length === 0 ? (
        <JrxEmptyState icon={Monitor} title="No active sessions found" description="Your active sessions will appear here." size="sm" variant="card" />
      ) : (
        <div className="space-y-2">
          {sessions.map(s => {
            const DeviceIcon = deviceIcon(s.userAgent);
            return (
              <Card key={s.id} className={cn('bg-white border-slate-200', s.isCurrent && 'border-[#152448]/50 bg-[#152448]/10')}>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', s.isCurrent ? 'bg-[#152448]/40' : 'bg-slate-100')}>
                    <DeviceIcon className={cn('w-4 h-4', s.isCurrent ? 'text-[#C7B15B]' : 'text-slate-600')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-slate-800 truncate">{s.deviceName || 'Unknown Device'}</span>
                      {s.isCurrent && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px]">Current Session</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-700 flex-wrap">
                      <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{s.ipAddress}</span>
                      {s.location && <span>{s.location}</span>}
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Active {new Date(s.lastActivityAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {!s.isCurrent && (
                    <button
                      onClick={() => {
                        if (window.confirm(`Revoke session on ${s.deviceName || 'this device'}? The user will be logged out from that device.`)) {
                          revokeMutation.mutate(s.id);
                        }
                      }}
                      disabled={revokeMutation.isPending}
                      className="flex-shrink-0 p-1.5 rounded-lg text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      aria-label={`Revoke session on ${s.deviceName}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UserProfile() {
  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E]">
      {/* Page Header */}
      <div className="border-b border-slate-200/60 px-6 py-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#152448] to-[#1a4a9a] flex items-center justify-center">
            <User className="w-4 h-4 text-[#C7B15B]" />
          </div>
          <h1 className="text-xl font-bold text-[#152448]">Profile & Security</h1>
        </div>
        <p className="text-sm text-slate-700">Manage your account, security settings, and active sessions</p>
      </div>

      <div className="p-6">
        <Tabs defaultValue="profile">
          <TabsList className="bg-white border border-slate-200 mb-6">
            <TabsTrigger value="profile" className="data-[state=active]:bg-[#152448] data-[state=active]:text-white text-xs gap-1.5">
              <User className="w-3.5 h-3.5" />Profile
            </TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-[#152448] data-[state=active]:text-white text-xs gap-1.5">
              <Shield className="w-3.5 h-3.5" />Security & 2FA
            </TabsTrigger>
            <TabsTrigger value="sessions" className="data-[state=active]:bg-[#152448] data-[state=active]:text-white text-xs gap-1.5">
              <Monitor className="w-3.5 h-3.5" />Active Sessions
            </TabsTrigger>
          </TabsList>
          <TabsContent value="profile"><ProfileTab /></TabsContent>
          <TabsContent value="security"><SecurityTab /></TabsContent>
          <TabsContent value="sessions"><SessionsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
