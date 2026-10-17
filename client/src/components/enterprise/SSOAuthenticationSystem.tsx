// Phase 3 - Enterprise SSO Authentication System
// Principal Engineer & Release Captain Implementation
// Builds on existing auth with enterprise-grade SSO

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, 
  Key, 
  Users, 
  Settings, 
  CheckCircle, 
  AlertTriangle,
  Clock,
  Building,
  Smartphone,
  Mail,
  Lock,
  UserCheck,
  Globe
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface SSOProvider {
  id: string;
  name: string;
  type: 'oidc' | 'saml' | 'oauth2';
  icon: string;
  status: 'active' | 'inactive' | 'error';
  userCount: number;
  lastSync: string;
  config: {
    clientId?: string;
    issuerUrl?: string;
    metadataUrl?: string;
    certificateUrl?: string;
    autoProvisioning: boolean;
    defaultRole: string;
    attributeMapping: Record<string, string>;
  };
}

interface UserRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  userCount: number;
  isDefault: boolean;
}

interface MFASettings {
  enabled: boolean;
  methods: Array<'totp' | 'sms' | 'email' | 'backup_codes'>;
  requireForRoles: string[];
  gracePeriod: number;
  backupCodeCount: number;
}

interface SSOAuthenticationSystemProps {
  organizationId?: string;
  className?: string;
}

