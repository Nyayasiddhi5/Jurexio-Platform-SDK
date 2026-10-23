import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  DollarSign, Users, Code, Megaphone, FileText, FlaskConical,
  TrendingUp, Bot, Plus, Edit, Trash2, Copy, Eye, CheckCircle,
  Star, Layers, GitBranch, Settings, Play, Shield
} from 'lucide-react';

interface AgentRole {
  id: string;
  name: string;
  description: string;
  romaLevel: 'L1' | 'L2' | 'L3' | 'L4';
  responsibilities: string[];
}

interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: 'business' | 'technical' | 'creative' | 'support';
  agents: AgentRole[];
  workflows: string[];
  recommended: boolean;
  usageCount: number;
}

const iconMap: Record<string, any> = {
  DollarSign, Users, Code, Megaphone, FileText, FlaskConical, TrendingUp, Shield
};

const preCreatedTeams: TeamTemplate[] = [
  {
    id: 'finance-team',
    name: 'Finance Team',
    description: 'Complete financial operations team with CFO oversight, analysts, and compliance specialists',
    icon: 'DollarSign',
    color: '#22c55e',
    category: 'business',
    recommended: true,
    usageCount: 1247,
    agents: [
      { id: 'cfo-agent', name: 'CFO Agent', description: 'Executive financial oversight and strategy', romaLevel: 'L4', responsibilities: ['Financial strategy', 'Budget approval', 'Investment decisions'] },
      { id: 'financial-analyst', name: 'Financial Analyst', description: 'Data analysis and reporting', romaLevel: 'L2', responsibilities: ['Financial modeling', 'Report generation', 'Trend analysis'] },
      { id: 'accounts-payable', name: 'Accounts Payable Agent', description: 'Invoice processing and payments', romaLevel: 'L1', responsibilities: ['Invoice processing', 'Payment scheduling', 'Vendor management'] },
      { id: 'accounts-receivable', name: 'Accounts Receivable Agent', description: 'Collections and revenue tracking', romaLevel: 'L1', responsibilities: ['Invoice creation', 'Payment tracking', 'Collection follow-up'] },
      { id: 'compliance-officer', name: 'Compliance Officer', description: 'Regulatory compliance and audit', romaLevel: 'L3', responsibilities: ['Audit preparation', 'Compliance monitoring', 'Risk assessment'] },
    ],
    workflows: ['Quote-to-Cash', 'Budget Planning', 'Expense Management', 'Financial Reporting']
  },
  {
    id: 'hr-team',
    name: 'HR Team',
    description: 'Human resources team handling recruitment, onboarding, performance, and employee relations',
    icon: 'Users',
    color: '#8b5cf6',
    category: 'business',
    recommended: true,
    usageCount: 982,
    agents: [
      { id: 'chro-agent', name: 'CHRO Agent', description: 'Executive HR leadership and strategy', romaLevel: 'L4', responsibilities: ['HR strategy', 'Culture development', 'Executive hiring'] },
      { id: 'recruiter', name: 'Recruiter Agent', description: 'Talent acquisition and screening', romaLevel: 'L2', responsibilities: ['Job posting', 'Resume screening', 'Interview scheduling'] },
      { id: 'onboarding-specialist', name: 'Onboarding Specialist', description: 'New employee integration', romaLevel: 'L2', responsibilities: ['Welcome packages', 'Training coordination', 'Mentorship matching'] },
      { id: 'benefits-admin', name: 'Benefits Administrator', description: 'Benefits and compensation management', romaLevel: 'L1', responsibilities: ['Benefits enrollment', 'Claims processing', 'Policy updates'] },
      { id: 'performance-manager', name: 'Performance Manager', description: 'Performance reviews and development', romaLevel: 'L3', responsibilities: ['Review cycles', 'Goal tracking', 'Development planning'] },
    ],
    workflows: ['Recruitment Pipeline', 'Employee Onboarding', 'Performance Review Cycle', 'Offboarding']
  },
  {
    id: 'development-team',
    name: 'Development Team',
    description: 'Full-stack development team with architects, developers, and DevOps specialists',
    icon: 'Code',
    color: '#3b82f6',
    category: 'technical',
    recommended: true,
    usageCount: 2156,
    agents: [
      { id: 'cto-agent', name: 'CTO Agent', description: 'Technical leadership and architecture decisions', romaLevel: 'L4', responsibilities: ['Tech strategy', 'Architecture approval', 'Team leadership'] },
      { id: 'tech-lead', name: 'Tech Lead Agent', description: 'Technical guidance and code reviews', romaLevel: 'L3', responsibilities: ['Code review', 'Technical mentoring', 'Sprint planning'] },
      { id: 'frontend-dev', name: 'Frontend Developer', description: 'UI/UX implementation', romaLevel: 'L2', responsibilities: ['UI development', 'Component building', 'Testing'] },
      { id: 'backend-dev', name: 'Backend Developer', description: 'Server-side logic and APIs', romaLevel: 'L2', responsibilities: ['API development', 'Database design', 'Integration'] },
      { id: 'devops-engineer', name: 'DevOps Engineer', description: 'CI/CD and infrastructure', romaLevel: 'L2', responsibilities: ['Pipeline management', 'Deployment', 'Monitoring'] },
      { id: 'qa-engineer', name: 'QA Engineer', description: 'Quality assurance and testing', romaLevel: 'L2', responsibilities: ['Test planning', 'Bug tracking', 'Automation'] },
    ],
    workflows: ['Sprint Cycle', 'Code Review', 'Deployment Pipeline', 'Incident Response']
  },
  {
    id: 'marketing-team',
    name: 'Marketing Team',
    description: 'Marketing operations team for campaigns, content, and brand management',
    icon: 'Megaphone',
    color: '#f59e0b',
    category: 'creative',
    recommended: true,
    usageCount: 856,
    agents: [
      { id: 'cmo-agent', name: 'CMO Agent', description: 'Marketing strategy and brand oversight', romaLevel: 'L4', responsibilities: ['Marketing strategy', 'Brand direction', 'Budget allocation'] },
      { id: 'campaign-manager', name: 'Campaign Manager', description: 'Campaign planning and execution', romaLevel: 'L3', responsibilities: ['Campaign design', 'Channel coordination', 'Performance tracking'] },
      { id: 'content-strategist', name: 'Content Strategist', description: 'Content planning and SEO', romaLevel: 'L2', responsibilities: ['Content calendar', 'SEO optimization', 'Topic research'] },
      { id: 'social-media', name: 'Social Media Agent', description: 'Social media management', romaLevel: 'L1', responsibilities: ['Post scheduling', 'Engagement monitoring', 'Trend tracking'] },
      { id: 'analytics-specialist', name: 'Marketing Analyst', description: 'Campaign analytics and ROI', romaLevel: 'L2', responsibilities: ['Data analysis', 'Report generation', 'Attribution modeling'] },
    ],
    workflows: ['Campaign Launch', 'Content Pipeline', 'Social Media Calendar', 'Marketing Analytics']
  },
  {
    id: 'content-team',
    name: 'Content Team',
    description: 'Content creation team for copywriting, design, and multimedia production',
    icon: 'FileText',
    color: '#ec4899',
    category: 'creative',
    recommended: false,
    usageCount: 634,
    agents: [
      { id: 'content-director', name: 'Content Director', description: 'Content strategy and editorial oversight', romaLevel: 'L4', responsibilities: ['Editorial calendar', 'Quality standards', 'Team coordination'] },
      { id: 'copywriter', name: 'Copywriter Agent', description: 'Marketing and web copy', romaLevel: 'L2', responsibilities: ['Website copy', 'Email templates', 'Ad copy'] },
      { id: 'technical-writer', name: 'Technical Writer', description: 'Documentation and guides', romaLevel: 'L2', responsibilities: ['Documentation', 'User guides', 'API docs'] },
      { id: 'designer', name: 'Design Agent', description: 'Visual design and graphics', romaLevel: 'L2', responsibilities: ['Graphics', 'Layout design', 'Brand assets'] },
      { id: 'video-producer', name: 'Video Producer', description: 'Video content creation', romaLevel: 'L2', responsibilities: ['Video editing', 'Animation', 'Thumbnails'] },
    ],
    workflows: ['Content Creation', 'Editorial Review', 'Asset Management', 'Publishing Pipeline']
  },
  {
    id: 'research-team',
    name: 'Research Team',
    description: 'Research and analysis team for market intelligence and competitive analysis',
    icon: 'FlaskConical',
    color: '#06b6d4',
    category: 'business',
    recommended: false,
    usageCount: 423,
    agents: [
      { id: 'research-director', name: 'Research Director', description: 'Research strategy and methodology', romaLevel: 'L4', responsibilities: ['Research strategy', 'Methodology design', 'Insights synthesis'] },
      { id: 'market-analyst', name: 'Market Analyst', description: 'Market trends and opportunities', romaLevel: 'L3', responsibilities: ['Market sizing', 'Trend analysis', 'Opportunity mapping'] },
      { id: 'competitive-analyst', name: 'Competitive Analyst', description: 'Competitor monitoring and analysis', romaLevel: 'L2', responsibilities: ['Competitor tracking', 'Feature comparison', 'Pricing analysis'] },
      { id: 'data-scientist', name: 'Data Scientist', description: 'Advanced analytics and modeling', romaLevel: 'L3', responsibilities: ['Statistical modeling', 'Predictive analytics', 'Data visualization'] },
      { id: 'survey-specialist', name: 'Survey Specialist', description: 'Customer research and surveys', romaLevel: 'L1', responsibilities: ['Survey design', 'Response collection', 'Data cleaning'] },
    ],
    workflows: ['Research Project', 'Competitive Analysis', 'Customer Survey', 'Market Report']
  },
  {
    id: 'sales-team',
    name: 'Sales Team',
    description: 'Sales operations team for lead generation, qualification, and deal closure',
    icon: 'TrendingUp',
    color: '#ef4444',
    category: 'business',
    recommended: true,
    usageCount: 1089,
    agents: [
      { id: 'vp-sales', name: 'VP Sales Agent', description: 'Sales strategy and team leadership', romaLevel: 'L4', responsibilities: ['Sales strategy', 'Territory planning', 'Forecasting'] },
      { id: 'sdr', name: 'SDR Agent', description: 'Lead qualification and outreach', romaLevel: 'L1', responsibilities: ['Lead research', 'Cold outreach', 'Meeting scheduling'] },
      { id: 'account-exec', name: 'Account Executive', description: 'Deal negotiation and closure', romaLevel: 'L3', responsibilities: ['Demos', 'Proposals', 'Negotiations'] },
      { id: 'sales-engineer', name: 'Sales Engineer', description: 'Technical pre-sales support', romaLevel: 'L2', responsibilities: ['Technical demos', 'POC support', 'Integration guidance'] },
      { id: 'sales-ops', name: 'Sales Operations', description: 'CRM and process optimization', romaLevel: 'L2', responsibilities: ['CRM management', 'Reporting', 'Process improvement'] },
    ],
    workflows: ['Lead Qualification', 'Sales Pipeline', 'Deal Closure', 'Customer Success Handoff']
  },
  {
    id: 'security-team',
    name: 'Security Team',
    description: 'Cybersecurity team for threat detection, compliance, and incident response',
    icon: 'Shield',
    color: '#64748b',
    category: 'technical',
    recommended: false,
    usageCount: 378,
    agents: [
      { id: 'ciso-agent', name: 'CISO Agent', description: 'Security leadership and governance', romaLevel: 'L4', responsibilities: ['Security strategy', 'Risk management', 'Compliance oversight'] },
      { id: 'threat-analyst', name: 'Threat Analyst', description: 'Threat intelligence and monitoring', romaLevel: 'L3', responsibilities: ['Threat hunting', 'Intelligence gathering', 'Vulnerability assessment'] },
      { id: 'security-engineer', name: 'Security Engineer', description: 'Security infrastructure and tools', romaLevel: 'L2', responsibilities: ['Tool configuration', 'Log analysis', 'Penetration testing'] },
      { id: 'compliance-analyst', name: 'Compliance Analyst', description: 'Regulatory compliance management', romaLevel: 'L2', responsibilities: ['Audit preparation', 'Policy documentation', 'Compliance reporting'] },
      { id: 'incident-responder', name: 'Incident Responder', description: 'Security incident handling', romaLevel: 'L3', responsibilities: ['Incident triage', 'Forensic analysis', 'Remediation'] },
    ],
    workflows: ['Security Audit', 'Incident Response', 'Vulnerability Management', 'Compliance Check']
  }
];

