import { useState, useCallback } from 'react';
import ReactFlow, {
  Node, Edge, Controls, Background, MiniMap, Panel,
  useNodesState, useEdgesState, addEdge, Connection
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Users, Bot, GitBranch, Plus, Save, Download, Trash2,
  ChevronRight, Building2, Shield, Briefcase, ArrowDown
} from 'lucide-react';

interface TeamNode {
  id: string;
  name: string;
  type: 'executive' | 'department' | 'team' | 'agent';
  agentCount?: number;
  color: string;
}

const initialNodes: Node[] = [
  {
    id: 'ceo',
    position: { x: 400, y: 50 },
    data: { label: 'CEO Agent', type: 'executive', color: '#f59e0b' },
    style: { background: '#fef3c7', border: '2px solid #f59e0b', borderRadius: '12px', padding: '12px' }
  },
  {
    id: 'cto',
    position: { x: 200, y: 180 },
    data: { label: 'CTO Agent', type: 'executive', color: '#3b82f6' },
    style: { background: '#dbeafe', border: '2px solid #3b82f6', borderRadius: '12px', padding: '12px' }
  },
  {
    id: 'cfo',
    position: { x: 400, y: 180 },
    data: { label: 'CFO Agent', type: 'executive', color: '#22c55e' },
    style: { background: '#dcfce7', border: '2px solid #22c55e', borderRadius: '12px', padding: '12px' }
  },
  {
    id: 'cmo',
    position: { x: 600, y: 180 },
    data: { label: 'CMO Agent', type: 'executive', color: '#ec4899' },
    style: { background: '#fce7f3', border: '2px solid #ec4899', borderRadius: '12px', padding: '12px' }
  },
  {
    id: 'dev-team',
    position: { x: 150, y: 320 },
    data: { label: 'Development Team', type: 'team', agentCount: 6, color: '#3b82f6' },
    style: { background: '#dbeafe', border: '2px solid #3b82f6', borderRadius: '12px', padding: '12px' }
  },
  {
    id: 'finance-team',
    position: { x: 350, y: 320 },
    data: { label: 'Finance Team', type: 'team', agentCount: 5, color: '#22c55e' },
    style: { background: '#dcfce7', border: '2px solid #22c55e', borderRadius: '12px', padding: '12px' }
  },
  {
    id: 'marketing-team',
    position: { x: 550, y: 320 },
    data: { label: 'Marketing Team', type: 'team', agentCount: 5, color: '#ec4899' },
    style: { background: '#fce7f3', border: '2px solid #ec4899', borderRadius: '12px', padding: '12px' }
  },
];

const initialEdges: Edge[] = [
  { id: 'ceo-cto', source: 'ceo', target: 'cto', animated: true },
  { id: 'ceo-cfo', source: 'ceo', target: 'cfo', animated: true },
  { id: 'ceo-cmo', source: 'ceo', target: 'cmo', animated: true },
  { id: 'cto-dev', source: 'cto', target: 'dev-team' },
  { id: 'cfo-finance', source: 'cfo', target: 'finance-team' },
  { id: 'cmo-marketing', source: 'cmo', target: 'marketing-team' },
];

const hierarchyTemplates = [
  { id: 'flat', name: 'Flat Structure', description: 'All teams report directly to CEO' },
  { id: 'functional', name: 'Functional', description: 'Teams grouped by function with C-level leaders' },
  { id: 'matrix', name: 'Matrix', description: 'Cross-functional teams with dual reporting' },
  { id: 'divisional', name: 'Divisional', description: 'Self-contained divisions by product/region' },
];

const availableTeams = [
  { id: 'sales-team', name: 'Sales Team', agentCount: 5, color: '#ef4444' },
  { id: 'hr-team', name: 'HR Team', agentCount: 5, color: '#8b5cf6' },
  { id: 'research-team', name: 'Research Team', agentCount: 5, color: '#06b6d4' },
  { id: 'security-team', name: 'Security Team', agentCount: 5, color: '#64748b' },
  { id: 'content-team', name: 'Content Team', agentCount: 5, color: '#a855f7' },
  { id: 'customer-success', name: 'Customer Success', agentCount: 4, color: '#14b8a6' },
];

