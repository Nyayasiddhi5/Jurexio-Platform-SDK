import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface ProjectModulesProps {
  projectId: number;
}

interface Task {
  id: number;
  title: string;
  description: string;
  module: string;
  status: string;
  priority: string;
  agentSessionId: number | null;
  estimatedTime: number | null;
  actualTime: number | null;
  createdAt: string;
  completedAt: string | null;
}

export function ProjectModules({ projectId }: ProjectModulesProps) {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['/api/projects', projectId, 'tasks'],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/tasks`);
      if (!response.ok) {
        throw new Error('Failed to fetch tasks');
      }
      const result = await response.json();
      return result.data as Task[];
    },
    enabled: !!projectId
  });

  if (isLoading) {
    return (
      <Card className="bg-surface-800 p-8 border-surface-700">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-700 rounded w-1/3 mb-6"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-4">
                <div className="h-4 bg-gray-700 rounded w-2/3"></div>
                <div className="space-y-2">
                  <div className="h-3 bg-gray-700 rounded"></div>
                  <div className="h-3 bg-gray-700 rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  const modules = [
    {
      name: 'Frontend Module',
      color: 'blue',
      tasks: tasks?.filter(t => t.module === 'frontend') || [],
      icon: 'fas fa-palette'
    },
    {
      name: 'Backend Module',
      color: 'purple',
      tasks: tasks?.filter(t => t.module === 'backend') || [],
      icon: 'fas fa-server'
    },
    {
      name: 'DevOps Module',
      color: 'green',
      tasks: tasks?.filter(t => t.module === 'deployment') || [],
      icon: 'fas fa-rocket'
    }
  ];

  const totalTasks = tasks?.length || 0;
  const completedTasks = tasks?.filter(t => t.status === 'completed').length || 0;
  const progressPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'default';
      case 'in_progress': return 'destructive';
      case 'pending': return 'secondary';
      case 'failed': return 'destructive';
      default: return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return 'fas fa-check';
      case 'in_progress': return 'fas fa-spinner fa-spin';
      case 'pending': return 'fas fa-clock';
      case 'failed': return 'fas fa-times';
      default: return 'fas fa-question';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'text-red-400';
      case 'high': return 'text-orange-400';
      case 'medium': return 'text-yellow-400';
      case 'low': return 'text-green-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <section>
      <Card className="bg-surface-800 p-8 border-surface-700">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Project Modules & Task Distribution</h2>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-400">
              <span className="text-accent-400 font-medium">{completedTasks}</span> of {totalTasks} tasks complete
            </div>
            <div className="w-24">
              <Progress value={progressPercentage} className="h-2" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {modules.map((module) => {
            const moduleCompletedTasks = module.tasks.filter(t => t.status === 'completed').length;
            const moduleProgress = module.tasks.length > 0 ? (moduleCompletedTasks / module.tasks.length) * 100 : 0;
            
            return (
              <div key={module.name} className="bg-surface-900 rounded-lg p-6 border border-surface-600">
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-lg font-semibold text-${module.color}-300 flex items-center`}>
                    <i className={`${module.icon} mr-2`}></i>
                    {module.name}
                  </h3>
                  <Badge variant={moduleProgress === 100 ? 'default' : moduleProgress > 0 ? 'destructive' : 'secondary'}>
                    {moduleProgress === 100 ? 'Complete' : moduleProgress > 0 ? 'In Progress' : 'Pending'}
                  </Badge>
                </div>
                
                <div className="mb-4">
                  <Progress value={moduleProgress} className="h-2" />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{moduleCompletedTasks}/{module.tasks.length} tasks</span>
                    <span>{Math.round(moduleProgress)}%</span>
                  </div>
                </div>

                <div className="space-y-3">
                  {module.tasks.length === 0 ? (
                    <div className="text-center py-4 text-gray-400">
                      <i className="fas fa-plus-circle text-2xl mb-2"></i>
                      <p className="text-sm">No tasks assigned yet</p>
                    </div>
                  ) : (
                    module.tasks.slice(0, 5).map((task) => (
                      <div key={task.id} className="flex items-center space-x-3 p-2 rounded bg-surface-800">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                          task.status === 'completed' ? `bg-${module.color}-500` : 
                          task.status === 'in_progress' ? `bg-accent-500` : 
                          'bg-gray-600'
                        }`}>
                          <i className={`${getStatusIcon(task.status)} text-xs`}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{task.title}</p>
                          <div className="flex items-center space-x-2 text-xs text-gray-400">
                            <span className={getPriorityColor(task.priority)}>
                              {task.priority}
                            </span>
                            {task.estimatedTime && (
                              <span>• {task.estimatedTime}min</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  
                  {module.tasks.length > 5 && (
                    <div className="text-center text-xs text-gray-400">
                      +{module.tasks.length - 5} more tasks
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Task Statistics */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Tasks', value: totalTasks, icon: 'fas fa-tasks', color: 'blue' },
            { label: 'Completed', value: completedTasks, icon: 'fas fa-check-circle', color: 'green' },
            { label: 'In Progress', value: tasks?.filter(t => t.status === 'in_progress').length || 0, icon: 'fas fa-spinner', color: 'yellow' },
            { label: 'Failed', value: tasks?.filter(t => t.status === 'failed').length || 0, icon: 'fas fa-exclamation-circle', color: 'red' }
          ].map((stat) => (
            <div key={stat.label} className={`bg-${stat.color}-500/10 border border-${stat.color}-500/20 rounded-lg p-4 text-center`}>
              <i className={`${stat.icon} text-2xl text-${stat.color}-400 mb-2`}></i>
              <div className="text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-sm text-gray-400">{stat.label}</div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}
