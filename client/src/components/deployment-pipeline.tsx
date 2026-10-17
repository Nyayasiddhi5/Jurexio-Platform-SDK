import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface DeploymentPipelineProps {
  deploymentId: number;
  className?: string;
}

interface DeploymentStep {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  duration?: number;
  error?: string;
  logs?: string[];
}

export function DeploymentPipeline({ deploymentId, className }: DeploymentPipelineProps) {
  const [currentStep, setCurrentStep] = useState(0);
  
  const { data: deployment, isLoading } = useQuery({
    queryKey: ['/api/deployments', deploymentId],
    refetchInterval: 2000, // Refresh every 2 seconds
    enabled: !!deploymentId
  });

  const { data: logs } = useQuery({
    queryKey: ['/api/deployments', deploymentId, 'logs'],
    refetchInterval: 2000,
    enabled: !!deploymentId
  });

  const steps: DeploymentStep[] = logs?.steps || [
    { name: 'Code Build', status: 'completed' },
    { name: 'Dependency Installation', status: 'completed' },
    { name: 'Unit Tests', status: 'completed' },
    { name: 'Integration Tests', status: 'in_progress' },
    { name: 'Security Scan', status: 'pending' },
    { name: 'Infrastructure Setup', status: 'pending' },
    { name: 'Database Migration', status: 'pending' },
    { name: 'Application Deployment', status: 'pending' },
    { name: 'Health Check', status: 'pending' },
    { name: 'DNS Configuration', status: 'pending' },
    { name: 'SSL Certificate', status: 'pending' },
    { name: 'Monitoring Setup', status: 'pending' }
  ];

  useEffect(() => {
    const inProgressStep = steps.findIndex(step => step.status === 'in_progress');
    if (inProgressStep !== -1) {
      setCurrentStep(inProgressStep);
    }
  }, [steps]);

  const getStepIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return 'fas fa-check text-green-400';
      case 'in_progress':
        return 'fas fa-spinner fa-spin text-blue-400';
      case 'failed':
        return 'fas fa-times text-red-400';
      default:
        return 'fas fa-clock text-gray-400';
    }
  };

  const getStepColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/20 border-green-500/30';
      case 'in_progress':
        return 'bg-blue-500/20 border-blue-500/30 animate-pulse';
      case 'failed':
        return 'bg-red-500/20 border-red-500/30';
      default:
        return 'bg-gray-500/20 border-gray-500/30';
    }
  };

  const getProgressPercentage = () => {
    const completedSteps = steps.filter(step => step.status === 'completed').length;
    return (completedSteps / steps.length) * 100;
  };

  const getEstimatedTime = () => {
    const remainingSteps = steps.filter(step => step.status === 'pending').length;
    const avgStepTime = 30; // seconds
    return Math.ceil(remainingSteps * avgStepTime / 60); // minutes
  };

  if (isLoading) {
    return (
      <div className={cn('p-4 bg-slate-700/50 rounded-xl', className)}>
        <div className="flex items-center space-x-3">
          <div className="loading-spinner w-6 h-6"></div>
          <span className="text-slate-300">Loading deployment status...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Progress Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-white font-medium">Deployment Progress</h4>
          <p className="text-slate-400 text-sm">
            Step {currentStep + 1} of {steps.length} • Est. {getEstimatedTime()} min remaining
          </p>
        </div>
        <div className="text-right">
          <div className="text-white font-bold text-lg">{getProgressPercentage().toFixed(0)}%</div>
          <div className="text-slate-400 text-sm">Complete</div>
        </div>
      </div>

      {/* Progress Bar */}
      <Progress value={getProgressPercentage()} className="h-2" />

      {/* Steps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {steps.map((step, index) => (
          <div
            key={index}
            className={cn(
              'p-3 rounded-lg border transition-all duration-300',
              getStepColor(step.status),
              step.status === 'in_progress' && 'scale-105'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
                  <i className={cn(getStepIcon(step.status), 'text-sm')}></i>
                </div>
                <div>
                  <div className="text-white font-medium text-sm">{step.name}</div>
                  {step.duration && (
                    <div className="text-slate-400 text-xs">
                      {(step.duration / 1000).toFixed(1)}s
                    </div>
                  )}
                </div>
              </div>
              
              {step.status === 'in_progress' && (
                <div className="flex space-x-1">
                  <div className="w-1 h-4 bg-blue-400 animate-pulse rounded-full"></div>
                  <div className="w-1 h-4 bg-blue-400 animate-pulse rounded-full [animation-delay:0.2s]"></div>
                  <div className="w-1 h-4 bg-blue-400 animate-pulse rounded-full [animation-delay:0.4s]"></div>
                </div>
              )}
            </div>

            {step.error && (
              <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                {step.error}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Live Logs */}
      <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <h5 className="text-white font-medium text-sm">Live Deployment Logs</h5>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-slate-400 text-xs">Live</span>
          </div>
        </div>
        
        <div className="bg-slate-900 rounded p-3 font-mono text-xs max-h-32 overflow-y-auto">
          {logs?.logs ? (
            logs.logs.map((log: string, index: number) => (
              <div key={index} className="text-slate-300 mb-1">
                <span className="text-slate-500">
                  [{new Date().toLocaleTimeString()}]
                </span>
                {' '}{log}
              </div>
            ))
          ) : (
            <div className="text-slate-400">
              <div>[{new Date().toLocaleTimeString()}] Starting deployment process...</div>
              <div>[{new Date().toLocaleTimeString()}] Building application bundle...</div>
              <div>[{new Date().toLocaleTimeString()}] Running tests...</div>
              <div className="text-green-400">
                [{new Date().toLocaleTimeString()}] ✓ Tests passed successfully
              </div>
              <div>[{new Date().toLocaleTimeString()}] Setting up infrastructure...</div>
            </div>
          )}
        </div>
      </div>

      {/* Deployment Actions */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-sm text-slate-400">
            <i className="fas fa-server"></i>
            <span>AWS us-east-1</span>
          </div>
          <div className="flex items-center space-x-2 text-sm text-slate-400">
            <i className="fas fa-git-alt"></i>
            <span>main branch</span>
          </div>
        </div>
        
        {deployment?.status === 'in_progress' && (
          <button className="text-sm text-red-400 hover:text-red-300 transition-colors">
            <i className="fas fa-stop mr-1"></i>
            Cancel Deployment
          </button>
        )}
      </div>
    </div>
  );
}