export const SSOAuthenticationSystem: React.FC<SSOAuthenticationSystemProps> = ({
  organizationId,
  className
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState('providers');
  const [selectedProvider, setSelectedProvider] = useState<SSOProvider | null>(null);
  const [providerForm, setProviderForm] = useState({
    name: '',
    type: 'oidc' as const,
    clientId: '',
    clientSecret: '',
    issuerUrl: '',
    metadataUrl: '',
    autoProvisioning: true,
    defaultRole: 'user'
  });

  // Fetch SSO providers
  const { data: providersData, isLoading: providersLoading } = useQuery({
    queryKey: ['/api/enterprise/sso/providers', organizationId],
    queryFn: async () => {
      return await apiRequest(`/api/enterprise/sso/providers?organizationId=${organizationId}`);
    }
  });

  // Fetch user roles
  const { data: rolesData } = useQuery({
    queryKey: ['/api/enterprise/roles', organizationId],
    queryFn: async () => {
      return await apiRequest(`/api/enterprise/roles?organizationId=${organizationId}`);
    }
  });

  // Fetch MFA settings
  const { data: mfaData } = useQuery({
    queryKey: ['/api/enterprise/mfa/settings', organizationId],
    queryFn: async () => {
      return await apiRequest(`/api/enterprise/mfa/settings?organizationId=${organizationId}`);
    }
  });

  // Provider creation mutation
  const createProviderMutation = useMutation({
    mutationFn: async (providerData: typeof providerForm) => {
      return await apiRequest('/api/enterprise/sso/providers', {
        method: 'POST',
        body: JSON.stringify({
          ...providerData,
          organizationId,
          attributeMapping: {
            email: 'email',
            firstName: 'given_name',
            lastName: 'family_name',
            role: 'groups'
          }
        })
      });
    },
    onSuccess: () => {
      toast({
        title: 'SSO Provider Created',
        description: 'SSO provider has been configured successfully'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/enterprise/sso/providers'] });
      setProviderForm({
        name: '',
        type: 'oidc',
        clientId: '',
        clientSecret: '',
        issuerUrl: '',
        metadataUrl: '',
        autoProvisioning: true,
        defaultRole: 'user'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Configuration Failed',
        description: error.message || 'Please check your SSO configuration',
        variant: 'destructive'
      });
    }
  });

  // Test SSO connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return await apiRequest('/api/enterprise/sso/test', {
        method: 'POST',
        body: JSON.stringify({ providerId, organizationId })
      });
    },
    onSuccess: (data) => {
      toast({
        title: 'Connection Test',
        description: data.success ? 'SSO connection successful' : 'Connection failed: ' + data.error
      });
    }
  });

  // MFA settings mutation
  const updateMFAMutation = useMutation({
    mutationFn: async (mfaSettings: Partial<MFASettings>) => {
      return await apiRequest('/api/enterprise/mfa/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ...mfaSettings,
          organizationId
        })
      });
    },
    onSuccess: () => {
      toast({
        title: 'MFA Settings Updated',
        description: 'Multi-factor authentication settings have been saved'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/enterprise/mfa/settings'] });
    }
  });

  const providers = providersData?.providers || [];
  const roles = rolesData?.roles || [];
  const mfaSettings = mfaData?.settings || {
    enabled: false,
    methods: ['totp'],
    requireForRoles: [],
    gracePeriod: 24,
    backupCodeCount: 10
  };

  const handleCreateProvider = useCallback(() => {
    if (!providerForm.name || !providerForm.clientId) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields',
        variant: 'destructive'
      });
      return;
    }
    createProviderMutation.mutate(providerForm);
  }, [providerForm, createProviderMutation]);

  const getProviderIcon = (type: string) => {
    switch (type) {
      case 'oidc': return <Globe className="w-5 h-5" />;
      case 'saml': return <Building className="w-5 h-5" />;
      case 'oauth2': return <Key className="w-5 h-5" />;
      default: return <Shield className="w-5 h-5" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-gray-100 text-gray-800';
      case 'error': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className={className}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Enterprise Authentication</h2>
            <p className="text-muted-foreground">
              Configure SSO providers, user roles, and multi-factor authentication
            </p>
          </div>
          <Badge variant="secondary" className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Enterprise Security
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="providers">SSO Providers</TabsTrigger>
            <TabsTrigger value="roles">User Roles</TabsTrigger>
            <TabsTrigger value="mfa">Multi-Factor Auth</TabsTrigger>
            <TabsTrigger value="audit">Audit & Logs</TabsTrigger>
          </TabsList>

          {/* SSO Providers Tab */}
          <TabsContent value="providers" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Provider List */}
              <Card>
                <CardHeader>
                  <CardTitle>Active SSO Providers</CardTitle>
                  <CardDescription>
                    Manage enterprise identity provider integrations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {providersLoading ? (
                    <div className="space-y-3">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                      ))}
                    </div>
                  ) : providers.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Building className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No SSO providers configured</p>
                      <p className="text-sm">Add your first enterprise provider</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {providers.map((provider: SSOProvider) => (
                        <div
                          key={provider.id}
                          className="flex items-center justify-between p-4 border rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                          onClick={() => setSelectedProvider(provider)}
                        >
                          <div className="flex items-center gap-3">
                            {getProviderIcon(provider.type)}
                            <div>
                              <div className="font-medium">{provider.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {provider.type.toUpperCase()} • {provider.userCount} users
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Badge className={getStatusColor(provider.status)}>
                              {provider.status}
                            </Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                testConnectionMutation.mutate(provider.id);
                              }}
                              disabled={testConnectionMutation.isPending}
                            >
                              Test
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Add Provider Form */}
              <Card>
                <CardHeader>
                  <CardTitle>Add SSO Provider</CardTitle>
                  <CardDescription>
                    Configure a new enterprise identity provider
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Provider Name</Label>
                    <Input
                      placeholder="e.g., Company Active Directory"
                      value={providerForm.name}
                      onChange={(e) => setProviderForm(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Provider Type</Label>
                    <Select
                      value={providerForm.type}
                      onValueChange={(value: any) => setProviderForm(prev => ({ ...prev, type: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="oidc">OpenID Connect (OIDC)</SelectItem>
                        <SelectItem value="saml">SAML 2.0</SelectItem>
                        <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {(providerForm.type === 'oidc' || providerForm.type === 'oauth2') && (
                    <>
                      <div className="space-y-2">
                        <Label>Issuer URL</Label>
                        <Input
                          placeholder="https://login.company.com"
                          value={providerForm.issuerUrl}
                          onChange={(e) => setProviderForm(prev => ({ ...prev, issuerUrl: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Client ID</Label>
                        <Input
                          placeholder="your-client-id"
                          value={providerForm.clientId}
                          onChange={(e) => setProviderForm(prev => ({ ...prev, clientId: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Client Secret</Label>
                        <Input
                          type="password"
                          placeholder="your-client-secret"
                          value={providerForm.clientSecret}
                          onChange={(e) => setProviderForm(prev => ({ ...prev, clientSecret: e.target.value }))}
                        />
                      </div>
                    </>
                  )}

                  {providerForm.type === 'saml' && (
                    <div className="space-y-2">
                      <Label>Metadata URL</Label>
                      <Input
                        placeholder="https://login.company.com/metadata"
                        value={providerForm.metadataUrl}
                        onChange={(e) => setProviderForm(prev => ({ ...prev, metadataUrl: e.target.value }))}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Default Role</Label>
                    <Select
                      value={providerForm.defaultRole}
                      onValueChange={(value) => setProviderForm(prev => ({ ...prev, defaultRole: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((role: UserRole) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-provisioning"
                      checked={providerForm.autoProvisioning}
                      onCheckedChange={(checked) => setProviderForm(prev => ({
                        ...prev,
                        autoProvisioning: checked
                      }))}
                    />
                    <Label htmlFor="auto-provisioning">
                      Automatically provision new users
                    </Label>
                  </div>

                  <Button
                    onClick={handleCreateProvider}
                    disabled={createProviderMutation.isPending}
                    className="w-full"
                  >
                    {createProviderMutation.isPending ? 'Creating...' : 'Create SSO Provider'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* User Roles Tab */}
          <TabsContent value="roles" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {roles.map((role: UserRole) => (
                <Card key={role.id} className={role.isDefault ? 'border-primary' : ''}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{role.name}</span>
                      {role.isDefault && (
                        <Badge variant="default">Default</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>{role.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium mb-2">Permissions</div>
                        <div className="flex flex-wrap gap-1">
                          {role.permissions.slice(0, 3).map((permission, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {permission}
                            </Badge>
                          ))}
                          {role.permissions.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{role.permissions.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Users</span>
                        <span className="font-medium">{role.userCount}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* MFA Tab */}
          <TabsContent value="mfa" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="w-5 h-5" />
                  Multi-Factor Authentication
                </CardTitle>
                <CardDescription>
                  Configure additional security layers for user authentication
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="mfa-enabled"
                    checked={mfaSettings.enabled}
                    onCheckedChange={(checked) => updateMFAMutation.mutate({ enabled: checked })}
                  />
                  <Label htmlFor="mfa-enabled" className="font-medium">
                    Enable Multi-Factor Authentication
                  </Label>
                </div>

                {mfaSettings.enabled && (
                  <>
                    <div className="space-y-4">
                      <div>
                        <Label className="text-sm font-medium">Available Methods</Label>
                        <div className="grid grid-cols-2 gap-4 mt-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="totp"
                              checked={mfaSettings.methods.includes('totp')}
                              onChange={(e) => {
                                const methods = e.target.checked
                                  ? [...mfaSettings.methods, 'totp']
                                  : mfaSettings.methods.filter((m: string) => m !== 'totp');
                                updateMFAMutation.mutate({ methods });
                              }}
                            />
                            <Label htmlFor="totp">Authenticator App (TOTP)</Label>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="sms"
                              checked={mfaSettings.methods.includes('sms')}
                              onChange={(e) => {
                                const methods = e.target.checked
                                  ? [...mfaSettings.methods, 'sms']
                                  : mfaSettings.methods.filter((m: string) => m !== 'sms');
                                updateMFAMutation.mutate({ methods });
                              }}
                            />
                            <Label htmlFor="sms">SMS Text Message</Label>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="email"
                              checked={mfaSettings.methods.includes('email')}
                              onChange={(e) => {
                                const methods = e.target.checked
                                  ? [...mfaSettings.methods, 'email']
                                  : mfaSettings.methods.filter((m: string) => m !== 'email');
                                updateMFAMutation.mutate({ methods });
                              }}
                            />
                            <Label htmlFor="email">Email Verification</Label>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="backup"
                              checked={mfaSettings.methods.includes('backup_codes')}
                              onChange={(e) => {
                                const methods = e.target.checked
                                  ? [...mfaSettings.methods, 'backup_codes']
                                  : mfaSettings.methods.filter((m: string) => m !== 'backup_codes');
                                updateMFAMutation.mutate({ methods });
                              }}
                            />
                            <Label htmlFor="backup">Backup Codes</Label>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Require MFA for Roles</Label>
                        <div className="flex flex-wrap gap-2">
                          {roles.map((role: UserRole) => (
                            <div key={role.id} className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                id={`mfa-role-${role.id}`}
                                checked={mfaSettings.requireForRoles.includes(role.id)}
                                onChange={(e) => {
                                  const requireForRoles = e.target.checked
                                    ? [...mfaSettings.requireForRoles, role.id]
                                    : mfaSettings.requireForRoles.filter((r: string) => r !== role.id);
                                  updateMFAMutation.mutate({ requireForRoles });
                                }}
                              />
                              <Label htmlFor={`mfa-role-${role.id}`} className="text-sm">
                                {role.name}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Grace Period (hours)</Label>
                        <Input
                          type="number"
                          value={mfaSettings.gracePeriod}
                          onChange={(e) => updateMFAMutation.mutate({ 
                            gracePeriod: parseInt(e.target.value) || 24 
                          })}
                          className="w-32"
                        />
                        <p className="text-xs text-muted-foreground">
                          Time before requiring MFA again on trusted devices
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit & Logs Tab */}
          <TabsContent value="audit" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="w-5 h-5" />
                  Authentication Audit Log
                </CardTitle>
                <CardDescription>
                  Monitor authentication events and security incidents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert>
                  <Lock className="h-4 w-4" />
                  <AlertDescription>
                    Authentication audit logging is active. All login attempts, SSO connections, 
                    and security events are recorded for compliance and security monitoring.
                  </AlertDescription>
                </Alert>
                
                <div className="mt-4 text-center py-8 text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Audit log interface will be available in full implementation</p>
                  <p className="text-sm">Contact support for current log access</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SSOAuthenticationSystem;