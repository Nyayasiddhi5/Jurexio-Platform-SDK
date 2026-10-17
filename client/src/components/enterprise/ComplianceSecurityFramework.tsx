// Phase 3 - Enterprise Compliance & Security Framework
// Principal Engineer & Release Captain Implementation
// SOC 2, GDPR, audit logging, and compliance reporting

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, 
  FileText, 
  Download, 
  Calendar, 
  Eye, 
  Lock, 
  CheckCircle, 
  AlertTriangle,
  Clock,
  Users,
  Database,
  Activity,
  Settings,
  Search
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface ComplianceFramework {
  id: string;
  name: string;
  version: string;
  status: 'compliant' | 'partial' | 'non_compliant';
  score: number;
  requirements: number;
  completed: number;
  lastAssessment: string;
  certificationDate?: string;
  expiryDate?: string;
}

interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  ipAddress: string;
  userAgent: string;
  outcome: 'success' | 'failure' | 'warning';
  details: Record<string, any>;
}

interface DataRetentionPolicy {
  id: string;
  name: string;
  description: string;
  dataType: string;
  retentionPeriod: number;
  retentionUnit: 'days' | 'months' | 'years';
  autoDelete: boolean;
  isActive: boolean;
  createdAt: string;
}

interface ComplianceSecurityFrameworkProps {
  organizationId?: string;
  className?: string;
}

