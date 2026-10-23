/**
 * Project Approval Flow Component - Replit-style
 * Visual plan generation with cost estimation and approval workflow
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  DollarSign,
  Cpu,
  Database,
  Cloud,
  Shield,
  Users,
  Zap,
  Package,
  GitBranch,
  FileCode,
  Layout,
  Server,
  Activity,
  ChevronRight,
  Sparkles,
  Play,
  Edit3,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TechStackItem {
  category: string;
  name: string;
  version?: string;
  icon?: React.ReactNode;
  reason?: string;
}

interface ProjectCost {
  infrastructure: number;
  development: number;
  maintenance: number;
  total: number;
  currency: string;
}

interface ResourceAllocation {
  cpu: number;
  memory: number;
  storage: number;
  bandwidth: number;
  agents: number;
}

interface ProjectPlan {
  projectName: string;
  projectType: string;
  description: string;
  techStack: TechStackItem[];
  architecture: {
    frontend?: string[];
    backend?: string[];
    database?: string[];
    services?: string[];
  };
  features: string[];
  timeline: {
    phase: string;
    duration: string;
    tasks: string[];
  }[];
  cost: ProjectCost;
  resources: ResourceAllocation;
  risks: { level: 'low' | 'medium' | 'high'; description: string }[];
  dependencies: string[];
}

interface ProjectApprovalFlowProps {
  projectData: {
    name: string;
    description: string;
    type: string;
    techStack?: any;
    figmaUrl?: string;
  };
  onApprove: () => void;
  onReject: () => void;
  onModify: () => void;
}

export default function ProjectApprovalFlow({ 
  projectData, 
  onApprove, 
  onReject, 
  onModify 
}: ProjectApprovalFlowProps) {
  const [isGenerating, setIsGenerating] = useState(true);
  const [projectPlan, setProjectPlan] = useState<ProjectPlan | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');

  useEffect(() => {
    // Generate project plan using Jurexio orchestration
    generateProjectPlan();
  }, [projectData]);

  const generateProjectPlan = async () => {
    setIsGenerating(true);
    
    // Simulate AI analysis (in real implementation, call Jurexio Legal SDK)
    setTimeout(() => {
      const plan: ProjectPlan = {
        projectName: projectData.name,
        projectType: projectData.type,
        description: projectData.description,
        techStack: [
          { category: 'Frontend', name: 'React', version: '18.2', icon: <FileCode className="w-4 h-4" /> },
          { category: 'Backend', name: 'Node.js', version: '20.x', icon: <Server className="w-4 h-4" /> },
          { category: 'Database', name: 'PostgreSQL', version: '15', icon: <Database className="w-4 h-4" /> },
          { category: 'Cloud', name: 'AWS', icon: <Cloud className="w-4 h-4" /> },
        ],
        architecture: {
          frontend: ['React Components', 'State Management', 'Routing', 'UI Library'],
          backend: ['Express Server', 'REST APIs', 'Authentication', 'Middleware'],
          database: ['Schema Design', 'Migrations', 'Indexing', 'Backups'],
          services: ['Redis Cache', 'S3 Storage', 'CloudFront CDN', 'Lambda Functions']
        },
        features: [
          'User Authentication & Authorization',
          'Real-time Data Synchronization',
          'Advanced Search & Filtering',
          'Analytics Dashboard',
          'API Integration',
          'Mobile Responsive Design'
        ],
        timeline: [
          {
            phase: 'Planning & Setup',
            duration: '1 week',
            tasks: ['Requirements Analysis', 'Architecture Design', 'Environment Setup']
          },
          {
            phase: 'Core Development',
            duration: '4 weeks',
            tasks: ['Backend APIs', 'Frontend Components', 'Database Schema']
          },
          {
            phase: 'Testing & Deployment',
            duration: '1 week',
            tasks: ['Unit Testing', 'Integration Testing', 'Production Deployment']
          }
        ],
        cost: {
          infrastructure: 250,
          development: 5000,
          maintenance: 150,
          total: 5400,
          currency: 'USD'
        },
        resources: {
          cpu: 4,
          memory: 8,
          storage: 100,
          bandwidth: 500,
          agents: 12
        },
        risks: [
          { level: 'low', description: 'Third-party API rate limits' },
          { level: 'medium', description: 'Scalability concerns with real-time features' },
          { level: 'low', description: 'Browser compatibility issues' }
        ],
        dependencies: [
          'Node.js Runtime',
          'PostgreSQL Database',
          'Redis Cache',
          'AWS Account',
          'Domain Name'
        ]
      };
      
      setProjectPlan(plan);
      setIsGenerating(false);
    }, 2000);
  };

  const handleApprove = () => {
    setApprovalStatus('approved');
    onApprove();
  };

  const handleReject = () => {
    setApprovalStatus('rejected');
    onReject();
  };

  if (isGenerating) {
    return (
      <Card className="w-full">
        <CardContent className="p-8">
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              <Sparkles className="w-6 h-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">Analyzing Project Requirements</h3>
              <p className="text-sm text-muted-foreground">Jurexio agents are generating your project plan...</p>
            </div>
            <Progress value={33} className="w-64" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!projectPlan) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl">{projectPlan.projectName}</CardTitle>
            <CardDescription className="mt-2">{projectPlan.description}</CardDescription>
          </div>
          <Badge variant={approvalStatus === 'approved' ? 'default' : approvalStatus === 'rejected' ? 'destructive' : 'secondary'}>
            {approvalStatus === 'approved' ? 'Approved' : approvalStatus === 'rejected' ? 'Rejected' : 'Pending Approval'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="architecture">Architecture</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="cost">Cost & Resources</TabsTrigger>
            <TabsTrigger value="risks">Risks & Deps</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Project Features</h3>
              <div className="grid grid-cols-2 gap-3">
                {projectPlan.features.map((feature, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-center space-x-2 p-3 bg-secondary/50 rounded-lg"
                  >
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-sm">{feature}</span>
                  </motion.div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4">Technology Stack</h3>
              <div className="grid grid-cols-2 gap-4">
                {projectPlan.techStack.map((tech, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      {tech.icon}
                      <div>
                        <p className="font-medium">{tech.name}</p>
                        <p className="text-xs text-muted-foreground">{tech.category}</p>
                      </div>
                    </div>
                    {tech.version && (
                      <Badge variant="outline">{tech.version}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="architecture" className="mt-6">
            <div className="space-y-6">
              <div className="bg-secondary/20 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 flex items-center">
                  <Layout className="w-5 h-5 mr-2" />
                  System Architecture
                </h3>
                <div className="grid grid-cols-2 gap-6">
                  {Object.entries(projectPlan.architecture).map(([layer, components]) => (
                    <div key={layer} className="space-y-2">
                      <h4 className="font-medium capitalize text-primary">{layer}</h4>
                      <div className="space-y-1">
                        {components?.map((comp, idx) => (
                          <div key={idx} className="flex items-center space-x-2 text-sm">
                            <ChevronRight className="w-3 h-3 text-muted-foreground" />
                            <span>{comp}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Alert>
                <Zap className="w-4 h-4" />
                <AlertDescription>
                  This architecture is optimized for scalability and uses Jurexio's ROMA L5 agents for automated development
                </AlertDescription>
              </Alert>
            </div>
          </TabsContent>

          <TabsContent value="timeline" className="mt-6">
            <div className="space-y-4">
              {projectPlan.timeline.map((phase, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="border rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold">{phase.phase}</h4>
                    <Badge variant="outline">
                      <Clock className="w-3 h-3 mr-1" />
                      {phase.duration}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {phase.tasks.map((task, idx) => (
                      <div key={idx} className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                        <span>{task}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="cost" className="mt-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Cost Breakdown</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <span className="flex items-center">
                      <Server className="w-4 h-4 mr-2" />
                      Infrastructure
                    </span>
                    <span className="font-mono">${projectPlan.cost.infrastructure}/mo</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <span className="flex items-center">
                      <Users className="w-4 h-4 mr-2" />
                      Development
                    </span>
                    <span className="font-mono">${projectPlan.cost.development}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <span className="flex items-center">
                      <Shield className="w-4 h-4 mr-2" />
                      Maintenance
                    </span>
                    <span className="font-mono">${projectPlan.cost.maintenance}/mo</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg font-semibold">
                    <span>Total Estimated Cost</span>
                    <span className="font-mono text-lg">${projectPlan.cost.total}</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-4">Resource Allocation</h3>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center">
                        <Cpu className="w-3 h-3 mr-1" /> CPU Cores
                      </span>
                      <span>{projectPlan.resources.cpu}</span>
                    </div>
                    <Progress value={projectPlan.resources.cpu * 25} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center">
                        <Activity className="w-3 h-3 mr-1" /> Memory
                      </span>
                      <span>{projectPlan.resources.memory} GB</span>
                    </div>
                    <Progress value={projectPlan.resources.memory * 12.5} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center">
                        <Database className="w-3 h-3 mr-1" /> Storage
                      </span>
                      <span>{projectPlan.resources.storage} GB</span>
                    </div>
                    <Progress value={projectPlan.resources.storage / 2} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center">
                        <Sparkles className="w-3 h-3 mr-1" /> AI Agents
                      </span>
                      <span>{projectPlan.resources.agents}</span>
                    </div>
                    <Progress value={projectPlan.resources.agents * 8} />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="risks" className="mt-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Risk Assessment</h3>
                <div className="space-y-3">
                  {projectPlan.risks.map((risk, index) => (
                    <div key={index} className="flex items-start space-x-3 p-3 border rounded-lg">
                      <AlertCircle className={`w-5 h-5 mt-0.5 ${
                        risk.level === 'high' ? 'text-red-500' :
                        risk.level === 'medium' ? 'text-yellow-500' :
                        'text-green-500'
                      }`} />
                      <div className="flex-1">
                        <Badge variant={
                          risk.level === 'high' ? 'destructive' :
                          risk.level === 'medium' ? 'secondary' :
                          'outline'
                        } className="mb-1">
                          {risk.level} risk
                        </Badge>
                        <p className="text-sm text-muted-foreground">{risk.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-4">Dependencies</h3>
                <div className="space-y-2">
                  {projectPlan.dependencies.map((dep, index) => (
                    <div key={index} className="flex items-center space-x-2 p-2 bg-secondary/50 rounded">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{dep}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="my-6" />

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <Sparkles className="w-4 h-4" />
            <span>Generated by Jurexio Unified Orchestration with 14+ LLMs</span>
          </div>

          {approvalStatus === 'pending' && (
            <div className="flex items-center space-x-3">
              <Button variant="outline" onClick={onModify}>
                <Edit3 className="w-4 h-4 mr-2" />
                Modify Plan
              </Button>
              <Button variant="destructive" onClick={handleReject}>
                Reject
              </Button>
              <Button onClick={handleApprove}>
                <Play className="w-4 h-4 mr-2" />
                Approve & Start
              </Button>
            </div>
          )}

          {approvalStatus === 'approved' && (
            <div className="flex items-center space-x-2 text-green-600">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Project Approved - Starting Development</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}