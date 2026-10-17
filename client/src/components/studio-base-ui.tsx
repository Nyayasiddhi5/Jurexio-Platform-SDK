/**
 * Studio Base UI Component
 * Reusable foundation for all 10 studio interfaces
 * Handles: Task execution, progress tracking, orchestration status, artifact display
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  CheckCircle2,
  Clock,
  Sparkles,
  AlertCircle,
  Download,
  FileText,
  Code,
  Image,
  Play,
  Pause,
  RotateCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

export interface StudioTask {
  id: number;
  taskName: string;
  taskDescription: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority?: 'low' | 'medium' | 'high';
  startedAt?: string | null;
  completedAt?: string | null;
  duration?: number | null;
  creditsUsed?: number;
  assignedAgents?: string[];
  outputs?: any;
  errorMessage?: string | null;
}

export interface Artifact {
  id: number;
  name: string;
  artifactType: 'document' | 'code' | 'design' | 'data';
  category: string;
  description: string | null;
  content: string | null;
  fileUrl?: string | null;
  version?: string;
  createdAt: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface OrchestrationStatus {
  jobId?: number;
  status: 'idle' | 'queued' | 'running' | 'success' | 'failed';
  progress?: number;
  currentStep?: string;
  agentsInvolved?: string[];
  creditsConsumed?: number;
  errorMessage?: string | null;
}

export interface StudioBaseUIProps {
  studioId: string;
  studioName: string;
  studioDescription: string;
  sessionId?: number;
  startupId?: number;
  children?: React.ReactNode; // Studio-specific input forms
  onExecute?: (inputs: any) => Promise<void>;
  tasks?: StudioTask[];
  artifacts?: Artifact[];
  orchestrationStatus?: OrchestrationStatus;
  isExecuting?: boolean;
}

// ============================================================================
// STATUS CONFIGS
// ============================================================================

const taskStatusConfig = {
  pending: { color: 'bg-gray-500', icon: Clock, label: 'Pending' },
  in_progress: { color: 'bg-[hsl(217,91%,60%)]', icon: Sparkles, label: 'In Progress' },
  completed: { color: 'bg-[hsl(142,71%,45%)]', icon: CheckCircle2, label: 'Completed' },
  failed: { color: 'bg-[hsl(0,84%,60%)]', icon: AlertCircle, label: 'Failed' },
};

const artifactTypeIcons = {
  document: FileText,
  code: Code,
  design: Image,
  data: FileText,
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function TaskCard({ task }: { task: StudioTask }) {
  const [expanded, setExpanded] = useState(false);
  const config = taskStatusConfig[task.status];
  const StatusIcon = config.icon;

  return (
    <Card className="bg-[hsl(222,47%,15%)] border-gray-800" data-testid={`card-task-${task.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className={cn('w-2 h-2 rounded-full', config.color)} />
              <Badge variant="outline" className="text-xs">
                {config.label}
              </Badge>
              {task.priority && (
                <Badge variant={task.priority === 'high' ? 'default' : 'secondary'} className="text-xs">
                  {task.priority}
                </Badge>
              )}
            </div>
            <CardTitle className="text-base" data-testid={`text-task-name-${task.id}`}>
              {task.taskName}
            </CardTitle>
            {task.taskDescription && (
              <CardDescription className="text-sm mt-1">{task.taskDescription}</CardDescription>
            )}
          </div>
          <StatusIcon className="w-5 h-5 ml-4" style={{ color: `hsl(${config.color.replace('bg-[', '').replace(']', '')})` }} />
        </div>
      </CardHeader>
      
      {(task.assignedAgents?.length || task.duration || task.creditsUsed) && (
        <CardContent className="pt-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full justify-between p-2"
            data-testid={`button-expand-task-${task.id}`}
          >
            <span className="text-xs text-gray-400">Details</span>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
          
          {expanded && (
            <div className="mt-2 space-y-2 text-sm">
              {task.assignedAgents && task.assignedAgents.length > 0 && (
                <div>
                  <span className="text-gray-400">Agents:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {task.assignedAgents.map((agent, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {agent}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {task.duration && (
                <div className="text-gray-400">
                  Duration: <span className="text-gray-200">{task.duration}s</span>
                </div>
              )}
              {task.creditsUsed && (
                <div className="text-gray-400">
                  Credits: <span className="text-gray-200">{task.creditsUsed}</span>
                </div>
              )}
              {task.errorMessage && (
                <div className="text-red-400 text-xs">{task.errorMessage}</div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const ArtifactIcon = artifactTypeIcons[artifact.artifactType] || FileText;
  
  const handleDownload = () => {
    if (artifact.fileUrl) {
      window.open(artifact.fileUrl, '_blank');
    } else if (artifact.content) {
      const blob = new Blob([artifact.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifact.name}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Card className="bg-[hsl(222,47%,15%)] border-gray-800 hover:border-[hsl(217,91%,60%)]/50 transition-colors" data-testid={`card-artifact-${artifact.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[hsl(217,91%,60%)]/10 flex items-center justify-center flex-shrink-0">
            <ArtifactIcon className="w-5 h-5 text-[hsl(217,91%,60%)]" />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm truncate" data-testid={`text-artifact-name-${artifact.id}`}>
              {artifact.name}
            </CardTitle>
            {artifact.description && (
              <CardDescription className="text-xs mt-1 line-clamp-2">{artifact.description}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {artifact.artifactType}
            </Badge>
            {artifact.version && (
              <Badge variant="outline" className="text-xs">
                v{artifact.version}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-8"
            data-testid={`button-download-artifact-${artifact.id}`}
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
        {artifact.tags && artifact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {artifact.tags.slice(0, 3).map((tag, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OrchestrationPanel({ status }: { status: OrchestrationStatus }) {
  if (status.status === 'idle') {
    return (
      <Card className="bg-[hsl(222,47%,15%)] border-gray-800">
        <CardContent className="py-8 text-center">
          <Sparkles className="w-12 h-12 mx-auto text-gray-500 mb-3" />
          <p className="text-gray-400">Fill in the details and click Execute to start</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[hsl(222,47%,15%)] border-gray-800" data-testid="card-orchestration-status">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          {status.status === 'running' && <Loader2 className="w-5 h-5 animate-spin text-[hsl(217,91%,60%)]" />}
          {status.status === 'success' && <CheckCircle2 className="w-5 h-5 text-[hsl(142,71%,45%)]" />}
          {status.status === 'failed' && <AlertCircle className="w-5 h-5 text-[hsl(0,84%,60%)]" />}
          {status.status === 'queued' && <Clock className="w-5 h-5 text-gray-400" />}
          <span className="capitalize">{status.status}</span>
        </CardTitle>
        {status.currentStep && (
          <CardDescription className="mt-1">{status.currentStep}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {status.progress !== undefined && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Progress</span>
              <span className="font-mono text-[hsl(217,91%,60%)]">{status.progress}%</span>
            </div>
            <Progress value={status.progress} className="h-2" />
          </div>
        )}
        
        {status.agentsInvolved && status.agentsInvolved.length > 0 && (
          <div>
            <div className="text-sm text-gray-400 mb-2">Agents Involved</div>
            <div className="flex flex-wrap gap-1">
              {status.agentsInvolved.map((agent, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {agent}
                </Badge>
              ))}
            </div>
          </div>
        )}
        
        {status.creditsConsumed !== undefined && (
          <div className="text-sm">
            <span className="text-gray-400">Credits Used:</span>
            <span className="ml-2 font-mono text-[hsl(217,91%,60%)]">{status.creditsConsumed}</span>
          </div>
        )}
        
        {status.errorMessage && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">{status.errorMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function StudioBaseUI({
  studioId,
  studioName,
  studioDescription,
  sessionId,
  startupId,
  children,
  onExecute,
  tasks = [],
  artifacts = [],
  orchestrationStatus = { status: 'idle' },
  isExecuting = false,
}: StudioBaseUIProps) {
  return (
    <div className="space-y-6">
      {/* Studio Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-studio-interface-name">
            {studioName}
          </h2>
          <p className="text-gray-400 mt-1">{studioDescription}</p>
        </div>
        {sessionId && (
          <Badge variant="outline" data-testid="badge-session-id">
            Session #{sessionId}
          </Badge>
        )}
      </div>

      <Separator className="bg-gray-800" />

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Input Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Studio-specific input form (passed as children) */}
          {children}
        </div>

        {/* Right: Orchestration Status */}
        <div className="space-y-6">
          <OrchestrationPanel status={orchestrationStatus} />
        </div>
      </div>

      {/* Tabs: Tasks & Artifacts */}
      <Tabs defaultValue="tasks" className="mt-8">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="tasks" data-testid="tab-tasks">
            Tasks ({tasks.length})
          </TabsTrigger>
          <TabsTrigger value="artifacts" data-testid="tab-artifacts">
            Artifacts ({artifacts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-6">
          {tasks.length === 0 ? (
            <Card className="bg-[hsl(222,47%,15%)] border-gray-800">
              <CardContent className="py-12 text-center">
                <Clock className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                <p className="text-gray-400">No tasks yet. Execute a workflow to see tasks here.</p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-4">
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="artifacts" className="mt-6">
          {artifacts.length === 0 ? (
            <Card className="bg-[hsl(222,47%,15%)] border-gray-800">
              <CardContent className="py-12 text-center">
                <FileText className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                <p className="text-gray-400">No artifacts yet. Complete tasks to generate artifacts.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {artifacts.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
