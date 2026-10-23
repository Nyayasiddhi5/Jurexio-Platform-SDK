/**
 * Cost Estimator Component
 * 
 * Real-time cost prediction UI with AG-UI streaming integration.
 * Displays provider comparison, recommended selection, and budget tracking.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, DollarSign, Zap, TrendingUp, AlertCircle, Sparkles } from 'lucide-react';
import { useAGUIStream } from '@/hooks/use-agui-stream';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface CostEstimatorProps {
  workflow: string;
  taskDescription?: string;
  startupId?: number;
  sessionId?: number;
  onEstimateComplete?: (prediction: any) => void;
}

export function CostEstimator({ 
  workflow, 
  taskDescription, 
  startupId, 
  sessionId,
  onEstimateComplete 
}: CostEstimatorProps) {
  const [aguiSessionId, setAguiSessionId] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<any>(null);
  const { toast } = useToast();

  // AG-UI streaming hook
  const { events, status: streamStatus } = useAGUIStream(aguiSessionId);

  // Extract thinking steps and progress from AG-UI events
  const thinkingSteps = events.filter(e => e.type === 'thinking').map(e => ({
    step: (e as any).step,
    details: (e as any).details
  }));

  const latestProgress = events
    .filter(e => e.type === 'progress')
    .map(e => ({
      progress: (e as any).progress,
      message: (e as any).message
    }))
    .pop();

  const completionMessage = events
    .filter(e => e.type === 'message')
    .map(e => (e as any).message)
    .pop();

  // Cost estimation mutation
  const estimateCostMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/jurexio/estimate-cost', {
        method: 'POST',
        body: {
          workflow,
          taskDescription,
          startupId,
          sessionId
        }
      });
    },
    onSuccess: (data) => {
      setPrediction(data.prediction);
      setAguiSessionId(data.aguiSessionId);
      
      if (onEstimateComplete) {
        onEstimateComplete(data.prediction);
      }

      toast({
        title: '💰 Cost Estimate Ready',
        description: `Estimated cost: $${data.prediction.estimatedCost.toFixed(4)}`
      });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Estimation Failed',
        description: error instanceof Error ? error.message : 'Failed to estimate cost'
      });
    }
  });

  const handleEstimate = () => {
    setAguiSessionId(null);
    setPrediction(null);
    estimateCostMutation.mutate();
  };

  const isLoading = estimateCostMutation.isPending || streamStatus === 'connecting';
  const isEstimating = estimateCostMutation.isPending;

  return (
    <div className="space-y-6" data-testid="cost-estimator">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Cost Estimator
          </CardTitle>
          <CardDescription>
            Predict token costs before execution with real-time streaming
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Workflow Info */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Workflow</p>
              <p className="text-sm text-muted-foreground">{workflow}</p>
            </div>
            <Button
              onClick={handleEstimate}
              disabled={isLoading}
              data-testid="button-estimate-cost"
            >
              {isEstimating ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                  Estimating...
                </>
              ) : (
                <>
                  <DollarSign className="mr-2 h-4 w-4" />
                  Estimate Cost
                </>
              )}
            </Button>
          </div>

          {/* Task Description */}
          {taskDescription && (
            <div>
              <p className="text-sm font-medium mb-1">Task Description</p>
              <p className="text-sm text-muted-foreground">{taskDescription}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Real-Time Progress (AG-UI Streaming) */}
      {isEstimating && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-yellow-500 animate-pulse" />
              Analyzing in Real-Time
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress Bar */}
            {latestProgress && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{latestProgress.message}</span>
                  <span className="font-medium">{Math.round(latestProgress.progress * 100)}%</span>
                </div>
                <Progress value={latestProgress.progress * 100} className="h-2" />
              </div>
            )}

            {/* Thinking Steps */}
            {thinkingSteps.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Processing Steps:</p>
                {thinkingSteps.map((thinking, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">{thinking.step}</p>
                      <p className="text-muted-foreground">{thinking.details}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Completion Message */}
            {completionMessage && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Complete</AlertTitle>
                <AlertDescription>{completionMessage}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Complexity Analysis */}
      {prediction && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Task Complexity Analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Complexity Level</p>
                <Badge variant={
                  prediction.complexity.complexity === 'simple' ? 'secondary' :
                  prediction.complexity.complexity === 'moderate' ? 'default' :
                  prediction.complexity.complexity === 'complex' ? 'default' : 'destructive'
                }>
                  {prediction.complexity.complexity.toUpperCase()}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Estimated Tokens</p>
                <p className="text-lg font-semibold">{prediction.estimatedTokens.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Confidence Score</p>
                <p className="text-lg font-semibold">{(prediction.confidenceScore * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Est. Duration</p>
                <p className="text-lg font-semibold">{prediction.estimatedDurationSeconds}s</p>
              </div>
            </div>

            {/* Complexity Factors */}
            <div className="pt-2">
              <p className="text-sm font-medium mb-2">Complexity Factors:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {prediction.complexity.factors.multiStepWorkflow && (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Multi-step workflow</span>
                  </div>
                )}
                {prediction.complexity.factors.requiresResearch && (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Requires research</span>
                  </div>
                )}
                {prediction.complexity.factors.codeGeneration && (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Code generation</span>
                  </div>
                )}
                {prediction.complexity.factors.creativeTasks && (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Creative tasks</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommended Provider */}
      {prediction && (
        <Card className="border-2 border-green-500/20 bg-green-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Recommended Provider (Best Cost-Quality Balance)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-2xl font-bold">${prediction.estimatedCost.toFixed(4)}</p>
                <p className="text-sm text-muted-foreground">Total Estimated Cost</p>
              </div>
              <Badge variant="default" className="bg-green-500">
                {prediction.recommendedProvider.providerName} - {prediction.recommendedProvider.model}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Input Tokens</p>
                <p className="font-medium">{prediction.recommendedProvider.estimatedInputTokens.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Output Tokens</p>
                <p className="font-medium">{prediction.recommendedProvider.estimatedOutputTokens.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Quality Score</p>
                <p className="font-medium">{(prediction.recommendedProvider.qualityScore * 100).toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Estimated Latency</p>
                <p className="font-medium">{(prediction.recommendedProvider.estimatedLatencyMs / 1000).toFixed(1)}s</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider Comparison Table */}
      {prediction && prediction.providerEstimates && prediction.providerEstimates.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Provider Comparison</CardTitle>
            <CardDescription>Compare cost and quality across all available providers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Quality</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prediction.providerEstimates.map((estimate: any, idx: number) => (
                    <TableRow 
                      key={idx}
                      className={estimate.recommended ? 'bg-green-500/5' : ''}
                      data-testid={`provider-row-${idx}`}
                    >
                      <TableCell className="font-medium">
                        {estimate.providerName}
                        {estimate.recommended && (
                          <Badge variant="outline" className="ml-2 text-xs">Recommended</Badge>
                        )}
                      </TableCell>
                      <TableCell>{estimate.model}</TableCell>
                      <TableCell className="text-right font-mono">
                        ${estimate.totalEstimatedCost.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right">
                        {(estimate.estimatedInputTokens + estimate.estimatedOutputTokens).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {(estimate.qualityScore * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {(estimate.estimatedLatencyMs / 1000).toFixed(1)}s
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          <CardFooter className="text-sm text-muted-foreground">
            Showing {prediction.providerEstimates.length} provider options sorted by cost
          </CardFooter>
        </Card>
      )}

      {/* No Prediction Yet */}
      {!prediction && !isEstimating && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ready to Estimate</AlertTitle>
          <AlertDescription>
            Click "Estimate Cost" to analyze task complexity and compare provider pricing in real-time.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