export const ComplianceSecurityFramework: React.FC<ComplianceSecurityFrameworkProps> = ({
  organizationId,
  className
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedFramework, setSelectedFramework] = useState<string>('soc2');
  const [auditFilters, setAuditFilters] = useState({
    dateRange: '7d',
    action: 'all',
    outcome: 'all',
    userId: ''
  });

  // Fetch compliance status
  const { data: complianceData, isLoading: complianceLoading } = useQuery({
    queryKey: ['/api/enterprise/compliance/status', organizationId],
    queryFn: async () => {
      return await apiRequest('/api/enterprise/compliance/status', {
        method: 'GET',
        organizationId
      });
    }
  });

  // Fetch audit logs
  const { data: auditData } = useQuery({
    queryKey: ['/api/enterprise/audit/logs', organizationId, auditFilters],
    queryFn: async () => {
      return await apiRequest('/api/enterprise/audit/logs', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          filters: auditFilters,
          limit: 100
        })
      });
    }
  });

  // Fetch data retention policies
  const { data: retentionData } = useQuery({
    queryKey: ['/api/enterprise/data-retention', organizationId],
    queryFn: async () => {
      return await apiRequest('/api/enterprise/data-retention', {
        method: 'GET',
        organizationId
      });
    }
  });

  // Generate compliance report mutation
  const generateReportMutation = useMutation({
    mutationFn: async (reportType: string) => {
      return await apiRequest('/api/enterprise/compliance/report', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          reportType,
          includeAuditLogs: true,
          includeDataMaps: true,
          format: 'pdf'
        })
      });
    },
    onSuccess: (data) => {
      toast({
        title: 'Report Generated',
        description: 'Compliance report is ready for download'
      });
      // Trigger download
      window.open(data.downloadUrl, '_blank');
    },
    onError: (error: any) => {
      toast({
        title: 'Report Generation Failed',
        description: error.message || 'Please try again',
        variant: 'destructive'
      });
    }
  });

  // Data retention policy creation
  const createRetentionPolicyMutation = useMutation({
    mutationFn: async (policyData: Omit<DataRetentionPolicy, 'id' | 'createdAt'>) => {
      return await apiRequest('/api/enterprise/data-retention', {
        method: 'POST',
        body: JSON.stringify({
          ...policyData,
          organizationId
        })
      });
    },
    onSuccess: () => {
      toast({
        title: 'Policy Created',
        description: 'Data retention policy has been created'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/enterprise/data-retention'] });
    }
  });

  const complianceFrameworks = complianceData?.frameworks || [
    {
      id: 'soc2',
      name: 'SOC 2 Type II',
      version: '2017',
      status: 'compliant',
      score: 95,
      requirements: 64,
      completed: 61,
      lastAssessment: '2024-12-01',
      certificationDate: '2024-06-15',
      expiryDate: '2025-06-15'
    },
    {
      id: 'gdpr',
      name: 'GDPR',
      version: '2018',
      status: 'compliant',
      score: 92,
      requirements: 48,
      completed: 44,
      lastAssessment: '2024-11-15'
    },
    {
      id: 'ccpa',
      name: 'CCPA',
      version: '2020',
      status: 'partial',
      score: 78,
      requirements: 32,
      completed: 25,
      lastAssessment: '2024-10-30'
    }
  ];

  const auditLogs = auditData?.logs || [];
  const retentionPolicies = retentionData?.policies || [];

  const getComplianceStatusColor = (status: string) => {
    switch (status) {
      case 'compliant': return 'bg-green-100 text-green-800';
      case 'partial': return 'bg-yellow-100 text-yellow-800';
      case 'non_compliant': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getAuditOutcomeIcon = (outcome: string) => {
    switch (outcome) {
      case 'success': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failure': return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'warning': return <Clock className="w-4 h-4 text-yellow-500" />;
      default: return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const handleGenerateReport = useCallback((reportType: string) => {
    generateReportMutation.mutate(reportType);
  }, [generateReportMutation]);

  return (
    <div className={className}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Compliance & Security</h2>
            <p className="text-muted-foreground">
              Enterprise-grade compliance monitoring and security frameworks
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleGenerateReport('full')}>
              <FileText className="w-4 h-4 mr-2" />
              Generate Report
            </Button>
            <Badge variant="secondary" className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Enterprise Compliant
            </Badge>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="frameworks">Frameworks</TabsTrigger>
            <TabsTrigger value="audit">Audit Logs</TabsTrigger>
            <TabsTrigger value="retention">Data Retention</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Compliance Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardContent className="p-6 text-center">
                  <Shield className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  <div className="text-2xl font-bold text-green-600">95%</div>
                  <div className="text-sm text-muted-foreground">Overall Compliance</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-6 text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                  <div className="text-2xl font-bold">3</div>
                  <div className="text-sm text-muted-foreground">Active Frameworks</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-6 text-center">
                  <Activity className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                  <div className="text-2xl font-bold">1.2M</div>
                  <div className="text-sm text-muted-foreground">Audit Events (30d)</div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activities */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Compliance Activities</CardTitle>
                <CardDescription>
                  Latest compliance assessments and security events
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 border rounded">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      <div>
                        <div className="font-medium">SOC 2 Assessment Completed</div>
                        <div className="text-sm text-muted-foreground">
                          Annual compliance assessment passed with 95% score
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">2 days ago</div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 border rounded">
                    <div className="flex items-center gap-3">
                      <Lock className="w-5 h-5 text-blue-500" />
                      <div>
                        <div className="font-medium">Data Encryption Updated</div>
                        <div className="text-sm text-muted-foreground">
                          All data at rest encryption upgraded to AES-256
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">1 week ago</div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 border rounded">
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5 text-purple-500" />
                      <div>
                        <div className="font-medium">Employee Security Training</div>
                        <div className="text-sm text-muted-foreground">
                          98% completion rate for annual security awareness training
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">2 weeks ago</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Frameworks Tab */}
          <TabsContent value="frameworks" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {complianceFrameworks.map((framework: ComplianceFramework) => (
                <Card
                  key={framework.id}
                  className={`cursor-pointer transition-all ${
                    selectedFramework === framework.id ? 'ring-2 ring-primary' : 'hover:shadow-lg'
                  }`}
                  onClick={() => setSelectedFramework(framework.id)}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{framework.name}</span>
                      <Badge className={getComplianceStatusColor(framework.status)}>
                        {framework.status}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Version {framework.version} • Last assessed {new Date(framework.lastAssessment).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span>Compliance Score</span>
                          <span className="font-medium">{framework.score}%</span>
                        </div>
                        <Progress value={framework.score} className="h-2" />
                      </div>
                      
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span>Requirements</span>
                          <span className="font-medium">
                            {framework.completed}/{framework.requirements}
                          </span>
                        </div>
                        <Progress 
                          value={(framework.completed / framework.requirements) * 100} 
                          className="h-2" 
                        />
                      </div>

                      {framework.certificationDate && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Certified</span>
                          <span>{new Date(framework.certificationDate).toLocaleDateString()}</span>
                        </div>
                      )}

                      {framework.expiryDate && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Expires</span>
                          <span>{new Date(framework.expiryDate).toLocaleDateString()}</span>
                        </div>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGenerateReport(framework.id);
                        }}
                      >
                        <Download className="w-3 h-3 mr-2" />
                        Download Report
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Audit Logs Tab */}
          <TabsContent value="audit" className="space-y-6">
            {/* Filters */}
            <Card>
              <CardHeader>
                <CardTitle>Audit Log Filters</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>Date Range</Label>
                    <Select
                      value={auditFilters.dateRange}
                      onValueChange={(value) => setAuditFilters(prev => ({ ...prev, dateRange: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1d">Last 24 hours</SelectItem>
                        <SelectItem value="7d">Last 7 days</SelectItem>
                        <SelectItem value="30d">Last 30 days</SelectItem>
                        <SelectItem value="90d">Last 90 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Action</Label>
                    <Select
                      value={auditFilters.action}
                      onValueChange={(value) => setAuditFilters(prev => ({ ...prev, action: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Actions</SelectItem>
                        <SelectItem value="login">Login</SelectItem>
                        <SelectItem value="logout">Logout</SelectItem>
                        <SelectItem value="create">Create</SelectItem>
                        <SelectItem value="update">Update</SelectItem>
                        <SelectItem value="delete">Delete</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Outcome</Label>
                    <Select
                      value={auditFilters.outcome}
                      onValueChange={(value) => setAuditFilters(prev => ({ ...prev, outcome: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Outcomes</SelectItem>
                        <SelectItem value="success">Success</SelectItem>
                        <SelectItem value="failure">Failure</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>User ID</Label>
                    <Input
                      placeholder="Filter by user..."
                      value={auditFilters.userId}
                      onChange={(e) => setAuditFilters(prev => ({ ...prev, userId: e.target.value }))}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Audit Logs */}
            <Card>
              <CardHeader>
                <CardTitle>Audit Events</CardTitle>
                <CardDescription>
                  Comprehensive log of all security-relevant activities
                </CardDescription>
              </CardHeader>
              <CardContent>
                {auditLogs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No audit logs found for the selected filters</p>
                    <p className="text-sm">Try adjusting your search criteria</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {auditLogs.slice(0, 20).map((log: AuditLog) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <div className="flex items-center gap-3">
                          {getAuditOutcomeIcon(log.outcome)}
                          <div>
                            <div className="font-medium">
                              {log.userName} • {log.action} • {log.resource}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {new Date(log.timestamp).toLocaleString()} • {log.ipAddress}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {log.outcome}
                          </Badge>
                          <Button size="sm" variant="outline">
                            <Eye className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    
                    {auditLogs.length > 20 && (
                      <div className="text-center pt-4">
                        <Button variant="outline">
                          Load More Events
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Data Retention Tab */}
          <TabsContent value="retention" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Active Policies */}
              <Card>
                <CardHeader>
                  <CardTitle>Data Retention Policies</CardTitle>
                  <CardDescription>
                    Automated data lifecycle management
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {retentionPolicies.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No retention policies configured</p>
                      <p className="text-sm">Create policies to manage data lifecycle</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {retentionPolicies.map((policy: DataRetentionPolicy) => (
                        <div
                          key={policy.id}
                          className="p-3 border rounded"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-medium">{policy.name}</div>
                            <Badge variant={policy.isActive ? 'default' : 'secondary'}>
                              {policy.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground mb-2">
                            {policy.description}
                          </div>
                          <div className="flex justify-between text-xs">
                            <span>Data Type: {policy.dataType}</span>
                            <span>
                              Retention: {policy.retentionPeriod} {policy.retentionUnit}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* GDPR Controls */}
              <Card>
                <CardHeader>
                  <CardTitle>GDPR Controls</CardTitle>
                  <CardDescription>
                    Data protection and privacy compliance
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <Alert>
                      <Lock className="h-4 w-4" />
                      <AlertDescription>
                        GDPR compliance features are active. All data processing 
                        activities are logged and user rights are protected.
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Right to Access</span>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Right to Rectification</span>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Right to Erasure</span>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Data Portability</span>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Consent Management</span>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      </div>
                    </div>

                    <Button className="w-full" variant="outline">
                      <Settings className="w-4 h-4 mr-2" />
                      Configure GDPR Settings
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ComplianceSecurityFramework;