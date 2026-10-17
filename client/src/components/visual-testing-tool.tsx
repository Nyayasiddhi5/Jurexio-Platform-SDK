import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, Code, Trash2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface VisualTestResult {
  success: boolean;
  testName: string;
  passed: boolean;
  totalDiffPercentage?: number;
  screenshots: Array<{
    viewport: string;
    selector?: string;
    screenshotPath: string;
    diffPercentage?: number;
    passed: boolean;
  }>;
  message: string;
  error?: string;
  executionTime: number;
}

export default function VisualTestingTool() {
  const { toast } = useToast();
  const [testName, setTestName] = useState('');
  const [url, setUrl] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<VisualTestResult | null>(null);
  const [generatedCode, setGeneratedCode] = useState('');

  const runTest = async () => {
    if (!testName || !url) {
      toast({ title: 'Validation Error', description: 'Test name and URL are required', variant: 'destructive' });
      return;
    }

    setIsRunning(true);
    setResult(null);

    try {
      const response = await apiRequest<VisualTestResult>('/api/visual-testing/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testName,
          url,
          viewports: [{ width: 1280, height: 720, name: 'desktop' }],
          fullPage: true,
          threshold: 0.1
        })
      });

      setResult(response);
      toast({
        title: response.passed ? 'Test Passed' : 'Test Failed',
        description: response.message
      });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to run test', variant: 'destructive' });
    } finally {
      setIsRunning(false);
    }
  };

  const generateTest = async () => {
    if (!url) {
      toast({ title: 'Validation Error', description: 'URL is required', variant: 'destructive' });
      return;
    }

    setIsGenerating(true);
    try {
      const response = await apiRequest<{ success: boolean; testCode?: string; error?: string }>('/api/visual-testing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `Visual regression test for ${testName || 'application'}`,
          url,
          testType: 'visual'
        })
      });

      if (response.success && response.testCode) {
        setGeneratedCode(response.testCode);
        toast({ title: 'Success', description: 'Test code generated' });
      } else {
        toast({ title: 'Error', description: response.error || 'Failed to generate code', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to generate test', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-visual-testing">
        <CardHeader>
          <CardTitle data-testid="text-title">Visual E2E Testing Tool</CardTitle>
          <CardDescription data-testid="text-description">
            Run visual regression tests with screenshot comparison
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="run" className="w-full">
            <TabsList className="grid w-full grid-cols-2" data-testid="tabs-visual-testing">
              <TabsTrigger value="run" data-testid="tab-run-tests">Run Tests</TabsTrigger>
              <TabsTrigger value="generate" data-testid="tab-generate-code">Generate Code</TabsTrigger>
            </TabsList>

            <TabsContent value="run" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="test-name" data-testid="label-test-name">Test Name</Label>
                <Input
                  id="test-name"
                  data-testid="input-test-name"
                  placeholder="homepage-test"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="test-url" data-testid="label-test-url">URL</Label>
                <Input
                  id="test-url"
                  data-testid="input-test-url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <Button
                onClick={runTest}
                disabled={isRunning}
                className="w-full"
                data-testid="button-run-test"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running Test...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Run Visual Test
                  </>
                )}
              </Button>

              {result && (
                <Alert
                  variant={result.passed ? 'default' : 'destructive'}
                  data-testid={`alert-result-${result.passed ? 'pass' : 'fail'}`}
                >
                  {result.passed ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertTitle data-testid="text-result-title">
                    {result.passed ? 'Test Passed' : 'Test Failed'}
                  </AlertTitle>
                  <AlertDescription data-testid="text-result-message">
                    {result.message}
                    {result.totalDiffPercentage !== undefined && (
                      <div className="mt-2">
                        Average Diff: {result.totalDiffPercentage.toFixed(2)}%
                      </div>
                    )}
                    <div className="mt-2">
                      Execution Time: {result.executionTime}ms
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {result?.screenshots && result.screenshots.length > 0 && (
                <Card data-testid="card-screenshots">
                  <CardHeader>
                    <CardTitle className="text-sm">Screenshots</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {result.screenshots.map((screenshot, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 border rounded"
                        data-testid={`screenshot-${index}`}
                      >
                        <div>
                          <div className="font-medium">{screenshot.viewport}</div>
                          {screenshot.selector && (
                            <div className="text-sm text-muted-foreground">{screenshot.selector}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {screenshot.diffPercentage !== undefined && (
                            <Badge variant={screenshot.passed ? 'default' : 'destructive'} data-testid={`badge-diff-${index}`}>
                              {screenshot.diffPercentage.toFixed(2)}%
                            </Badge>
                          )}
                          {screenshot.passed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="generate" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gen-url" data-testid="label-gen-url">URL</Label>
                <Input
                  id="gen-url"
                  data-testid="input-gen-url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <Button
                onClick={generateTest}
                disabled={isGenerating}
                className="w-full"
                data-testid="button-generate-code"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Code className="mr-2 h-4 w-4" />
                    Generate Test Code
                  </>
                )}
              </Button>

              {generatedCode && (
                <Card data-testid="card-generated-code">
                  <CardHeader>
                    <CardTitle className="text-sm">Generated Test Code</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-muted p-4 rounded overflow-x-auto" data-testid="pre-code">
                      {generatedCode}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
