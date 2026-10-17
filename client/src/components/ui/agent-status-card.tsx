import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';

interface AgentStatusCardProps {
  agent: {
    id: string;
    name: string;
    type: string;
    status: 'idle' | 'active' | 'busy' | 'error';
    currentTask?: string;
    performance: {
      tasksCompleted: number;
      averageQuality: number;
      successRate: number;
    };
  };
  className?: string;
  onClick?: () => void;
}

export function AgentStatusCard({ agent, className = "", onClick }: AgentStatusCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'busy': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getAgentIcon = (type: string) => {
    const icons = {
      cto: '👔',
      cpo: '📊', 
      cmo: '📢',
      analyst: '🔍',
      architect: '🏗️',
      ui_ux: '🎨',
      frontend: '⚛️',
      backend: '⚙️',
      devops: '🚀',
      qa: '🧪',
      security: '🔒',
      database: '🗄️',
      pm: '📋',
      scrum_master: '🏃'
    };
    return icons[type as keyof typeof icons] || '🤖';
  };

  const getAgentColor = (type: string) => {
    const colors = {
      cto: 'bg-purple-500',
      cpo: 'bg-blue-500',
      cmo: 'bg-pink-500',
      analyst: 'bg-indigo-500',
      architect: 'bg-green-500',
      ui_ux: 'bg-yellow-500',
      frontend: 'bg-cyan-500',
      backend: 'bg-orange-500',
      devops: 'bg-red-500',
      qa: 'bg-teal-500',
      security: 'bg-gray-500',
      database: 'bg-violet-500',
      pm: 'bg-emerald-500',
      scrum_master: 'bg-amber-500'
    };
    return colors[type as keyof typeof colors] || 'bg-blue-500';
  };

  return (
    <Card 
      className={`agent-card bg-gray-800 border-gray-700 hover:border-blue-500/50 transition-all duration-300 cursor-pointer ${className}`}
      onClick={onClick}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Avatar className={`w-10 h-10 ${getAgentColor(agent.type)}`}>
              <AvatarFallback className="text-white">
                {getAgentIcon(agent.type)}
              </AvatarFallback>
            </Avatar>
            <div>
              <h4 className="font-semibold text-white">{agent.name}</h4>
              <p className="text-xs text-gray-400 capitalize">{agent.type.replace('_', ' ')}</p>
            </div>
          </div>
          <div className={`status-indicator ${getStatusColor(agent.status)}`}></div>
        </div>
      </CardHeader>
      
      <CardContent className="p-4 pt-0">
        {/* Current Status */}
        <div className="mb-3">
          <Badge 
            variant={agent.status === 'active' ? 'default' : agent.status === 'busy' ? 'secondary' : 'outline'}
            className={`${
              agent.status === 'active' ? 'bg-green-600' : 
              agent.status === 'busy' ? 'bg-yellow-600' : 
              agent.status === 'error' ? 'bg-red-600' : 'bg-gray-600'
            } text-white`}
          >
            {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
          </Badge>
          {agent.currentTask && (
            <div className="mt-2">
              <p className="text-xs text-gray-300 typing-indicator">
                {agent.currentTask.length > 40 ? 
                  `${agent.currentTask.substring(0, 40)}...` : 
                  agent.currentTask
                }
              </p>
            </div>
          )}
        </div>

        {/* Performance Metrics */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Quality</span>
            <span className="text-green-400">{Math.round(agent.performance.averageQuality * 100)}%</span>
          </div>
          <Progress 
            value={agent.performance.averageQuality * 100} 
            className="h-1"
          />
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Success Rate</span>
            <span className="text-blue-400">{Math.round(agent.performance.successRate * 100)}%</span>
          </div>
          <Progress 
            value={agent.performance.successRate * 100} 
            className="h-1"
          />

          <div className="flex items-center justify-between text-sm pt-1">
            <span className="text-gray-400">Tasks Completed</span>
            <span className="text-yellow-400">{agent.performance.tasksCompleted}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