export default function TeamTemplatesGallery() {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<TeamTemplate | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [customTeamName, setCustomTeamName] = useState('');
  const [customTeamDescription, setCustomTeamDescription] = useState('');

  const filteredTeams = preCreatedTeams.filter(
    team => categoryFilter === 'all' || team.category === categoryFilter
  );

  const handleDeployTemplate = (template: TeamTemplate) => {
    toast({
      title: 'Team Deployed',
      description: `${template.name} has been added to your organization with ${template.agents.length} agents.`
    });
  };

  const handlePreviewTemplate = (template: TeamTemplate) => {
    setSelectedTemplate(template);
    setShowPreviewDialog(true);
  };

  const getRomaLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      'L1': 'bg-gray-100 text-gray-800',
      'L2': 'bg-blue-100 text-blue-800',
      'L3': 'bg-purple-100 text-purple-800',
      'L4': 'bg-amber-100 text-amber-800'
    };
    return colors[level] || colors['L1'];
  };

  return (
    <div className="space-y-6" data-testid="team-templates-gallery">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-gallery-title">Team Templates Gallery</h2>
          <p className="text-muted-foreground">Pre-configured agent teams ready to deploy to your organization</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-team">
          <Plus className="w-4 h-4 mr-2" />
          Create Custom Team
        </Button>
      </div>

      <Tabs value={categoryFilter} onValueChange={setCategoryFilter}>
        <TabsList data-testid="tabs-category-filter">
          <TabsTrigger value="all" data-testid="tab-all">All Teams</TabsTrigger>
          <TabsTrigger value="business" data-testid="tab-business">Business</TabsTrigger>
          <TabsTrigger value="technical" data-testid="tab-technical">Technical</TabsTrigger>
          <TabsTrigger value="creative" data-testid="tab-creative">Creative</TabsTrigger>
          <TabsTrigger value="support" data-testid="tab-support">Support</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredTeams.map(template => {
          const IconComponent = iconMap[template.icon] || Bot;
          return (
            <Card key={template.id} className="relative hover:shadow-lg transition-shadow" data-testid={`card-template-${template.id}`}>
              {template.recommended && (
                <div className="absolute -top-2 -right-2">
                  <Badge className="bg-amber-500">
                    <Star className="w-3 h-3 mr-1" />
                    Recommended
                  </Badge>
                </div>
              )}
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: `${template.color}20` }}>
                    <IconComponent className="w-6 h-6" style={{ color: template.color }} />
                  </div>
                  <div>
                    <CardTitle className="text-base" data-testid={`text-template-name-${template.id}`}>{template.name}</CardTitle>
                    <Badge variant="outline" className="text-xs">{template.category}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-2">
                <CardDescription className="mb-3" data-testid={`text-template-desc-${template.id}`}>{template.description}</CardDescription>
                <div className="flex flex-wrap gap-1 mb-3">
                  <Badge variant="secondary" data-testid={`badge-agents-${template.id}`}>
                    <Bot className="w-3 h-3 mr-1" />
                    {template.agents.length} Agents
                  </Badge>
                  <Badge variant="secondary" data-testid={`badge-workflows-${template.id}`}>
                    <Layers className="w-3 h-3 mr-1" />
                    {template.workflows.length} Workflows
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Used by {template.usageCount.toLocaleString()} organizations
                </div>
              </CardContent>
              <CardFooter className="pt-2 gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => handlePreviewTemplate(template)} data-testid={`button-preview-${template.id}`}>
                  <Eye className="w-3 h-3 mr-1" />
                  Preview
                </Button>
                <Button size="sm" className="flex-1" onClick={() => handleDeployTemplate(template)} data-testid={`button-deploy-${template.id}`}>
                  <Play className="w-3 h-3 mr-1" />
                  Deploy
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          {selectedTemplate && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => { const Icon = iconMap[selectedTemplate.icon] || Bot; return <Icon style={{ color: selectedTemplate.color }} />; })()}
                  {selectedTemplate.name}
                </DialogTitle>
                <DialogDescription>{selectedTemplate.description}</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[50vh]">
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold mb-3">Agent Roster ({selectedTemplate.agents.length})</h4>
                    <div className="space-y-2">
                      {selectedTemplate.agents.map(agent => (
                        <div key={agent.id} className="flex items-start gap-3 p-3 bg-muted rounded-lg" data-testid={`row-agent-${agent.id}`}>
                          <Bot className="w-5 h-5 mt-0.5 text-muted-foreground" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium" data-testid={`text-agent-name-${agent.id}`}>{agent.name}</span>
                              <Badge className={getRomaLevelColor(agent.romaLevel)} data-testid={`badge-roma-${agent.id}`}>
                                {agent.romaLevel}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{agent.description}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {agent.responsibilities.map((resp, i) => (
                                <Badge key={i} variant="outline" className="text-xs">{resp}</Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-3">Included Workflows ({selectedTemplate.workflows.length})</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedTemplate.workflows.map((workflow, i) => (
                        <Badge key={i} variant="secondary" data-testid={`badge-workflow-${i}`}>
                          <GitBranch className="w-3 h-3 mr-1" />
                          {workflow}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPreviewDialog(false)} data-testid="button-close-preview">Close</Button>
                <Button onClick={() => { handleDeployTemplate(selectedTemplate); setShowPreviewDialog(false); }} data-testid="button-deploy-from-preview">
                  <Play className="w-4 h-4 mr-2" />
                  Deploy Team
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Custom Team Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Custom Team</DialogTitle>
            <DialogDescription>Build a custom agent team tailored to your specific needs</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                value={customTeamName}
                onChange={(e) => setCustomTeamName(e.target.value)}
                placeholder="e.g., Customer Success Team"
                data-testid="input-team-name"
              />
            </div>
            <div>
              <Label htmlFor="team-description">Description</Label>
              <Textarea
                id="team-description"
                value={customTeamDescription}
                onChange={(e) => setCustomTeamDescription(e.target.value)}
                placeholder="Describe the team's purpose and responsibilities..."
                data-testid="textarea-team-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button onClick={() => { toast({ title: 'Team Created', description: 'Custom team created successfully. Add agents in the next step.' }); setShowCreateDialog(false); }} data-testid="button-save-team">
              Create Team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
