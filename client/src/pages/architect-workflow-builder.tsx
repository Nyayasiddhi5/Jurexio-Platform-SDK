/**
 * Architect Visual Workflow Builder
 * Enterprise Organization Design Tool with Drag-Drop Interface
 * 
 * Features:
 * - Visual drag-drop org builder
 * - Department modules (Finance, HR, Marketing, Engineering)
 * - ROMA L1-L4 autonomy levels
 * - Corporate DNA system prompt configuration
 * - Auto-generate nyayavigya.config.json
 * - Team templates (Startup MVP, Enterprise, Agency, Department, Research)
 */

import { useState, useCallback, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Connection,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { 
  Building2, 
  Users, 
  Bot, 
  Plus, 
  Save, 
  Download, 
  Play, 
  Settings,
  Trash2,
  Copy,
  Layers,
  Target,
  Shield,
  Zap,
  Brain,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  GitBranch,
  Briefcase,
  GraduationCap,
  Heart,
  Scale,
  Megaphone,
  Code,
  Database,
  Cloud,
  FileText,
  BarChart3,
  Workflow
} from "lucide-react";

interface DepartmentModule {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  agents: AgentTemplate[];
  workflows: string[];
}

interface AgentTemplate {
  id: string;
  name: string;
  role: 'lead' | 'specialist' | 'support';
  romaLevel: 1 | 2 | 3 | 4;
  preferredLLM: string;
  description: string;
  capabilities: string[];
}

interface CorporateDNA {
  tone: 'professional' | 'casual' | 'empathetic' | 'academic' | 'formal';
  riskProfile: 'conservative' | 'balanced' | 'aggressive' | 'experimental';
  values: string[];
  ethicalGuidelines: string[];
  budgetConstraint: 'low' | 'medium' | 'high' | 'unlimited';
  qualityPriority: 'speed' | 'balanced' | 'quality';
}

interface OrganizationConfig {
  name: string;
  description: string;
  corporateDNA: CorporateDNA;
  departments: DepartmentNode[];
  connections: EdgeConfig[];
}

interface DepartmentNode {
  id: string;
  moduleId: string;
  name: string;
  position: { x: number; y: number };
  agents: string[];
  romaLevel: 1 | 2 | 3 | 4;
  isActive: boolean;
}

interface EdgeConfig {
  source: string;
  target: string;
  label: string;
  type: 'reports_to' | 'collaborates' | 'approves' | 'notifies';
}

const departmentModules: DepartmentModule[] = [
  {
    id: 'finance',
    name: 'Finance Department',
    icon: 'DollarSign',
    color: '#1C7A4F',
    description: 'Financial operations, budgeting, and compliance',
    agents: [
      { id: 'cfo-agent', name: 'CFO Agent', role: 'lead', romaLevel: 4, preferredLLM: 'claude-opus-4-6', description: 'Chief Financial Officer orchestrator', capabilities: ['financial-planning', 'budget-management', 'risk-assessment'] },
      { id: 'financial-analyst', name: 'Financial Analyst', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-sonnet-4-6', description: 'Financial data analysis and reporting', capabilities: ['financial-analysis', 'reporting', 'forecasting'] },
      { id: 'risk-analyst', name: 'Risk Analyst', role: 'specialist', romaLevel: 3, preferredLLM: 'o3', description: 'Risk assessment and mitigation', capabilities: ['risk-analysis', 'compliance', 'audit'] },
      { id: 'accounting-agent', name: 'Accounting Agent', role: 'support', romaLevel: 2, preferredLLM: 'gpt-4.1', description: 'Bookkeeping and transaction processing', capabilities: ['accounting', 'invoicing', 'reconciliation'] },
    ],
    workflows: ['quote-to-cash', 'budget-approval', 'expense-management', 'financial-reporting']
  },
  {
    id: 'hr',
    name: 'HR Department',
    icon: 'Users',
    color: '#152448',
    description: 'Human resources, recruitment, and talent management',
    agents: [
      { id: 'chro-agent', name: 'CHRO Agent', role: 'lead', romaLevel: 4, preferredLLM: 'claude-opus-4-6', description: 'Chief HR Officer orchestrator', capabilities: ['hr-strategy', 'talent-management', 'culture'] },
      { id: 'recruiter-agent', name: 'Recruiter Agent', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-sonnet-4-6', description: 'Talent acquisition and screening', capabilities: ['recruiting', 'screening', 'interviewing'] },
      { id: 'onboarding-agent', name: 'Onboarding Agent', role: 'specialist', romaLevel: 2, preferredLLM: 'gpt-4.1', description: 'New employee onboarding', capabilities: ['onboarding', 'training', 'documentation'] },
      { id: 'hr-analytics-agent', name: 'HR Analytics Agent', role: 'support', romaLevel: 2, preferredLLM: 'gpt-4.1', description: 'HR metrics and analytics', capabilities: ['analytics', 'reporting', 'insights'] },
    ],
    workflows: ['recruitment-pipeline', 'onboarding-workflow', 'performance-review', 'offboarding']
  },
  {
    id: 'engineering',
    name: 'Engineering Department',
    icon: 'Code',
    color: '#152448',
    description: 'Software development and technical operations',
    agents: [
      { id: 'cto-agent', name: 'CTO Agent', role: 'lead', romaLevel: 4, preferredLLM: 'claude-sonnet-4-6', description: 'Chief Technology Officer orchestrator', capabilities: ['tech-strategy', 'architecture', 'innovation'] },
      { id: 'solution-architect', name: 'Solution Architect', role: 'specialist', romaLevel: 4, preferredLLM: 'claude-sonnet-4-6', description: 'System design and architecture', capabilities: ['architecture', 'design-patterns', 'scalability'] },
      { id: 'fullstack-developer', name: 'Fullstack Developer', role: 'specialist', romaLevel: 3, preferredLLM: 'gpt-4.1', description: 'Full-stack application development', capabilities: ['frontend', 'backend', 'database'] },
      { id: 'devops-engineer', name: 'DevOps Engineer', role: 'specialist', romaLevel: 3, preferredLLM: 'gpt-4.1', description: 'CI/CD and infrastructure', capabilities: ['devops', 'ci-cd', 'cloud'] },
      { id: 'qa-engineer', name: 'QA Engineer', role: 'support', romaLevel: 2, preferredLLM: 'gpt-4.1', description: 'Quality assurance and testing', capabilities: ['testing', 'automation', 'quality'] },
    ],
    workflows: ['sprint-planning', 'code-review', 'deployment', 'incident-response']
  },
  {
    id: 'marketing',
    name: 'Marketing Department',
    icon: 'Megaphone',
    color: '#C7B15B',
    description: 'Marketing strategy, content, and growth',
    agents: [
      { id: 'cmo-agent', name: 'CMO Agent', role: 'lead', romaLevel: 4, preferredLLM: 'claude-opus-4-6', description: 'Chief Marketing Officer orchestrator', capabilities: ['marketing-strategy', 'brand', 'growth'] },
      { id: 'content-strategist', name: 'Content Strategist', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-sonnet-4-6', description: 'Content strategy and creation', capabilities: ['content', 'copywriting', 'seo'] },
      { id: 'social-media-agent', name: 'Social Media Agent', role: 'specialist', romaLevel: 2, preferredLLM: 'gemini-3.0-flash', description: 'Social media management', capabilities: ['social-media', 'engagement', 'analytics'] },
      { id: 'campaign-manager', name: 'Campaign Manager', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-sonnet-4-6', description: 'Marketing campaign management', capabilities: ['campaigns', 'advertising', 'performance'] },
    ],
    workflows: ['campaign-launch', 'content-calendar', 'lead-nurturing', 'brand-monitoring']
  },
  {
    id: 'legal',
    name: 'Legal Department',
    icon: 'Scale',
    color: '#152448',
    description: 'Legal compliance, contracts, and governance',
    agents: [
      { id: 'clo-agent', name: 'CLO Agent', role: 'lead', romaLevel: 4, preferredLLM: 'claude-opus-4-6', description: 'Chief Legal Officer orchestrator', capabilities: ['legal-strategy', 'governance', 'compliance'] },
      { id: 'contract-reviewer', name: 'Contract Reviewer', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-opus-4-6', description: 'Contract review and drafting', capabilities: ['contracts', 'negotiation', 'review'] },
      { id: 'compliance-agent', name: 'Compliance Agent', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-sonnet-4-6', description: 'Regulatory compliance', capabilities: ['compliance', 'regulations', 'audit'] },
    ],
    workflows: ['contract-approval', 'compliance-audit', 'legal-review', 'dispute-resolution']
  },
  {
    id: 'operations',
    name: 'Operations Department',
    icon: 'Briefcase',
    color: '#2B384C',
    description: 'Business operations and supply chain',
    agents: [
      { id: 'coo-agent', name: 'COO Agent', role: 'lead', romaLevel: 4, preferredLLM: 'claude-opus-4-6', description: 'Chief Operations Officer orchestrator', capabilities: ['operations', 'efficiency', 'scaling'] },
      { id: 'supply-chain-agent', name: 'Supply Chain Agent', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-sonnet-4-6', description: 'Supply chain optimization', capabilities: ['logistics', 'inventory', 'procurement'] },
      { id: 'process-optimizer', name: 'Process Optimizer', role: 'specialist', romaLevel: 3, preferredLLM: 'o3', description: 'Process optimization', capabilities: ['process', 'automation', 'efficiency'] },
    ],
    workflows: ['inventory-management', 'vendor-management', 'quality-control', 'logistics']
  },
  {
    id: 'healthcare',
    name: 'Healthcare Department',
    icon: 'Heart',
    color: '#2C8A5F',
    description: 'Healthcare operations and patient care',
    agents: [
      { id: 'healthcare-director', name: 'Healthcare Director', role: 'lead', romaLevel: 4, preferredLLM: 'claude-opus-4-6', description: 'Healthcare operations lead', capabilities: ['healthcare-strategy', 'patient-care', 'compliance'] },
      { id: 'clinical-coordinator', name: 'Clinical Coordinator', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-sonnet-4-6', description: 'Clinical workflow coordination', capabilities: ['clinical', 'scheduling', 'coordination'] },
      { id: 'hipaa-compliance', name: 'HIPAA Compliance Agent', role: 'specialist', romaLevel: 3, preferredLLM: 'o3', description: 'HIPAA compliance monitoring', capabilities: ['hipaa', 'privacy', 'security'] },
    ],
    workflows: ['patient-intake', 'clinical-trial', 'compliance-audit', 'care-coordination']
  },
  {
    id: 'education',
    name: 'Education Department',
    icon: 'GraduationCap',
    color: '#152448',
    description: 'Educational content and learning management',
    agents: [
      { id: 'education-director', name: 'Education Director', role: 'lead', romaLevel: 4, preferredLLM: 'claude-opus-4-6', description: 'Education strategy lead', capabilities: ['curriculum', 'learning', 'assessment'] },
      { id: 'curriculum-designer', name: 'Curriculum Designer', role: 'specialist', romaLevel: 3, preferredLLM: 'claude-sonnet-4-6', description: 'Curriculum design and development', capabilities: ['curriculum', 'content', 'pedagogy'] },
      { id: 'student-success', name: 'Student Success Agent', role: 'specialist', romaLevel: 2, preferredLLM: 'gemini-3.0-flash', description: 'Student engagement and success', capabilities: ['engagement', 'support', 'analytics'] },
    ],
    workflows: ['course-creation', 'student-onboarding', 'assessment', 'certification']
  },
];

const teamTemplates = [
  { id: 'startup-mvp', name: 'Startup MVP', departments: ['engineering', 'marketing'], description: 'Lean team for rapid MVP development' },
  { id: 'enterprise', name: 'Enterprise', departments: ['finance', 'hr', 'engineering', 'marketing', 'legal', 'operations'], description: 'Full enterprise organization' },
  { id: 'agency', name: 'Agency', departments: ['marketing', 'engineering'], description: 'Marketing/Creative agency structure' },
  { id: 'healthcare-org', name: 'Healthcare Org', departments: ['healthcare', 'finance', 'hr', 'legal'], description: 'Healthcare organization with compliance' },
  { id: 'edtech', name: 'EdTech', departments: ['education', 'engineering', 'marketing'], description: 'Educational technology company' },
];

const DepartmentNodeComponent = ({ data }: { data: any }) => {
  const IconComponent = {
    DollarSign, Users, Code, Megaphone, Scale, Briefcase, Heart, GraduationCap, Building2
  }[data.icon] || Building2;

  return (
    <div 
      className={`px-4 py-3 rounded-lg border-2 shadow-lg min-w-[200px] bg-white `}
      style={{ borderColor: data.color }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="p-2 rounded-full" style={{ backgroundColor: `${data.color}20` }}>
          <IconComponent className="h-5 w-5" style={{ color: data.color }} />
        </div>
        <div>
          <h3 className="font-semibold text-sm">{data.label}</h3>
          <Badge variant="outline" className="text-xs" role="status">
            L{data.romaLevel} • {data.agentCount} agents
          </Badge>
        </div>
      </div>
      {data.isActive ? (
        <div className="flex items-center gap-1 text-green-600 text-xs">
          <CheckCircle className="h-3 w-3" />
          <span>Active</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-gray-400 text-xs">
          <Clock className="h-3 w-3" />
          <span>Inactive</span>
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  department: DepartmentNodeComponent,
};

export default function ArchitectWorkflowBuilder() {
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const [orgConfig, setOrgConfig] = useState<OrganizationConfig>({
    name: 'My Organization',
    description: 'AI-powered enterprise organization',
    corporateDNA: {
      tone: 'professional',
      riskProfile: 'balanced',
      values: ['innovation', 'customer-first', 'integrity'],
      ethicalGuidelines: ['data-privacy', 'fairness', 'transparency'],
      budgetConstraint: 'medium',
      qualityPriority: 'balanced',
    },
    departments: [],
    connections: [],
  });

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
        ...params,
        type: 'smoothstep',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        label: 'collaborates',
        style: { stroke: '#152448' },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
  );

  const addDepartment = (module: DepartmentModule) => {
    const newNode: Node = {
      id: `${module.id}-${Date.now()}`,
      type: 'department',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: {
        label: module.name,
        icon: module.icon,
        color: module.color,
        moduleId: module.id,
        agents: module.agents.map(a => a.id),
        agentCount: module.agents.length,
        romaLevel: 3,
        isActive: true,
        workflows: module.workflows,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    toast({
      title: "Department Added",
      description: `${module.name} has been added to your organization`,
    });
  };

  const applyTemplate = (templateId: string) => {
    const template = teamTemplates.find(t => t.id === templateId);
    if (!template) return;

    const newNodes: Node[] = [];
    let xOffset = 100;

    template.departments.forEach((deptId, index) => {
      const module = departmentModules.find(m => m.id === deptId);
      if (module) {
        newNodes.push({
          id: `${module.id}-${Date.now()}-${index}`,
          type: 'department',
          position: { x: xOffset, y: 150 + (index % 2) * 180 },
          data: {
            label: module.name,
            icon: module.icon,
            color: module.color,
            moduleId: module.id,
            agents: module.agents.map(a => a.id),
            agentCount: module.agents.length,
            romaLevel: 3,
            isActive: true,
            workflows: module.workflows,
          },
        });
        xOffset += 280;
      }
    });

    setNodes(newNodes);
    setEdges([]);
    
    toast({
      title: "Template Applied",
      description: `${template.name} organization structure loaded`,
    });
  };

  const generateConfig = () => {
    const config = {
      version: '1.0.0',
      organization: {
        name: orgConfig.name,
        description: orgConfig.description,
      },
      corporateDNA: orgConfig.corporateDNA,
      departments: nodes.map(node => ({
        id: node.id,
        moduleId: node.data.moduleId,
        name: node.data.label,
        position: node.position,
        agents: node.data.agents,
        romaLevel: node.data.romaLevel,
        isActive: node.data.isActive,
        workflows: node.data.workflows,
      })),
      connections: edges.map(edge => ({
        source: edge.source,
        target: edge.target,
        type: edge.label || 'collaborates',
      })),
      generatedAt: new Date().toISOString(),
    };
    return config;
  };

  const exportConfig = () => {
    const config = generateConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nyayavigya.config.json';
    a.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: "Configuration Exported",
      description: "nyayavigya.config.json has been downloaded",
    });
  };

  const deployOrganization = async () => {
    const config = generateConfig();

    try {
      // task-258 (2026-05-13): /api/architect/deploy now persists the graph
      // to sdk_workflows (workflow_type='architect_org') and returns the
      // deployed workflow id + a /architect?deployed=<id> URL we surface in
      // the success toast as an action link.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = typeof window !== 'undefined'
        ? (localStorage.getItem('nv_access_token') || localStorage.getItem('access_token') || '')
        : '';
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('/api/architect/deploy', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(config),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        const deployedWorkflowId = result.data?.workflowId;
        const deployedUrl: string | undefined = result.data?.url;
        const departmentCount = result.data?.departmentCount ?? nodes.length;
        const agentCount = result.data?.agentCount
          ?? nodes.reduce((acc, n) => acc + (n.data.agentCount || 0), 0);

        toast({
          title: "Organization Deployed",
          description: `Deployed ${departmentCount} departments with ${agentCount} agents${deployedWorkflowId ? ` — workflow ${deployedWorkflowId}` : ''}`,
          action: deployedUrl ? (
            <ToastAction
              altText="View deployed workflow"
              onClick={() => { window.location.href = deployedUrl; }}
              data-testid="link-deployed-workflow"
            >
              View
            </ToastAction>
          ) : undefined,
        });
      } else {
        toast({
          title: "Deployment Failed",
          description: result.error || result.message || "Failed to deploy organization",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to deploy organization",
        variant: "destructive",
      });
    }
  };

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const updateNodeData = (nodeId: string, updates: Partial<any>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...updates } }
          : node
      )
    );
  };

  const deleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNode(null);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 ">
      <div className="border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Architect Workflow Builder</h1>
              <p className="text-sm text-muted-foreground">
                Design your AI-powered organization with drag-and-drop
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
              <DialogTrigger asChild aria-label="Open dialog">
                <Button variant="outline" data-testid="button-corporate-dna">
                  <Brain className="h-4 w-4 mr-2" />
                  Corporate DNA
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Corporate DNA Configuration</DialogTitle>
                  <DialogDescription>
                    Define the behavioral guidelines for all agents in your organization
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Organization Name</Label>
                      <Input 
                        value={orgConfig.name}
                        onChange={(e) => setOrgConfig({ ...orgConfig, name: e.target.value })}
                        data-testid="input-org-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tone</Label>
                      <Select 
                        value={orgConfig.corporateDNA.tone}
                        onValueChange={(v) => setOrgConfig({
                          ...orgConfig,
                          corporateDNA: { ...orgConfig.corporateDNA, tone: v as any }
                        })}
                      >
                        <SelectTrigger data-testid="select-tone">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="professional">Professional</SelectItem>
                          <SelectItem value="casual">Casual</SelectItem>
                          <SelectItem value="empathetic">Empathetic</SelectItem>
                          <SelectItem value="academic">Academic</SelectItem>
                          <SelectItem value="formal">Formal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Risk Profile</Label>
                      <Select 
                        value={orgConfig.corporateDNA.riskProfile}
                        onValueChange={(v) => setOrgConfig({
                          ...orgConfig,
                          corporateDNA: { ...orgConfig.corporateDNA, riskProfile: v as any }
                        })}
                      >
                        <SelectTrigger data-testid="select-risk-profile">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="conservative">Conservative</SelectItem>
                          <SelectItem value="balanced">Balanced</SelectItem>
                          <SelectItem value="aggressive">Aggressive</SelectItem>
                          <SelectItem value="experimental">Experimental</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Budget Constraint</Label>
                      <Select 
                        value={orgConfig.corporateDNA.budgetConstraint}
                        onValueChange={(v) => setOrgConfig({
                          ...orgConfig,
                          corporateDNA: { ...orgConfig.corporateDNA, budgetConstraint: v as any }
                        })}
                      >
                        <SelectTrigger data-testid="select-budget">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="unlimited">Unlimited</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Quality Priority</Label>
                    <Select 
                      value={orgConfig.corporateDNA.qualityPriority}
                      onValueChange={(v) => setOrgConfig({
                        ...orgConfig,
                        corporateDNA: { ...orgConfig.corporateDNA, qualityPriority: v as any }
                      })}
                    >
                      <SelectTrigger data-testid="select-quality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="speed">Speed First</SelectItem>
                        <SelectItem value="balanced">Balanced</SelectItem>
                        <SelectItem value="quality">Quality First</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea 
                      value={orgConfig.description}
                      onChange={(e) => setOrgConfig({ ...orgConfig, description: e.target.value })}
                      placeholder="Describe your organization..."
                      data-testid="textarea-description"
                    />
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            
            <Button variant="outline" onClick={exportConfig} data-testid="button-export">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button onClick={deployOrganization} data-testid="button-deploy">
              <Play className="h-4 w-4 mr-2" />
              Deploy
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex">
        <div className="w-80 border-r bg-white flex flex-col">
          <Tabs defaultValue="modules" className="flex-1 flex flex-col">
            <TabsList className="m-4" aria-label="Navigation tabs">
              <TabsTrigger value="modules" aria-label="modules tab">Modules</TabsTrigger>
              <TabsTrigger value="templates" aria-label="templates tab">Templates</TabsTrigger>
            </TabsList>
            
            <TabsContent value="modules" className="flex-1 px-4 pb-4">
              <ScrollArea className="h-[calc(100vh-220px)]" aria-label="Scrollable content">
                <div className="space-y-3">
                  {departmentModules.map((module) => (
                    <Card 
                      key={module.id}
                      className="cursor-pointer hover:shadow-md transition-all hover:scale-[1.02]"
                      onClick={() => addDepartment(module)}
                      data-testid={`card-module-${module.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div 
                            className="p-2 rounded-lg"
                            style={{ backgroundColor: `${module.color}20` }}
                          >
                            {module.icon === 'DollarSign' && <DollarSign className="h-5 w-5" style={{ color: module.color }} />}
                            {module.icon === 'Users' && <Users className="h-5 w-5" style={{ color: module.color }} />}
                            {module.icon === 'Code' && <Code className="h-5 w-5" style={{ color: module.color }} />}
                            {module.icon === 'Megaphone' && <Megaphone className="h-5 w-5" style={{ color: module.color }} />}
                            {module.icon === 'Scale' && <Scale className="h-5 w-5" style={{ color: module.color }} />}
                            {module.icon === 'Briefcase' && <Briefcase className="h-5 w-5" style={{ color: module.color }} />}
                            {module.icon === 'Heart' && <Heart className="h-5 w-5" style={{ color: module.color }} />}
                            {module.icon === 'GraduationCap' && <GraduationCap className="h-5 w-5" style={{ color: module.color }} />}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-sm">{module.name}</h3>
                            <p className="text-xs text-muted-foreground">{module.description}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge variant="secondary" className="text-xs" role="status">
                                <Bot className="h-3 w-3 mr-1" />
                                {module.agents.length} agents
                              </Badge>
                              <Badge variant="outline" className="text-xs" role="status">
                                <Workflow className="h-3 w-3 mr-1" />
                                {module.workflows.length}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="templates" className="flex-1 px-4 pb-4">
              <ScrollArea className="h-[calc(100vh-220px)]" aria-label="Scrollable content">
                <div className="space-y-3">
                  {teamTemplates.map((template) => (
                    <Card 
                      key={template.id}
                      className="cursor-pointer hover:shadow-md transition-all hover:scale-[1.02]"
                      onClick={() => applyTemplate(template.id)}
                      data-testid={`card-template-${template.id}`}
                    >
                      <CardContent className="p-4">
                        <h3 className="font-semibold text-sm">{template.name}</h3>
                        <p className="text-xs text-muted-foreground mb-2">{template.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {template.departments.map((dept) => (
                            <Badge key={dept} variant="outline" className="text-xs" role="status">
                              {dept}
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-gray-100 "
          >
            <Background />
            <Controls />
            <MiniMap 
              nodeColor={(node) => node.data?.color || '#6366f1'}
              maskColor="rgba(0, 0, 0, 0.1)"
            />
            <Panel position="top-right" className="bg-white p-3 rounded-lg shadow-lg border">
              <div className="text-sm space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-violet-600" />
                  <span className="font-medium">{nodes.length} Departments</span>
                </div>
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-blue-600" />
                  <span className="font-medium">
                    {nodes.reduce((acc, n) => acc + (n.data?.agentCount || 0), 0)} Agents
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-green-600" />
                  <span className="font-medium">{edges.length} Connections</span>
                </div>
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {selectedNode && (
          <div className="w-80 border-l bg-white p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Department Settings</h3>
              <Button variant="ghost" size="sm" onClick={() => deleteNode(selectedNode.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Department Name</Label>
                <Input 
                  value={selectedNode.data.label}
                  onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                  data-testid="input-dept-name"
                />
              </div>
              
              <div className="space-y-2">
                <Label>ROMA Autonomy Level</Label>
                <Select 
                  value={String(selectedNode.data.romaLevel)}
                  onValueChange={(v) => updateNodeData(selectedNode.id, { romaLevel: parseInt(v) })}
                >
                  <SelectTrigger data-testid="select-roma-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">L1 - Manual (Human approves all)</SelectItem>
                    <SelectItem value="2">L2 - Assisted (Agent suggests)</SelectItem>
                    <SelectItem value="3">L3 - Conditional (Auto within bounds)</SelectItem>
                    <SelectItem value="4">L4 - Autonomous (Full auto, high-stakes pause)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch 
                  checked={selectedNode.data.isActive}
                  onCheckedChange={(v) => updateNodeData(selectedNode.id, { isActive: v })}
                  data-testid="switch-active"
                />
              </div>
              
              <Separator />
              
              <div className="space-y-2">
                <Label>Agents ({selectedNode.data.agentCount})</Label>
                <div className="space-y-1">
                  {(selectedNode.data.agents || []).slice(0, 5).map((agentId: string) => (
                    <div key={agentId} className="flex items-center gap-2 text-sm p-2 bg-gray-50 rounded">
                      <Bot className="h-3 w-3" />
                      <span>{agentId}</span>
                    </div>
                  ))}
                  {(selectedNode.data.agents || []).length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      +{selectedNode.data.agents.length - 5} more agents
                    </p>
                  )}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Workflows</Label>
                <div className="flex flex-wrap gap-1">
                  {(selectedNode.data.workflows || []).map((workflow: string) => (
                    <Badge key={workflow} variant="outline" className="text-xs" role="status">
                      {workflow}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
