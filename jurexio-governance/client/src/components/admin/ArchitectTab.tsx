import { useState, useCallback } from 'react';
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
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, Users, Bot, Plus, Save, Download, Play, Trash2, Copy,
  DollarSign, Clock, CheckCircle, Briefcase, GraduationCap, Heart, Scale, Megaphone, Code
} from "lucide-react";

interface DepartmentModule {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  agentCount: number;
  workflows: string[];
}

const departmentModules: DepartmentModule[] = [
  { id: 'finance', name: 'Finance', icon: 'DollarSign', color: '#22c55e', description: 'Financial operations', agentCount: 4, workflows: ['quote-to-cash', 'budget-approval'] },
  { id: 'hr', name: 'HR', icon: 'Users', color: '#8b5cf6', description: 'Human resources', agentCount: 4, workflows: ['recruitment', 'onboarding'] },
  { id: 'engineering', name: 'Engineering', icon: 'Code', color: '#3b82f6', description: 'Technical operations', agentCount: 5, workflows: ['sprint-planning', 'deployment'] },
  { id: 'marketing', name: 'Marketing', icon: 'Megaphone', color: '#f97316', description: 'Marketing strategy', agentCount: 4, workflows: ['campaign-launch', 'lead-nurturing'] },
  { id: 'legal', name: 'Legal', icon: 'Scale', color: '#64748b', description: 'Legal compliance', agentCount: 3, workflows: ['contract-approval', 'compliance-audit'] },
  { id: 'operations', name: 'Operations', icon: 'Briefcase', color: '#06b6d4', description: 'Business operations', agentCount: 3, workflows: ['inventory', 'vendor-management'] },
  { id: 'healthcare', name: 'Healthcare', icon: 'Heart', color: '#ec4899', description: 'Healthcare ops', agentCount: 3, workflows: ['patient-intake', 'compliance'] },
  { id: 'education', name: 'Education', icon: 'GraduationCap', color: '#a855f7', description: 'Educational content', agentCount: 3, workflows: ['course-creation', 'assessment'] },
];

const teamTemplates = [
  { id: 'startup-mvp', name: 'Startup MVP', departments: ['engineering', 'marketing'] },
  { id: 'enterprise', name: 'Enterprise', departments: ['finance', 'hr', 'engineering', 'marketing', 'legal', 'operations'] },
  { id: 'agency', name: 'Agency', departments: ['marketing', 'engineering'] },
  { id: 'healthcare-org', name: 'Healthcare Org', departments: ['healthcare', 'finance', 'hr', 'legal'] },
  { id: 'edtech', name: 'EdTech', departments: ['education', 'engineering', 'marketing'] },
];

const DepartmentNodeComponent = ({ data }: { data: any }) => {
  const IconMap: Record<string, any> = { DollarSign, Users, Code, Megaphone, Scale, Briefcase, Heart, GraduationCap, Building2 };
  const IconComponent = IconMap[data.icon] || Building2;

  return (
    <div className="px-4 py-3 rounded-lg border-2 shadow-lg min-w-[180px] bg-white dark:bg-gray-900" style={{ borderColor: data.color }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="p-2 rounded-full" style={{ backgroundColor: `${data.color}20` }}>
          <IconComponent className="h-4 w-4" style={{ color: data.color }} />
        </div>
        <div>
          <h3 className="font-semibold text-sm">{data.label}</h3>
          <Badge variant="outline" className="text-xs">L{data.romaLevel} • {data.agentCount} agents</Badge>
        </div>
      </div>
      <div className="flex items-center gap-1 text-green-600 text-xs">
        <CheckCircle className="h-3 w-3" />
        <span>Active</span>
      </div>
    </div>
  );
};

const nodeTypes = { department: DepartmentNodeComponent };

export default function ArchitectTab() {
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [orgName, setOrgName] = useState('My Organization');
  const [selectedTemplate, setSelectedTemplate] = useState('');

  const onConnect = useCallback((params: Connection) => {
    const newEdge = {
      ...params,
      type: 'smoothstep',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#6366f1' },
    };
    setEdges((eds) => addEdge(newEdge, eds));
  }, [setEdges]);

  const addDepartment = (module: DepartmentModule) => {
    const newNode: Node = {
      id: `dept-${Date.now()}`,
      type: 'department',
      position: { x: 100 + nodes.length * 220, y: 100 + (nodes.length % 3) * 120 },
      data: {
        label: module.name,
        icon: module.icon,
        color: module.color,
        agentCount: module.agentCount,
        romaLevel: 3,
        moduleId: module.id,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    toast({ title: 'Department Added', description: `${module.name} added to organization` });
  };

  const applyTemplate = (templateId: string) => {
    const template = teamTemplates.find(t => t.id === templateId);
    if (!template) return;
    
    setNodes([]);
    setEdges([]);
    
    const newNodes: Node[] = template.departments.map((deptId, index) => {
      const module = departmentModules.find(m => m.id === deptId)!;
      return {
        id: `dept-${deptId}`,
        type: 'department',
        position: { x: 100 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 150 },
        data: {
          label: module.name,
          icon: module.icon,
          color: module.color,
          agentCount: module.agentCount,
          romaLevel: 3,
          moduleId: module.id,
        },
      };
    });
    
    setNodes(newNodes);
    setSelectedTemplate(templateId);
    toast({ title: 'Template Applied', description: `${template.name} organization structure loaded` });
  };

  const exportConfig = () => {
    const config = {
      name: orgName,
      version: '1.0.0',
      departments: nodes.map(n => ({
        id: n.data.moduleId,
        name: n.data.label,
        romaLevel: n.data.romaLevel,
        position: n.position,
      })),
      connections: edges.map(e => ({ source: e.source, target: e.target })),
      generatedAt: new Date().toISOString(),
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jurexio.config.json';
    a.click();
    
    toast({ title: 'Config Exported', description: 'jurexio.config.json downloaded' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Organization Architect</h2>
          <p className="text-sm text-muted-foreground">Visual drag-drop organization builder with ROMA L1-L4 support</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportConfig} data-testid="button-export-config">
            <Download className="w-4 h-4 mr-1" />
            Export Config
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Organization</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} data-testid="input-org-name" />
              </div>
              <div>
                <Label>Template</Label>
                <Select value={selectedTemplate} onValueChange={applyTemplate}>
                  <SelectTrigger data-testid="select-org-template">
                    <SelectValue placeholder="Choose template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {teamTemplates.map(t => (
                      <SelectItem key={t.id} value={t.id} data-testid={`option-template-${t.id}`}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Departments</CardTitle>
              <CardDescription className="text-xs">Click to add to canvas</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {departmentModules.map(module => {
                    const IconMap: Record<string, any> = { DollarSign, Users, Code, Megaphone, Scale, Briefcase, Heart, GraduationCap };
                    const Icon = IconMap[module.icon] || Building2;
                    return (
                      <Button
                        key={module.id}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => addDepartment(module)}
                        data-testid={`button-add-${module.id}`}
                      >
                        <Icon className="w-4 h-4 mr-2" style={{ color: module.color }} />
                        {module.name}
                        <Badge variant="secondary" className="ml-auto text-xs">{module.agentCount}</Badge>
                      </Button>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-9">
          <Card className="h-[500px]">
            <CardContent className="p-0 h-full">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView
              >
                <Background />
                <Controls />
                <MiniMap />
                <Panel position="top-right">
                  <div className="bg-white dark:bg-gray-900 p-2 rounded shadow text-xs">
                    {nodes.length} departments • {edges.length} connections
                  </div>
                </Panel>
              </ReactFlow>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
