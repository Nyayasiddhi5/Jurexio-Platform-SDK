/**
 * P1 AI Quality Enhancement Test Page
 * 
 * Comprehensive testing interface for:
 * - Token cost prediction
 * - Provider quality scoring
 * - Auto-fallback routing
 * - Health monitoring
 * - Quality feedback loops
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CostEstimator } from '@/components/cost-estimator';
import { ProviderHealthDashboard } from '@/components/provider-health-dashboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { 
  TestTube, 
  DollarSign, 
  Activity, 
  TrendingUp,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

export default function P1AIQualityTest() {
  const { toast } = useToast();
  const [testWorkflow, setTestWorkflow] = useState('code_generation');
  const [testDescription, setTestDescription] = useState('Build a React component for user authentication with form validation');
  const [testResults, setTestResults] = useState<any[]>([]);

  // Test mutation for cost prediction
  const runCostPredictionTest = useMutation({
    mutationFn: async () => {
      const result = await apiRequest('/api/jurexio/estimate-cost', {
        method: 'POST',
        body: {
          workflow: testWorkflow,
          taskDescription: testDescription
        }
      });
      return result;
    },
    onSuccess: (data) => {
      const testResult = {
        type: 'Cost Prediction',
        timestamp: new Date().toISOString(),
        success: true,
        data: {
          estimatedCost: data.prediction.estimatedCost,
          complexity: data.prediction.complexity.complexity,
          recommendedProvider: data.prediction.recommendedProvider.providerName,
          confidence: data.prediction.confidenceScore
        }
      };
      
      setTestResults(prev => [testResult, ...prev]);
      
      toast({
        title: '✅ Test Passed: Cost Prediction',
        description: `Estimated $${data.prediction.estimatedCost.toFixed(4)} with ${(data.prediction.confidenceScore * 100).toFixed(0)}% confidence`
      });
    },
    onError: (error) => {
      const testResult = {
        type: 'Cost Prediction',
        timestamp: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      
      setTestResults(prev => [testResult, ...prev]);
      
      toast({
        variant: 'destructive',
        title: '❌ Test Failed: Cost Prediction',
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Test mutation for quality feedback
  const runQualityFeedbackTest = useMutation({
    mutationFn: async () => {
      const result = await apiRequest('/api/jurexio/quality-feedback', {
        method: 'POST',
        body: {
          providerId: 'openai',
          qualityScore: 0.95,
          feedbackType: 'automated',
          metadata: {
            taskType: 'test',
            expectation: 'High quality code generation',
            actualResult: 'Met expectations'
          }
        }
      });
      return result;
    },
    onSuccess: (data) => {
      const testResult = {
        type: 'Quality Feedback',
        timestamp: new Date().toISOString(),
        success: true,
        data: {
          provider: 'openai',
          newSuccessRate: data.metrics.successRate,
          healthStatus: data.metrics.healthStatus
        }
      };
      
      setTestResults(prev => [testResult, ...prev]);
      
      toast({
        title: '✅ Test Passed: Quality Feedback',
        description: `Provider metrics updated successfully`
      });
    },
    onError: (error) => {
      const testResult = {
        type: 'Quality Feedback',
        timestamp: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      
      setTestResults(prev => [testResult, ...prev]);
      
      toast({
        variant: 'destructive',
        title: '❌ Test Failed: Quality Feedback',
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Run all tests
  const runAllTests = async () => {
    toast({
      title: '🧪 Running All Tests',
      description: 'Executing comprehensive P1 test suite...'
    });

    // Sequential execution for clean test results
    await runCostPredictionTest.mutateAsync();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await runQualityFeedbackTest.mutateAsync();
  };

  const passedTests = testResults.filter(r => r.success).length;
  const failedTests = testResults.filter(r => !r.success).length;
  const totalTests = testResults.length;

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <TestTube className="h-8 w-8" />
          <h1 className="text-3xl font-bold">P1 AI Quality Enhancement Testing</h1>
        </div>
        <p className="text-muted-foreground">
          Comprehensive test suite for cost prediction, quality scoring, and intelligent routing
        </p>
      </div>

      {/* Test Results Summary */}
      {totalTests > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Test Results Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{totalTests}</p>
                <p className="text-sm text-muted-foreground">Total Tests</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-500">{passedTests}</p>
                <p className="text-sm text-muted-foreground">Passed</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-500">{failedTests}</p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Testing Interface */}
      <Tabs defaultValue="cost-prediction" className="w-full">
        <TabsList className="grid w-full grid-cols-4" aria-label="Navigation tabs">
          <TabsTrigger value="cost-prediction" aria-label="cost prediction tab">
            <DollarSign className="mr-2 h-4 w-4" />
            Cost Prediction
          </TabsTrigger>
          <TabsTrigger value="health-monitoring" aria-label="health monitoring tab">
            <Activity className="mr-2 h-4 w-4" />
            Health Monitoring
          </TabsTrigger>
          <TabsTrigger value="manual-tests" aria-label="manual tests tab">
            <TestTube className="mr-2 h-4 w-4" />
            Manual Tests
          </TabsTrigger>
          <TabsTrigger value="test-results" aria-label="test results tab">
            <TrendingUp className="mr-2 h-4 w-4" />
            Test Results
          </TabsTrigger>
        </TabsList>

        {/* Cost Prediction Testing */}
        <TabsContent value="cost-prediction" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Token Cost Prediction Test</CardTitle>
              <CardDescription>
                Test cost estimation accuracy with real workflows
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Workflow Type</Label>
                <Input
                  value={testWorkflow}
                  onChange={(e) => setTestWorkflow(e.target.value)}
                  placeholder="e.g., code_generation, content_creation"
                  data-testid="input-test-workflow"
                />
              </div>

              <div className="space-y-2">
                <Label>Task Description</Label>
                <Textarea
                  value={testDescription}
                  onChange={(e) => setTestDescription(e.target.value)}
                  placeholder="Describe the task in detail..."
                  rows={3}
                  data-testid="input-test-description"
                />
              </div>

              <CostEstimator
                workflow={testWorkflow}
                taskDescription={testDescription}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Health Monitoring Testing */}
        <TabsContent value="health-monitoring" className="space-y-4">
          <ProviderHealthDashboard />
        </TabsContent>

        {/* Manual Tests */}
        <TabsContent value="manual-tests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Manual Test Suite</CardTitle>
              <CardDescription>
                Execute individual tests for each P1 component
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Button
                  onClick={() => runCostPredictionTest.mutate()}
                  disabled={runCostPredictionTest.isPending}
                  data-testid="button-test-cost-prediction"
                >
                  <DollarSign className="mr-2 h-4 w-4" />
                  Test Cost Prediction
                </Button>

                <Button
                  onClick={() => runQualityFeedbackTest.mutate()}
                  disabled={runQualityFeedbackTest.isPending}
                  data-testid="button-test-quality-feedback"
                >
                  <Activity className="mr-2 h-4 w-4" />
                  Test Quality Feedback
                </Button>

                <Button
                  onClick={runAllTests}
                  disabled={runCostPredictionTest.isPending || runQualityFeedbackTest.isPending}
                  variant="default"
                  className="col-span-2"
                  data-testid="button-run-all-tests"
                >
                  <TestTube className="mr-2 h-4 w-4" />
                  Run All Tests
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Test Results Log */}
        <TabsContent value="test-results" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Test Execution Log</CardTitle>
              <CardDescription>
                Detailed results from all test executions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {testResults.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No test results yet. Run some tests to see results here.
                </div>
              ) : (
                <div className="space-y-3">
                  {testResults.map((result, idx) => (
                    <Card key={idx} className={result.success ? 'border-green-500/20' : 'border-red-500/20'}>
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                            ) : (
                              <AlertCircle className="h-5 w-5 text-red-500" />
                            )}
                            <div>
                              <p className="font-semibold">{result.type}</p>
                              <p className="text-sm text-muted-foreground">
                                {new Date(result.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <Badge variant={result.success ? 'default' : 'destructive'}>
                            {result.success ? 'PASS' : 'FAIL'}
                          </Badge>
                        </div>
                        
                        {result.success && result.data && (
                          <div className="mt-3 text-sm">
                            <pre className="bg-muted p-2 rounded">
                              {JSON.stringify(result.data, null, 2)}
                            </pre>
                          </div>
                        )}
                        
                        {!result.success && result.error && (
                          <div className="mt-3 text-sm text-red-500">
                            Error: {result.error}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
