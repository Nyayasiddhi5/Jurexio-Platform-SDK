import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Play, 
  Pause, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Target,
  Zap,
  RefreshCw,
  ChevronRight,
  Users
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface RoadmapPhase {
  id: string;
  name: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  timeline: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  progress: number;
  features: RoadmapFeature[];
  dependencies: string[];
  impact: string;
}

interface RoadmapFeature {
  id: string;
  name: string;
  description: string;
  implementation_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  technical_complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXPERT';
  business_value: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimated_effort: string;
  required_agents: string[];
  integration_points: string[];
}

interface RoadmapPhasesProps {
  phases: RoadmapPhase[];
  loading: boolean;
}

export function RoadmapPhases({ phases, loading }: RoadmapPhasesProps) {
  const { toast } = useToast();
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const executePhase = useMutation({
    mutationFn: async (phaseId: string) => {
      return await apiRequest(`/api/roadmap/execute/${phaseId}`, {
        method: 'POST'
      });
    },
    onSuccess: (data, phaseId) => {
      toast({
        title: "Phase Execution Started",
        description: "The roadmap phase execution has begun.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/roadmap/status'] });
    },
    onError: (error) => {
      toast({
        title: "Execution Failed",
        description: "Failed to start phase execution. Please try again.",
        variant: "destructive"
      });
    }
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'CRITICAL': return 'border-red-500 bg-red-50 dark:bg-red-950/20';
      case 'HIGH': return 'border-orange-500 bg-orange-50 dark:bg-orange-950/20';
      case 'MEDIUM': return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20';
      case 'LOW': return 'border-green-500 bg-green-50 dark:bg-green-950/20';
      default: return 'border-slate-500 bg-slate-50 dark:bg-slate-950/20';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED': return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'IN_PROGRESS': return <Clock className="h-5 w-5 text-blue-600" />;
      case 'BLOCKED': return <AlertCircle className="h-5 w-5 text-red-600" />;
      default: return <Target className="h-5 w-5 text-slate-400" />;
    }
  };

  const getComplexityColor = (complexity: string) => {
    switch (complexity) {
      case 'EXPERT': return 'text-red-600 bg-red-100 dark:bg-red-900/20';
      case 'HIGH': return 'text-orange-600 bg-orange-100 dark:bg-orange-900/20';
      case 'MEDIUM': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/20';
      case 'LOW': return 'text-green-600 bg-green-100 dark:bg-green-900/20';
      default: return 'text-slate-600 bg-slate-100 dark:bg-slate-900/20';
    }
  };

  const getBusinessValueColor = (value: string) => {
    switch (value) {
      case 'CRITICAL': return 'text-purple-600 bg-purple-100 dark:bg-purple-900/20';
      case 'HIGH': return 'text-blue-600 bg-blue-100 dark:bg-blue-900/20';
      case 'MEDIUM': return 'text-green-600 bg-green-100 dark:bg-green-900/20';
      case 'LOW': return 'text-slate-600 bg-slate-100 dark:bg-slate-900/20';
      default: return 'text-slate-600 bg-slate-100 dark:bg-slate-900/20';
    }
  };

  if (loading) {
    return (
      <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-0 shadow-lg">
        <CardContent className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Roadmap Overview */}
      <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-6 w-6 text-blue-600" />
            Jurexio DevStudio Roadmap
          </CardTitle>
          <CardDescription>
            Enterprise-grade AI development platform roadmap with 5 strategic phases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{phases.length}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Total Phases</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {phases.filter(p => p.status === 'COMPLETED').length}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Completed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {phases.filter(p => p.status === 'IN_PROGRESS').length}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">In Progress</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {phases.reduce((acc, phase) => acc + phase.features.length, 0)}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Total Features</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Phase Cards */}
      <div className="space-y-4">
        {phases.map((phase, index) => (
          <motion.div
            key={phase.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
          >
            <Card className={`${getPriorityColor(phase.priority)} border-2`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(phase.status)}
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {phase.name}
                        <Badge variant="outline" className="text-xs">
                          {phase.priority}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {phase.impact}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-slate-600 dark:text-slate-400">Timeline</div>
                    <div className="font-medium">{phase.timeline}</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Progress */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Overall Progress</span>
                    <span className="text-sm font-medium">{phase.progress}%</span>
                  </div>
                  <Progress value={phase.progress} className="h-3" />
                </div>

                {/* Features */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-blue-600" />
                    Key Features ({phase.features.length})
                  </h4>
                  <div className="grid gap-3">
                    {phase.features.slice(0, selectedPhase === phase.id ? undefined : 3).map((feature) => (
                      <div key={feature.id} className="p-3 bg-white dark:bg-slate-800 rounded-lg border">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-sm">{feature.name}</div>
                            <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                              {feature.description}
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge variant="secondary" className={getComplexityColor(feature.technical_complexity)}>
                                {feature.technical_complexity}
                              </Badge>
                              <Badge variant="secondary" className={getBusinessValueColor(feature.business_value)}>
                                {feature.business_value} Value
                              </Badge>
                              <span className="text-xs text-slate-600 dark:text-slate-400">
                                {feature.estimated_effort}
                              </span>
                            </div>
                          </div>
                          <div className="ml-3">
                            {feature.implementation_status === 'COMPLETED' && (
                              <CheckCircle className="h-5 w-5 text-green-600" />
                            )}
                            {feature.implementation_status === 'IN_PROGRESS' && (
                              <Clock className="h-5 w-5 text-blue-600" />
                            )}
                            {feature.implementation_status === 'NOT_STARTED' && (
                              <Target className="h-5 w-5 text-slate-400" />
                            )}
                          </div>
                        </div>

                        {/* Required Agents */}
                        {feature.required_agents.length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Required Agents:</div>
                            <div className="flex flex-wrap gap-1">
                              {feature.required_agents.slice(0, 3).map((agent) => (
                                <Badge key={agent} variant="outline" className="text-xs">
                                  <Users className="h-3 w-3 mr-1" />
                                  {agent}
                                </Badge>
                              ))}
                              {feature.required_agents.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{feature.required_agents.length - 3} more
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {phase.features.length > 3 && selectedPhase !== phase.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPhase(phase.id)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <ChevronRight className="h-4 w-4 mr-1" />
                        Show {phase.features.length - 3} more features
                      </Button>
                    )}
                    
                    {selectedPhase === phase.id && phase.features.length > 3 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPhase(null)}
                        className="text-slate-600 hover:text-slate-700"
                      >
                        Show less
                      </Button>
                    )}
                  </div>
                </div>

                {/* Dependencies */}
                {phase.dependencies.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2 text-sm">Dependencies</h4>
                    <div className="flex flex-wrap gap-1">
                      {phase.dependencies.map((dep) => (
                        <Badge key={dep} variant="outline" className="text-xs">
                          {dep}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end pt-2">
                  {phase.status === 'NOT_STARTED' && (
                    <Button
                      onClick={() => executePhase.mutate(phase.id)}
                      disabled={executePhase.isPending}
                      className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700"
                    >
                      {executePhase.isPending ? (
                        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Execute Phase
                    </Button>
                  )}
                  {phase.status === 'IN_PROGRESS' && (
                    <Button variant="outline" disabled>
                      <Clock className="h-4 w-4 mr-2" />
                      In Progress
                    </Button>
                  )}
                  {phase.status === 'COMPLETED' && (
                    <Button variant="outline" disabled>
                      <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                      Completed
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}