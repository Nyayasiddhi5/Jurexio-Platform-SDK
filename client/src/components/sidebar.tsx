import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SidebarProps {
  projects: any[];
  currentProjectId: number;
  onProjectChange: (projectId: number) => void;
  agentStatus: any[];
  systemHealth: any;
}

export function Sidebar({ projects, currentProjectId, onProjectChange, agentStatus, systemHealth }: SidebarProps) {
  const activeAgents = agentStatus?.filter(agent => agent.status === 'active') || [];
  const idleAgents = agentStatus?.filter(agent => agent.status === 'idle') || [];
  
  const getAgentStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-accent-500';
      case 'idle': return 'bg-gray-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  const getAgentDisplayName = (agentId: string) => {
    return agentId.replace('-agent', '').replace('_', ' ').split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <aside className="w-64 bg-surface-800 border-r border-surface-700 p-6">
      <div className="space-y-6">
        {/* Quick Actions */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3">QUICK ACTIONS</h3>
          <div className="space-y-2">
            <Button
              className="w-full justify-start bg-primary-500/10 border border-primary-500/20 hover:bg-primary-500/20 transition-all group"
              variant="ghost"
            >
              <i className="fas fa-plus text-primary-400 group-hover:scale-110 transition-transform mr-3"></i>
              <span className="text-sm font-medium">New Project</span>
            </Button>
            <Button
              className="w-full justify-start hover:bg-surface-700 transition-colors"
              variant="ghost"
            >
              <i className="fas fa-upload text-gray-400 mr-3"></i>
              <span className="text-sm">Upload Documents</span>
            </Button>
          </div>
        </div>

        {/* Active Agents */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3">ACTIVE AGENTS</h3>
          <div className="space-y-2">
            {activeAgents.slice(0, 3).map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between p-2 rounded-lg bg-accent-500/10"
              >
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${getAgentStatusColor(agent.status)} animate-pulse`}></div>
                  <span className="text-sm">{getAgentDisplayName(agent.id)}</span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {agent.status}
                </Badge>
              </div>
            ))}
            
            {idleAgents.slice(0, 2).map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between p-2 rounded-lg bg-gray-500/10"
              >
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${getAgentStatusColor(agent.status)}`}></div>
                  <span className="text-sm">{getAgentDisplayName(agent.id)}</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {agent.status}
                </Badge>
              </div>
            ))}

            {agentStatus && agentStatus.length > 5 && (
              <div className="text-xs text-gray-400 text-center py-1">
                +{agentStatus.length - 5} more agents
              </div>
            )}
          </div>
        </div>

        {/* Recent Projects */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3">RECENT PROJECTS</h3>
          <div className="space-y-2">
            {projects.slice(0, 5).map((project) => (
              <div
                key={project.id}
                className={`p-2 rounded-lg cursor-pointer transition-colors ${
                  project.id === currentProjectId
                    ? 'bg-primary-500/20 border border-primary-500/30'
                    : 'hover:bg-surface-700'
                }`}
                onClick={() => onProjectChange(project.id)}
              >
                <p className="text-sm font-medium truncate">{project.name}</p>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-400">
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </p>
                  <Badge 
                    variant={
                      project.status === 'completed' ? 'default' :
                      project.status === 'development' ? 'destructive' :
                      'secondary'
                    }
                    className="text-xs"
                  >
                    {project.status}
                  </Badge>
                </div>
              </div>
            ))}
            
            {projects.length === 0 && (
              <div className="text-center py-4 text-gray-400">
                <i className="fas fa-folder-open text-2xl mb-2"></i>
                <p className="text-sm">No projects yet</p>
              </div>
            )}
          </div>
        </div>

        {/* System Status */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3">SYSTEM STATUS</h3>
          <Card className="bg-surface-700 p-3 border-surface-600">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs">Orchestration</span>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-accent-500 rounded-full"></div>
                  <span className="text-xs text-accent-400">Online</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs">Agents</span>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-accent-500 rounded-full"></div>
                  <span className="text-xs text-accent-400">
                    {activeAgents.length}/{agentStatus?.length || 0}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs">Memory</span>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-accent-500 rounded-full"></div>
                  <span className="text-xs text-accent-400">Active</span>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Quick Stats */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3">TODAY'S STATS</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-center">
              <div className="text-lg font-bold text-blue-400">{projects.length}</div>
              <div className="text-xs text-gray-400">Projects</div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded p-2 text-center">
              <div className="text-lg font-bold text-green-400">{activeAgents.length}</div>
              <div className="text-xs text-gray-400">Active</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
