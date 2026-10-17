import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnimatedList } from "@/components/react-bits/animated-list";

interface AgentOrchestrationProps {
  agentStatus: any[];
  systemHealth: any;
  projectId: number;
}

interface ActivityEntry {
  id: string;
  type: string;
  message: string;
  timestamp: Date;
  agent?: string;
  status?: string;
}

export function AgentOrchestration({ agentStatus, systemHealth, projectId }: AgentOrchestrationProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Fetch real-time activity
  const { data: activityData } = useQuery({
    queryKey: ['/api/agents/activity', projectId],
    queryFn: async () => {
      // In a real implementation, this would fetch from an activity endpoint
      // For now, we'll simulate with recent agent executions
      return [];
    },
    refetchInterval: 5000
  });

  const leadershipAgents = [
    {
      id: 'cto-agent',
      name: 'CTO Agent',
      role: 'Technical Leadership',
      icon: 'fas fa-user-tie',
      color: 'primary',
      status: agentStatus?.find(a => a.id === 'cto-agent')?.status || 'idle',
      currentTask: 'Architecting microservices'
    },
    {
      id: 'cpo-agent',
      name: 'CPO Agent',
      role: 'Product Strategy',
      icon: 'fas fa-chart-line',
      color: 'secondary',
      status: agentStatus?.find(a => a.id === 'cpo-agent')?.status || 'idle',
      currentTask: 'Defining user stories'
    },
    {
      id: 'cmo-agent',
      name: 'CMO Agent',
      role: 'Marketing Strategy',
      icon: 'fas fa-bullhorn',
      color: 'accent',
      status: agentStatus?.find(a => a.id === 'cmo-agent')?.status || 'idle',
      currentTask: 'Creating go-to-market plan'
    }
  ];

  const bmadAgents = [
    {
      id: 'analyst-agent',
      name: 'Analyst Agent',
      role: 'Requirements Analysis',
      icon: 'fas fa-search',
      color: 'blue',
      status: agentStatus?.find(a => a.id === 'analyst-agent')?.status || 'idle'
    },
    {
      id: 'architect-agent',
      name: 'Architect Agent',
      role: 'System Design',
      icon: 'fas fa-sitemap',
      color: 'purple',
      status: agentStatus?.find(a => a.id === 'architect-agent')?.status || 'idle'
    },
    {
      id: 'frontend-agent',
      name: 'Frontend Agent',
      role: 'UI Development',
      icon: 'fas fa-code',
      color: 'green',
      status: agentStatus?.find(a => a.id === 'frontend-agent')?.status || 'idle'
    },
    {
      id: 'backend-agent',
      name: 'Backend Agent',
      role: 'API Development',
      icon: 'fas fa-server',
      color: 'orange',
      status: agentStatus?.find(a => a.id === 'backend-agent')?.status || 'idle'
    },
    {
      id: 'qa-agent',
      name: 'QA Agent',
      role: 'Quality Assurance',
      icon: 'fas fa-bug',
      color: 'red',
      status: agentStatus?.find(a => a.id === 'qa-agent')?.status || 'idle'
    },
    {
      id: 'devops-agent',
      name: 'DevOps Agent',
      role: 'Deployment',
      icon: 'fas fa-rocket',
      color: 'cyan',
      status: agentStatus?.find(a => a.id === 'devops-agent')?.status || 'idle'
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-accent-500';
      case 'idle': return 'bg-gray-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return 'Active';
      case 'idle': return 'Idle';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  };

  const mockActivityEntries: ActivityEntry[] = [
    {
      id: '1',
      type: 'completion',
      message: 'CTO Agent completed architecture review',
      timestamp: new Date(Date.now() - 2 * 60 * 1000),
      agent: 'cto-agent',
      status: 'completed'
    },
    {
      id: '2',
      type: 'creation',
      message: 'Database schema generated',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      agent: 'architect-agent',
      status: 'completed'
    },
    {
      id: '3',
      type: 'sync',
      message: 'CREW agents synchronized for frontend development',
      timestamp: new Date(Date.now() - 8 * 60 * 1000),
      agent: 'bmad-orchestrator',
      status: 'completed'
    },
    {
      id: '4',
      type: 'design',
      message: 'UI/UX components designed using TweakCN',
      timestamp: new Date(Date.now() - 12 * 60 * 1000),
      agent: 'ui-ux-agent',
      status: 'completed'
    },
    {
      id: '5',
      type: 'initialization',
      message: 'Mem0 context initialized for project memory',
      timestamp: new Date(Date.now() - 15 * 60 * 1000),
      agent: 'memory-agent',
      status: 'completed'
    }
  ];

  const executeAgentTask = async (agentId: string) => {
    try {
      const response = await fetch('/api/agents/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operation: `Manual task execution for ${agentId}`,
          content: `Execute a task using ${agentId}`,
          projectId,
          priority: 'medium',
          type: 'analysis'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to execute agent task');
      }

      const result = await response.json();
      console.log('Agent task executed:', result);
    } catch (error) {
      console.error('Error executing agent task:', error);
    }
  };

  return (
    <section>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Agent Overview */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Agent Orchestration</h2>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-accent-400">
                {agentStatus?.filter(a => a.status === 'active').length || 0} Agents Active
              </span>
            </div>
          </div>

          {/* Agent Categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Leadership Agents */}
            <Card className="bg-surface-800 p-6 border-surface-700">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <i className="fas fa-crown text-yellow-400 mr-2"></i>
                Leadership Agents
              </h3>
              <div className="space-y-3">
                {leadershipAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className={`p-3 rounded-lg transition-all duration-200 cursor-pointer ${
                      selectedAgent === agent.id 
                        ? 'bg-primary-500/20 border border-primary-500/50' 
                        : `bg-${agent.color}-500/10 border border-${agent.color}-500/20 hover:bg-${agent.color}-500/20`
                    }`}
                    onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 bg-${agent.color}-500 rounded-full flex items-center justify-center`}>
                          <i className={`${agent.icon} text-xs`}></i>
                        </div>
                        <div>
                          <p className="font-medium">{agent.name}</p>
                          <p className="text-xs text-gray-400">{agent.role}</p>
                        </div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)} animate-pulse`}></div>
                    </div>
                    {agent.currentTask && (
                      <div className="mt-2 text-xs text-gray-300">
                        <span className="animate-pulse">▶ {agent.currentTask}</span>
                      </div>
                    )}
                    {selectedAgent === agent.id && (
                      <div className="mt-3 pt-3 border-t border-gray-600">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            executeAgentTask(agent.id);
                          }}
                          className="w-full"
                        >
                          Execute Task
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            {/* BMAD Core Agents */}
            <Card className="bg-surface-800 p-6 border-surface-700">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <i className="fas fa-cogs text-blue-400 mr-2"></i>
                BMAD Core Agents
              </h3>
              <div className="space-y-3">
                {bmadAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className={`p-3 rounded-lg transition-all duration-200 cursor-pointer ${
                      selectedAgent === agent.id 
                        ? 'bg-primary-500/20 border border-primary-500/50' 
                        : `bg-${agent.color}-500/10 border border-${agent.color}-500/20 hover:bg-${agent.color}-500/20`
                    }`}
                    onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 bg-${agent.color}-500 rounded-full flex items-center justify-center`}>
                          <i className={`${agent.icon} text-xs`}></i>
                        </div>
                        <div>
                          <p className="font-medium">{agent.name}</p>
                          <p className="text-xs text-gray-400">{agent.role}</p>
                        </div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)} animate-pulse`}></div>
                    </div>
                    {selectedAgent === agent.id && (
                      <div className="mt-3 pt-3 border-t border-gray-600">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            executeAgentTask(agent.id);
                          }}
                          className="w-full"
                        >
                          Execute Task
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Agent Workflow Visualization */}
          <Card className="bg-surface-800 p-6 border-surface-700">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <i className="fas fa-project-diagram text-cyan-400 mr-2"></i>
              Current Workflow
            </h3>
            
            <div className="relative">
              <div className="flex items-center justify-between">
                {[
                  { name: 'PRD Analysis', status: 'complete', icon: 'fas fa-file-alt' },
                  { name: 'Architecture', status: 'active', icon: 'fas fa-sitemap' },
                  { name: 'Development', status: 'pending', icon: 'fas fa-code' },
                  { name: 'Deployment', status: 'pending', icon: 'fas fa-rocket' }
                ].map((step, index, array) => (
                  <div key={step.name} className="flex items-center">
                    <div className="flex flex-col items-center space-y-2">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        step.status === 'complete' ? 'bg-accent-500' :
                        step.status === 'active' ? 'bg-primary-500 animate-pulse' :
                        'bg-gray-600'
                      }`}>
                        <i className={`${step.icon} text-lg`}></i>
                      </div>
                      <span className="text-sm font-medium">{step.name}</span>
                      <Badge variant={
                        step.status === 'complete' ? 'default' :
                        step.status === 'active' ? 'destructive' :
                        'secondary'
                      }>
                        {step.status === 'complete' ? 'Complete' :
                         step.status === 'active' ? 'In Progress' :
                         'Pending'}
                      </Badge>
                    </div>
                    {index < array.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-4 ${
                        step.status === 'complete' ? 'bg-accent-500' : 'bg-gray-600'
                      }`}></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Real-time Activity */}
        <div className="space-y-6">
          <h3 className="text-lg font-semibold">Real-time Activity</h3>
          
          {/* Activity Feed */}
          <Card className="bg-surface-800 p-6 border-surface-700 max-h-96 overflow-y-auto">
            <AnimatedList
              items={mockActivityEntries}
              renderItem={(entry) => (
                <div className="flex items-start space-x-3 p-3 rounded bg-surface-700/50">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    entry.status === 'completed' ? 'bg-accent-500' : 'bg-blue-500'
                  }`}>
                    <i className={`fas ${
                      entry.type === 'completion' ? 'fa-check' :
                      entry.type === 'creation' ? 'fa-database' :
                      entry.type === 'sync' ? 'fa-users' :
                      entry.type === 'design' ? 'fa-paint-brush' :
                      'fa-brain'
                    } text-xs`}></i>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{entry.message}</p>
                    <p className="text-xs text-gray-400">
                      {entry.timestamp.toLocaleTimeString()} ago
                    </p>
                  </div>
                </div>
              )}
              className="space-y-2"
            />
          </Card>

          {/* System Health */}
          <Card className="bg-surface-800 p-6 border-surface-700">
            <h4 className="font-semibold mb-4 flex items-center">
              <i className="fas fa-heartbeat text-red-400 mr-2"></i>
              System Health
            </h4>
            <div className="space-y-3">
              {[
                { name: 'Jurexio Orchestration', status: 'healthy' },
                { name: 'LLM Providers', status: 'healthy', detail: '7/7 Online' },
                { name: 'Memory Context', status: 'healthy' },
                { name: 'MCP Servers', status: 'warning', detail: '2/3 Connected' }
              ].map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <span className="text-sm">{item.name}</span>
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${
                      item.status === 'healthy' ? 'bg-accent-500' :
                      item.status === 'warning' ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}></div>
                    <span className={`text-xs ${
                      item.status === 'healthy' ? 'text-accent-400' :
                      item.status === 'warning' ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {item.detail || (item.status === 'healthy' ? 'Healthy' : 'Error')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Cost Optimization */}
          <Card className="bg-surface-800 p-6 border-surface-700">
            <h4 className="font-semibold mb-4 flex items-center">
              <i className="fas fa-dollar-sign text-green-400 mr-2"></i>
              Cost Optimization
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Today's Usage</span>
                <span className="text-sm font-medium text-accent-400">$12.45</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div className="bg-accent-500 h-2 rounded-full" style={{ width: '24.9%' }}></div>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Budget: $50/day</span>
                <span>24.9% used</span>
              </div>
              <div className="text-xs text-accent-400">
                <i className="fas fa-arrow-down mr-1"></i>
                35% cost savings with intelligent routing
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