export default function TeamHierarchyBuilder() {
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedTemplate, setSelectedTemplate] = useState('functional');

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => addEdge({ ...params, animated: true }, eds));
  }, [setEdges]);

  const addTeamToHierarchy = (team: typeof availableTeams[0]) => {
    const newNode: Node = {
      id: team.id,
      position: { x: Math.random() * 400 + 100, y: 400 },
      data: { label: team.name, type: 'team', agentCount: team.agentCount, color: team.color },
      style: {
        background: `${team.color}20`,
        border: `2px solid ${team.color}`,
        borderRadius: '12px',
        padding: '12px'
      }
    };
    setNodes((nds) => [...nds, newNode]);
    toast({ title: 'Team Added', description: `${team.name} added to hierarchy` });
  };

  const saveHierarchy = () => {
    const hierarchy = { nodes, edges, template: selectedTemplate };
    console.log('Saving hierarchy:', hierarchy);
    toast({ title: 'Hierarchy Saved', description: 'Organization hierarchy saved successfully' });
  };

  const exportHierarchy = () => {
    const data = JSON.stringify({ nodes, edges }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'org-hierarchy.json';
    a.click();
    toast({ title: 'Hierarchy Exported', description: 'Downloaded as org-hierarchy.json' });
  };

  return (
    <div className="space-y-6" data-testid="team-hierarchy-builder">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-hierarchy-title">Team Hierarchy Builder</h2>
          <p className="text-muted-foreground">Design your organization's agent team structure and reporting lines</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportHierarchy} data-testid="button-export-hierarchy">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button onClick={saveHierarchy} data-testid="button-save-hierarchy">
            <Save className="w-4 h-4 mr-2" />
            Save Hierarchy
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Structure Templates</CardTitle>
              <CardDescription className="text-xs">Apply a pre-built hierarchy template</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {hierarchyTemplates.map(template => (
                <Button
                  key={template.id}
                  variant={selectedTemplate === template.id ? 'default' : 'outline'}
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setSelectedTemplate(template.id)}
                  data-testid={`button-template-${template.id}`}
                >
                  <GitBranch className="w-4 h-4 mr-2" />
                  {template.name}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Available Teams</CardTitle>
              <CardDescription className="text-xs">Drag or click to add to hierarchy</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {availableTeams.map(team => (
                    <Button
                      key={team.id}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => addTeamToHierarchy(team)}
                      disabled={nodes.some(n => n.id === team.id)}
                      data-testid={`button-add-team-${team.id}`}
                    >
                      <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: team.color }} />
                      {team.name}
                      <Badge variant="secondary" className="ml-auto text-xs">{team.agentCount}</Badge>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Hierarchy Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Teams</span>
                <span className="font-medium" data-testid="text-total-teams">{nodes.filter(n => n.data.type === 'team').length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Executives</span>
                <span className="font-medium" data-testid="text-total-executives">{nodes.filter(n => n.data.type === 'executive').length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Connections</span>
                <span className="font-medium" data-testid="text-total-connections">{edges.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Agents</span>
                <span className="font-medium" data-testid="text-total-agents">
                  {nodes.reduce((sum, n) => sum + (n.data.agentCount || 1), 0)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-9">
          <Card className="h-[600px]">
            <CardContent className="p-0 h-full">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                fitView
              >
                <Background />
                <Controls />
                <MiniMap />
                <Panel position="top-right">
                  <Card className="shadow-lg">
                    <CardContent className="p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-amber-500" />
                          <span>Executive</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-blue-500" />
                          <span>Team</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Panel>
              </ReactFlow>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
