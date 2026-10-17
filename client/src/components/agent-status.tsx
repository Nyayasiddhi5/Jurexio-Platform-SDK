import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AgentStatus as AgentStatusType } from '@/types/agents';

interface AgentStatusProps {
  agent: {
    id?: number;
    name: string;
    type: string;
    status: AgentStatusType;
    currentTask?: string;
  };
  showDetails?: boolean;
  onAction?: (action: string) => void;
}

export function AgentStatus({ agent, showDetails = false, onAction }: AgentStatusProps) {
  const getStatusColor = (status: AgentStatusType) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'busy':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse';
      case 'idle':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      case 'error':
        return 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getAgentIcon = (type: string) => {
    const icons: Record<string, string> = {
      cto: 'fas fa-crown text-purple-400',
      cpo: 'fas fa-chart-line text-blue-400',
      cmo: 'fas fa-bullhorn text-orange-400',
      architect: 'fas fa-drafting-compass text-primary-400',
      frontend: 'fas fa-palette text-cyan-400',
      backend: 'fas fa-server text-green-400',
      database: 'fas fa-database text-violet-400',
      ui_ux: 'fas fa-paint-brush text-pink-400',
      qa: 'fas fa-bug text-emerald-400',
      devops: 'fas fa-rocket text-red-400',
      security: 'fas fa-shield-alt text-yellow-400'
    };
    return icons[type] || 'fas fa-robot text-slate-400';
  };

  const getAgentDescription = (type: string) => {
    const descriptions: Record<string, string> = {
      cto: 'Strategic technology leadership',
      cpo: 'Product strategy and user experience',
      cmo: 'Marketing strategy and growth',
      architect: 'System design and architecture',
      frontend: 'User interface development',
      backend: 'Server-side development',
      database: 'Database design and optimization',
      ui_ux: 'User interface and experience design',
      qa: 'Testing and quality assurance',
      devops: 'Infrastructure and deployment',
      security: 'Security analysis and implementation'
    };
    return descriptions[type] || 'Specialized AI agent';
  };

  if (!showDetails) {
    return (
      <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center">
            <i className={cn(getAgentIcon(agent.type), 'text-xs')}></i>
          </div>
          <div>
            <div className="text-white font-medium text-sm">{agent.name}</div>
            {agent.currentTask && (
              <div className="text-slate-400 text-xs truncate max-w-32">
                {agent.currentTask}
              </div>
            )}
          </div>
        </div>
        <Badge 
          className={cn(
            'text-xs px-2 py-1 border',
            getStatusColor(agent.status)
          )}
        >
          {agent.status}
        </Badge>
      </div>
    );
  }

  return (
    <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-slate-700 rounded-xl flex items-center justify-center">
            <i className={cn(getAgentIcon(agent.type), 'text-lg')}></i>
          </div>
          <div>
            <h4 className="text-white font-semibold">{agent.name}</h4>
            <p className="text-slate-400 text-sm">{getAgentDescription(agent.type)}</p>
          </div>
        </div>
        <Badge 
          className={cn(
            'text-xs px-2 py-1 border',
            getStatusColor(agent.status)
          )}
        >
          {agent.status}
        </Badge>
      </div>

      {agent.currentTask && (
        <div className="mb-3 p-2 bg-slate-700/50 rounded-lg">
          <div className="text-slate-300 text-xs font-medium mb-1">Current Task</div>
          <div className="text-slate-400 text-sm">{agent.currentTask}</div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className={cn(
            'w-2 h-2 rounded-full',
            agent.status === 'active' && 'bg-green-500 animate-pulse',
            agent.status === 'busy' && 'bg-blue-500 animate-pulse',
            agent.status === 'idle' && 'bg-gray-500',
            agent.status === 'error' && 'bg-red-500 animate-pulse'
          )}></div>
          <span className="text-slate-400 text-xs capitalize">{agent.status}</span>
        </div>

        {onAction && (
          <div className="flex space-x-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAction('view')}
              className="text-xs px-2 py-1 h-6"
            >
              <i className="fas fa-eye mr-1"></i>
              View
            </Button>
            {agent.status === 'idle' && (
              <Button
                size="sm"
                onClick={() => onAction('assign')}
                className="text-xs px-2 py-1 h-6 nyayavigya-gradient"
              >
                <i className="fas fa-play mr-1"></i>
                Assign
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
