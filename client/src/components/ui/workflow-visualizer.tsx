import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface WorkflowStep {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  agent?: string;
  estimatedDuration?: number;
  actualDuration?: number;
  dependencies?: string[];
}

interface WorkflowVisualizerProps {
  steps: WorkflowStep[];
  currentStep?: string;
  className?: string;
}

export function WorkflowVisualizer({ steps, currentStep, className = "" }: WorkflowVisualizerProps) {
  const getStepIcon = (status: WorkflowStep['status']) => {
    switch (status) {
      case 'completed':
        return 'fa-check-circle';
      case 'in_progress':
        return 'fa-spinner fa-spin';
      case 'failed':
        return 'fa-times-circle';
      default:
        return 'fa-circle';
    }
  };

  const getStepColor = (status: WorkflowStep['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-400';
      case 'in_progress':
        return 'text-blue-400';
      case 'failed':
        return 'text-red-400';
      default:
        return 'text-gray-500';
    }
  };

  const getConnectorColor = (fromStatus: WorkflowStep['status'], toStatus: WorkflowStep['status']) => {
    if (fromStatus === 'completed') return 'bg-green-400';
    if (fromStatus === 'in_progress') return 'bg-blue-400';
    if (fromStatus === 'failed') return 'bg-red-400';
    return 'bg-gray-600';
  };

  const completedSteps = steps.filter(step => step.status === 'completed').length;
  const totalSteps = steps.length;
  const overallProgress = (completedSteps / totalSteps) * 100;

  return (
    <Card className={`bg-gray-800 border-gray-700 ${className}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-white flex items-center">
            <i className="fas fa-project-diagram text-cyan-400 mr-2"></i>
            Current Workflow
          </CardTitle>
          <div className="text-sm text-gray-400">
            {completedSteps} of {totalSteps} steps complete
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Overall Progress</span>
            <span className="text-cyan-400">{Math.round(overallProgress)}%</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
        </div>
      </CardHeader>
      
      <CardContent className="p-6">
        {/* Workflow Steps */}
        <div className="space-y-6">
          {steps.map((step, index) => (
            <div key={step.id} className="relative">
              {/* Step Content */}
              <div className="flex items-center space-x-4">
                {/* Step Icon */}
                <div className={`flex items-center justify-center w-12 h-12 rounded-full border-2 ${
                  step.status === 'completed' ? 'border-green-400 bg-green-400/20' :
                  step.status === 'in_progress' ? 'border-blue-400 bg-blue-400/20' :
                  step.status === 'failed' ? 'border-red-400 bg-red-400/20' :
                  'border-gray-600 bg-gray-600/20'
                } ${currentStep === step.id ? 'animate-pulse' : ''}`}>
                  <i className={`fas ${getStepIcon(step.status)} ${getStepColor(step.status)} text-lg`}></i>
                </div>

                {/* Step Details */}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-white">{step.name}</h4>
                    <div className="flex items-center space-x-2">
                      {step.agent && (
                        <Badge variant="outline" className="text-xs">
                          {step.agent}
                        </Badge>
                      )}
                      <Badge className={`text-xs ${
                        step.status === 'completed' ? 'bg-green-600' :
                        step.status === 'in_progress' ? 'bg-blue-600' :
                        step.status === 'failed' ? 'bg-red-600' :
                        'bg-gray-600'
                      }`}>
                        {step.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                  
                  {/* Duration Info */}
                  {(step.estimatedDuration || step.actualDuration) && (
                    <div className="mt-1 text-sm text-gray-400">
                      {step.actualDuration ? (
                        <span>Completed in {step.actualDuration}h</span>
                      ) : step.estimatedDuration ? (
                        <span>Estimated: {step.estimatedDuration}h</span>
                      ) : null}
                    </div>
                  )}

                  {/* Progress for current step */}
                  {step.status === 'in_progress' && (
                    <div className="mt-2">
                      <Progress value={65} className="h-1" />
                    </div>
                  )}
                </div>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div className="absolute left-6 top-12 w-0.5 h-6 bg-gray-600"></div>
              )}
            </div>
          ))}
        </div>

        {/* Workflow Metrics */}
        <div className="mt-6 pt-6 border-t border-gray-700">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-semibold text-green-400">{completedSteps}</div>
              <div className="text-sm text-gray-400">Completed</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-blue-400">
                {steps.filter(s => s.status === 'in_progress').length}
              </div>
              <div className="text-sm text-gray-400">In Progress</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-400">
                {steps.filter(s => s.status === 'pending').length}
              </div>
              <div className="text-sm text-gray-400">Pending</div>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        {steps.filter(s => s.status === 'pending').length > 0 && (
          <div className="mt-4 p-4 bg-gray-700/50 rounded-lg">
            <h5 className="text-sm font-medium text-white mb-2">Next Steps:</h5>
            <div className="space-y-1">
              {steps
                .filter(s => s.status === 'pending')
                .slice(0, 3)
                .map(step => (
                  <div key={step.id} className="text-sm text-gray-400 flex items-center">
                    <i className="fas fa-arrow-right mr-2 text-xs"></i>
                    {step.name}
                    {step.estimatedDuration && (
                      <span className="ml-auto text-xs">~{step.estimatedDuration}h</span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
