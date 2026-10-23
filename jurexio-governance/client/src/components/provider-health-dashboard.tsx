/**
 * Provider Health Dashboard
 * 
 * Real-time monitoring of LLM provider health, quality scores, and performance metrics.
 * Integrates with AG-UI for live updates and quality feedback submission.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  DollarSign,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ThumbsUp
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface ProviderMetrics {
  providerId: string;
  providerName: string;
  successRate: number;
  avgLatencyMs: number;
  avgCost: number;
  healthStatus: 'healthy' | 'degraded' | 'failing' | 'circuit-open';
  circuitBreakerOpen: boolean;
  totalRequests: number;
  errorCount: number;
  lastUpdated: string;
}

export function ProviderHealthDashboard() {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [feedbackScore, setFeedbackScore] = useState<number>(0.8);
  const { toast } = useToast();

  // Fetch provider health metrics
  const { data: healthData, isLoading, refetch } = useQuery({
    queryKey: ['/api/jurexio/provider-health'],
    refetchInterval: 10000 // Auto-refresh every 10 seconds
  });

  // Fetch feedback statistics
  const { data: statsData } = useQuery({
    queryKey: ['/api/jurexio/feedback-stats'],
    refetchInterval: 10000
  });

  // Submit quality feedback mutation
  const feedbackMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProvider) return;

      return apiRequest('/api/jurexio/quality-feedback', {
        method: 'POST',
        body: {
          providerId: selectedProvider,
          qualityScore: feedbackScore,
          feedbackType: 'human'
        }
      });
    },
    onSuccess: () => {
      toast({
        title: '✅ Feedback Submitted',
        description: 'Quality feedback recorded successfully'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/jurexio/provider-health'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jurexio/feedback-stats'] });
      setSelectedProvider(null);
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Feedback Failed',
        description: error instanceof Error ? error.message : 'Failed to submit feedback'
      });
    }
  });

  const providers: ProviderMetrics[] = healthData?.providers || [];
  const stats = statsData?.stats;

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'failing':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'circuit-open':
        return <XCircle className="h-4 w-4 text-red-700" />;
      default:
        return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  const getHealthBadgeVariant = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'default';
      case 'degraded':
        return 'secondary';
      case 'failing':
      case 'circuit-open':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  return (
    <div className="space-y-6" data-testid="provider-health-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Provider Health Dashboard</h2>
          <p className="text-muted-foreground">Real-time monitoring of LLM provider performance</p>
        </div>
        <Button
          onClick={() => refetch()}
          variant="outline"
          size="sm"
          data-testid="button-refresh"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Providers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalProviders}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Healthy</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-green-500">{stats.healthyProviders}</div>
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Success Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(stats.avgSuccessRate * 100).toFixed(1)}%</div>
              <Progress value={stats.avgSuccessRate * 100} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Latency</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">{stats.avgLatency.toFixed(0)}ms</div>
                <Clock className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Provider Health Table */}
      <Card>
        <CardHeader>
          <CardTitle>Provider Metrics</CardTitle>
          <CardDescription>
            Live performance metrics for all LLM providers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading provider metrics...</div>
          ) : providers.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No Data</AlertTitle>
              <AlertDescription>No provider metrics available yet</AlertDescription>
            </Alert>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Success Rate</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Avg Cost</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((provider) => (
                    <TableRow 
                      key={provider.providerId}
                      data-testid={`provider-row-${provider.providerId}`}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {getHealthIcon(provider.healthStatus)}
                          <span>{provider.providerName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getHealthBadgeVariant(provider.healthStatus)}>
                          {provider.healthStatus.toUpperCase()}
                        </Badge>
                        {provider.circuitBreakerOpen && (
                          <Badge variant="destructive" className="ml-2">
                            Circuit Open
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-semibold">
                            {(provider.successRate * 100).toFixed(1)}%
                          </span>
                          <Progress 
                            value={provider.successRate * 100} 
                            className="w-20 h-1"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span>{provider.avgLatencyMs.toFixed(0)}ms</span>
                          {provider.avgLatencyMs < 2000 ? (
                            <TrendingUp className="h-3 w-3 text-green-500" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-500" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${provider.avgCost.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right">
                        {provider.totalRequests.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={provider.errorCount > 0 ? 'text-red-500 font-semibold' : ''}>
                          {provider.errorCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedProvider(provider.providerId)}
                          data-testid={`button-feedback-${provider.providerId}`}
                        >
                          <ThumbsUp className="h-3 w-3 mr-1" />
                          Feedback
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quality Feedback Modal */}
      {selectedProvider && (
        <Card className="border-2 border-primary">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Submit Quality Feedback</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedProvider(null)}
              >
                Close
              </Button>
            </CardTitle>
            <CardDescription>
              Rate the quality of {providers.find(p => p.providerId === selectedProvider)?.providerName}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Quality Score</Label>
                <span className="text-2xl font-bold">{(feedbackScore * 100).toFixed(0)}%</span>
              </div>
              <Slider
                value={[feedbackScore * 100]}
                onValueChange={(values) => setFeedbackScore(values[0] / 100)}
                min={0}
                max={100}
                step={5}
                className="w-full"
              />
              <p className="text-sm text-muted-foreground">
                {feedbackScore >= 0.9 ? 'Excellent' :
                 feedbackScore >= 0.7 ? 'Good' :
                 feedbackScore >= 0.5 ? 'Average' :
                 feedbackScore >= 0.3 ? 'Poor' : 'Very Poor'}
              </p>
            </div>

            <Button
              onClick={() => feedbackMutation.mutate()}
              disabled={feedbackMutation.isPending}
              className="w-full"
              data-testid="button-submit-feedback"
            >
              {feedbackMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <ThumbsUp className="mr-2 h-4 w-4" />
                  Submit Feedback
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
