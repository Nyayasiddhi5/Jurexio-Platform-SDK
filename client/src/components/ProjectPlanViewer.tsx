/**
 * Project Plan Viewer Component
 * Displays comprehensive project plans with phases, tasks, and execution controls
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Play, 
  Edit3, 
  Clock, 
  Users, 
  CheckCircle, 
  AlertTriangle,
  Target,
  Shield,
  X,
  Calendar,
  BarChart3
} from 'lucide-react';
import { useToast, toast } from '@/hooks/use-toast';

interface ProjectPlanViewerProps {
  projectPlan: any;
  enhancedPrompt: string;
  onApprove: (data: any) => void;
  onEdit: () => void;
}

export function ProjectPlanViewer({ projectPlan, enhancedPrompt, onApprove, onEdit }: ProjectPlanViewerProps) {
  const [isStarting, setIsStarting] = useState(false);

  const handleStartProject = async () => {
    setIsStarting(true);
    
    try {
      // Simulate project initialization
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      onApprove({
        projectPlan,
        enhancedPrompt,
        approved: true,
        startedAt: new Date()
      });
      
      toast({
        title: "Project Started",
        description: "Your project has been approved and development is beginning.",
      });
    } catch (error) {
      toast({
        title: "Start Failed",
        description: "Failed to start the project. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsStarting(false);
    }
  };

  if (!projectPlan) return null;

  const { phases = [], totalEstimatedHours = 0, recommendedTeamSize = 1 } = projectPlan;
  const totalPhases = phases.length;
  const estimatedWeeks = Math.ceil(totalEstimatedHours / 40);

  return (
    <Card className="w-full mb-6">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-2xl mb-2">Project Plan Preview</CardTitle>
            <p className="text-slate-600 dark:text-slate-400">
              AI-generated comprehensive project specification with phases and tasks
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onEdit} size="sm">
              <Edit3 className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <Button 
              onClick={handleStartProject}
              disabled={isStarting}
              size="sm"
            >
              {isStarting ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Project
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="phases">Phases</TabsTrigger>
            <TabsTrigger value="risks">Risks</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardContent className="p-4 text-center">
                  <Clock className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                  <div className="text-2xl font-bold">{totalEstimatedHours}h</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    ~{estimatedWeeks} weeks
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4 text-center">
                  <Users className="h-8 w-8 mx-auto mb-2 text-green-600" />
                  <div className="text-2xl font-bold">{recommendedTeamSize}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    Team members
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4 text-center">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 text-purple-600" />
                  <div className="text-2xl font-bold">{totalPhases}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    Development phases
                  </div>
                </CardContent>
              </Card>
            </div>
            
            <div className="prose dark:prose-invert max-w-none">
              <h3>Enhanced Project Description</h3>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 whitespace-pre-wrap">
                {enhancedPrompt.length > 500 
                  ? `${enhancedPrompt.substring(0, 500)}...` 
                  : enhancedPrompt}
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="phases" className="mt-6">
            <div className="space-y-4">
              {phases.map((phase: any, index: number) => (
                <Card key={index}>
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">{phase.name}</CardTitle>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                          {phase.description}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline">
                          {phase.duration}h
                        </Badge>
                        <div className="text-xs text-slate-500 mt-1">
                          Phase {index + 1} of {totalPhases}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent>
                    <div className="space-y-3">
                      <div>
                        <h4 className="text-sm font-medium mb-2">Key Tasks</h4>
                        <div className="space-y-2">
                          {phase.tasks?.slice(0, 3).map((task: any, taskIndex: number) => (
                            <div key={taskIndex} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded">
                              <div className="flex-1">
                                <div className="text-sm font-medium">{task.name}</div>
                                <div className="text-xs text-slate-600 dark:text-slate-400">
                                  {task.description}
                                </div>
                              </div>
                              <div className="text-xs text-slate-500">
                                {task.estimatedHours}h
                              </div>
                            </div>
                          ))}
                          {phase.tasks?.length > 3 && (
                            <div className="text-xs text-slate-500 text-center">
                              +{phase.tasks.length - 3} more tasks
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {phase.deliverables && (
                        <div>
                          <h4 className="text-sm font-medium mb-2">Deliverables</h4>
                          <div className="flex flex-wrap gap-1">
                            {phase.deliverables.map((deliverable: string, idx: number) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {deliverable}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
          
          <TabsContent value="risks" className="mt-6">
            <div className="space-y-4">
              {projectPlan.riskAssessment?.risks?.map((risk: any, index: number) => (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-medium">{risk.category} Risk</h4>
                          <Badge variant={
                            risk.probability > 70 ? 'destructive' : 
                            risk.probability > 40 ? 'default' : 'secondary'
                          }>
                            {risk.probability}% probability
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                          {risk.description}
                        </p>
                        <div className="text-xs text-slate-500">
                          <strong>Mitigation:</strong> {risk.mitigation}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )) || (
                <div className="text-center py-8 text-slate-500">
                  <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No specific risks identified for this project</p>
                </div>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="metrics" className="mt-6">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Success Criteria
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {projectPlan.successMetrics?.map((metric: string, index: number) => (
                      <div key={index} className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{metric}</span>
                      </div>
                    )) || (
                      <div className="text-slate-500 text-sm">
                        No specific success metrics defined
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Timeline Overview
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {phases.map((phase: any, index: number) => (
                      <div key={index} className="flex items-center gap-3">
                        <div className="w-16 text-xs text-slate-500">
                          Week {Math.ceil((phases.slice(0, index).reduce((acc: number, p: any) => acc + p.duration, 0)) / 40) + 1}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{phase.name}</div>
                          <Progress value={(index + 1) / totalPhases * 100} className="h-2 mt-1" />
                        </div>
                        <div className="text-xs text-slate-500">
                          {phase.duration}h
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}