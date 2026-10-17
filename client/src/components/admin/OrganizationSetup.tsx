import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import {
  Building2, Users, Bot, Settings, Globe, Shield, CheckCircle,
  AlertTriangle, Edit, Save, Layers, GitBranch, Briefcase
} from 'lucide-react';

interface OrganizationProfile {
  name: string;
  industry: string;
  size: string;
  country: string;
  timezone: string;
  description: string;
  complianceRequirements: string[];
  features: Record<string, boolean>;
}

interface DeployedTeam {
  id: string;
  name: string;
  agentCount: number;
  status: 'active' | 'paused' | 'configuring';
  lastActivity: string;
}

export default function OrganizationSetup() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('profile');
  const [isEditing, setIsEditing] = useState(false);
  
  const [orgProfile, setOrgProfile] = useState<OrganizationProfile>({
    name: 'Acme Corporation',
    industry: 'technology',
    size: 'medium',
    country: 'United States',
    timezone: 'America/New_York',
    description: 'Technology company focused on AI-powered solutions',
    complianceRequirements: ['SOC2', 'GDPR'],
    features: {
      autonomousDecisions: true,
      hitlWorkflows: true,
      digitalTwins: true,
      multiLLM: true,
      advancedAnalytics: true,
      customAgents: false
    }
  });

  const [deployedTeams] = useState<DeployedTeam[]>([
    { id: 'finance', name: 'Finance Team', agentCount: 5, status: 'active', lastActivity: '2 minutes ago' },
    { id: 'development', name: 'Development Team', agentCount: 6, status: 'active', lastActivity: '5 minutes ago' },
    { id: 'marketing', name: 'Marketing Team', agentCount: 5, status: 'paused', lastActivity: '1 hour ago' },
  ]);

  const handleSaveProfile = () => {
    setIsEditing(false);
    toast({
      title: 'Organization Updated',
      description: 'Your organization profile has been saved successfully.'
    });
  };

  const getStatusColor = (status: string) => ({
    active: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    configuring: 'bg-blue-100 text-blue-800'
  }[status] || 'bg-gray-100 text-gray-800');

  const orgCompleteness = 85;

  return (
    <div className="space-y-6" data-testid="organization-setup">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-org-title">Organization Setup</h2>
          <p className="text-muted-foreground">Configure your organization profile and manage deployed teams</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Setup Completeness</p>
            <div className="flex items-center gap-2">
              <Progress value={orgCompleteness} className="w-24 h-2" />
              <span className="text-sm font-medium">{orgCompleteness}%</span>
            </div>
          </div>
          {isEditing ? (
            <Button onClick={handleSaveProfile} data-testid="button-save-org">
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setIsEditing(true)} data-testid="button-edit-org">
              <Edit className="w-4 h-4 mr-2" />
              Edit Profile
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-org-sections">
          <TabsTrigger value="profile" data-testid="tab-profile">
            <Building2 className="w-4 h-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="teams" data-testid="tab-teams">
            <Users className="w-4 h-4 mr-2" />
            Deployed Teams
          </TabsTrigger>
          <TabsTrigger value="features" data-testid="tab-features">
            <Settings className="w-4 h-4 mr-2" />
            Features
          </TabsTrigger>
          <TabsTrigger value="compliance" data-testid="tab-compliance">
            <Shield className="w-4 h-4 mr-2" />
            Compliance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Basic Information</CardTitle>
                <CardDescription>Core organization details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input
                    id="org-name"
                    value={orgProfile.name}
                    onChange={(e) => setOrgProfile({ ...orgProfile, name: e.target.value })}
                    disabled={!isEditing}
                    data-testid="input-org-name"
                  />
                </div>
                <div>
                  <Label htmlFor="org-industry">Industry</Label>
                  <Select
                    value={orgProfile.industry}
                    onValueChange={(v) => setOrgProfile({ ...orgProfile, industry: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger data-testid="select-industry">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="technology" data-testid="option-technology">Technology</SelectItem>
                      <SelectItem value="finance" data-testid="option-finance">Finance</SelectItem>
                      <SelectItem value="healthcare" data-testid="option-healthcare">Healthcare</SelectItem>
                      <SelectItem value="retail" data-testid="option-retail">Retail</SelectItem>
                      <SelectItem value="manufacturing" data-testid="option-manufacturing">Manufacturing</SelectItem>
                      <SelectItem value="other" data-testid="option-other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="org-size">Organization Size</Label>
                  <Select
                    value={orgProfile.size}
                    onValueChange={(v) => setOrgProfile({ ...orgProfile, size: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger data-testid="select-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small" data-testid="option-small">Small (1-50)</SelectItem>
                      <SelectItem value="medium" data-testid="option-medium">Medium (51-500)</SelectItem>
                      <SelectItem value="large" data-testid="option-large">Large (501-5000)</SelectItem>
                      <SelectItem value="enterprise" data-testid="option-enterprise">Enterprise (5000+)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="org-description">Description</Label>
                  <Textarea
                    id="org-description"
                    value={orgProfile.description}
                    onChange={(e) => setOrgProfile({ ...orgProfile, description: e.target.value })}
                    disabled={!isEditing}
                    data-testid="textarea-org-description"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Regional Settings</CardTitle>
                <CardDescription>Location and timezone configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="org-country">Country</Label>
                  <Select
                    value={orgProfile.country}
                    onValueChange={(v) => setOrgProfile({ ...orgProfile, country: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger data-testid="select-country">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="United States" data-testid="option-us">United States</SelectItem>
                      <SelectItem value="United Kingdom" data-testid="option-uk">United Kingdom</SelectItem>
                      <SelectItem value="Germany" data-testid="option-de">Germany</SelectItem>
                      <SelectItem value="India" data-testid="option-in">India</SelectItem>
                      <SelectItem value="Japan" data-testid="option-jp">Japan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="org-timezone">Timezone</Label>
                  <Select
                    value={orgProfile.timezone}
                    onValueChange={(v) => setOrgProfile({ ...orgProfile, timezone: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger data-testid="select-timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York" data-testid="option-ny">Eastern Time (ET)</SelectItem>
                      <SelectItem value="America/Los_Angeles" data-testid="option-la">Pacific Time (PT)</SelectItem>
                      <SelectItem value="Europe/London" data-testid="option-london">London (GMT)</SelectItem>
                      <SelectItem value="Asia/Tokyo" data-testid="option-tokyo">Tokyo (JST)</SelectItem>
                      <SelectItem value="Asia/Kolkata" data-testid="option-ist">India (IST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="teams" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Deployed Agent Teams</CardTitle>
              <CardDescription>Teams currently active in your organization</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {deployedTeams.map(team => (
                  <div key={team.id} className="flex items-center justify-between p-4 bg-muted rounded-lg" data-testid={`row-team-${team.id}`}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Briefcase className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-medium" data-testid={`text-team-name-${team.id}`}>{team.name}</h4>
                        <p className="text-sm text-muted-foreground">{team.agentCount} agents • Last active {team.lastActivity}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={getStatusColor(team.status)} data-testid={`badge-team-status-${team.id}`}>{team.status}</Badge>
                      <Button variant="outline" size="sm" data-testid={`button-manage-team-${team.id}`}>Manage</Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full" data-testid="button-add-team">
                <Users className="w-4 h-4 mr-2" />
                Add Team from Templates
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Feature Toggles</CardTitle>
              <CardDescription>Enable or disable platform features for your organization</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(orgProfile.features).map(([key, enabled]) => (
                  <div key={key} className="flex items-center justify-between p-3 bg-muted rounded-lg" data-testid={`row-feature-${key}`}>
                    <div>
                      <h4 className="font-medium capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</h4>
                      <p className="text-sm text-muted-foreground">
                        {key === 'autonomousDecisions' && 'Allow agents to make decisions without human approval'}
                        {key === 'hitlWorkflows' && 'Enable human-in-the-loop approval workflows'}
                        {key === 'digitalTwins' && 'Create digital representations of agents and processes'}
                        {key === 'multiLLM' && 'Use multiple LLM providers for different tasks'}
                        {key === 'advancedAnalytics' && 'Access advanced analytics and reporting'}
                        {key === 'customAgents' && 'Create custom agents with specialized capabilities'}
                      </p>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => setOrgProfile({
                        ...orgProfile,
                        features: { ...orgProfile.features, [key]: v }
                      })}
                      disabled={!isEditing}
                      data-testid={`switch-feature-${key}`}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Compliance Requirements</CardTitle>
              <CardDescription>Regulatory and compliance frameworks enabled</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {['SOC2', 'GDPR', 'HIPAA', 'ISO27001', 'PCI-DSS', 'CCPA', 'FedRAMP', 'NIST'].map(framework => (
                  <div
                    key={framework}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                      orgProfile.complianceRequirements.includes(framework)
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-primary/50'
                    }`}
                    onClick={() => {
                      if (!isEditing) return;
                      const newReqs = orgProfile.complianceRequirements.includes(framework)
                        ? orgProfile.complianceRequirements.filter(r => r !== framework)
                        : [...orgProfile.complianceRequirements, framework];
                      setOrgProfile({ ...orgProfile, complianceRequirements: newReqs });
                    }}
                    data-testid={`card-compliance-${framework}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{framework}</span>
                      {orgProfile.complianceRequirements.includes(framework) && (
                        <CheckCircle className="w-4 h-4 text-primary" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
