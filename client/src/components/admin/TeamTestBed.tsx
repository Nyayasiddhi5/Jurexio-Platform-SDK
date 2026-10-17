import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import {
  Play, Pause, Square, CheckCircle, XCircle, Clock, AlertTriangle,
  Bot, Users, FlaskConical, FileText, Download, RefreshCw, ChevronRight,
  MessageSquare, Zap, TrendingUp, Timer
} from 'lucide-react';

interface TestCase {
  id: string;
  name: string;
  description: string;
  type: 'workflow' | 'agent' | 'integration' | 'stress';
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  duration?: number;
  error?: string;
}

interface TestRun {
  id: string;
  teamId: string;
  teamName: string;
  startedAt: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  passedTests: number;
  failedTests: number;
  totalTests: number;
}

const sampleTestCases: TestCase[] = [
  { id: 'tc-1', name: 'Agent Initialization', description: 'Verify all agents initialize correctly', type: 'agent', status: 'passed', duration: 245 },
  { id: 'tc-2', name: 'Workflow Execution', description: 'Test standard workflow execution path', type: 'workflow', status: 'passed', duration: 1823 },
  { id: 'tc-3', name: 'Inter-Agent Communication', description: 'Validate A2A protocol messaging', type: 'integration', status: 'passed', duration: 567 },
  { id: 'tc-4', name: 'LLM Provider Fallback', description: 'Test provider failover behavior', type: 'integration', status: 'running' },
  { id: 'tc-5', name: 'Concurrent Task Handling', description: 'Stress test with multiple parallel tasks', type: 'stress', status: 'pending' },
  { id: 'tc-6', name: 'Memory Persistence', description: 'Verify agent memory across sessions', type: 'agent', status: 'pending' },
  { id: 'tc-7', name: 'Error Recovery', description: 'Test agent error handling and recovery', type: 'workflow', status: 'pending' },
  { id: 'tc-8', name: 'HITL Escalation', description: 'Validate human-in-the-loop escalation', type: 'workflow', status: 'pending' },
];

const availableTeams = [
  { id: 'finance', name: 'Finance Team', agents: 5, lastTested: '2 hours ago' },
  { id: 'development', name: 'Development Team', agents: 6, lastTested: '1 day ago' },
  { id: 'marketing', name: 'Marketing Team', agents: 5, lastTested: 'Never' },
  { id: 'hr', name: 'HR Team', agents: 5, lastTested: 'Never' },
];

export default function TeamTestBed() {
  const { toast } = useToast();
  const [selectedTeam, setSelectedTeam] = useState('finance');
  const [testCases, setTestCases] = useState<TestCase[]>(sampleTestCases);
  const [isRunning, setIsRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<TestRun | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [activeTab, setActiveTab] = useState('tests');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-600" />;
      case 'running': return <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />;
      case 'pending': return <Clock className="w-4 h-4 text-gray-400" />;
      default: return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      passed: 'default',
      failed: 'destructive',
      running: 'secondary',
      pending: 'outline',
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  const runTests = () => {
    setIsRunning(true);
    const team = availableTeams.find(t => t.id === selectedTeam);
    setCurrentRun({
      id: `run-${Date.now()}`,
      teamId: selectedTeam,
      teamName: team?.name || 'Unknown Team',
      startedAt: new Date().toISOString(),
      status: 'running',
      progress: 0,
      passedTests: 0,
      failedTests: 0,
      totalTests: testCases.length,
    });

    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex >= testCases.length) {
        clearInterval(interval);
        setIsRunning(false);
        setCurrentRun(prev => prev ? { ...prev, status: 'completed', progress: 100 } : null);
        toast({ title: 'Test Run Complete', description: `All ${testCases.length} tests finished` });
        return;
      }

      setTestCases(prev => prev.map((tc, idx) => {
        if (idx === currentIndex) {
          const passed = Math.random() > 0.2;
          return { ...tc, status: passed ? 'passed' : 'failed', duration: Math.floor(Math.random() * 2000) + 100 };
        }
        if (idx === currentIndex + 1) {
          return { ...tc, status: 'running' };
        }
        return tc;
      }));

      setCurrentRun(prev => {
        if (!prev) return null;
        const passed = testCases[currentIndex].status === 'passed' ? prev.passedTests + 1 : prev.passedTests;
        const failed = testCases[currentIndex].status === 'failed' ? prev.failedTests + 1 : prev.failedTests;
        return {
          ...prev,
          progress: ((currentIndex + 1) / testCases.length) * 100,
          passedTests: passed,
          failedTests: failed,
        };
      });

      currentIndex++;
    }, 1500);
  };

  const stopTests = () => {
    setIsRunning(false);
    setCurrentRun(prev => prev ? { ...prev, status: 'failed' } : null);
    toast({ title: 'Test Run Stopped', description: 'Test execution was stopped by user' });
  };

  const runCustomTest = () => {
    if (!customPrompt.trim()) {
      toast({ title: 'Error', description: 'Please enter a test prompt', variant: 'destructive' });
      return;
    }
    toast({ title: 'Custom Test Started', description: 'Running custom test with your prompt...' });
  };

  const passRate = currentRun ? (currentRun.passedTests / Math.max(currentRun.passedTests + currentRun.failedTests, 1)) * 100 : 0;

  return (
    <div className="space-y-6" data-testid="team-test-bed">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-testbed-title">Team Test Bed</h2>
          <p className="text-muted-foreground">Test and validate team configurations before production deployment</p>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <Button variant="destructive" onClick={stopTests} data-testid="button-stop-tests">
              <Square className="w-4 h-4 mr-2" />
              Stop Tests
            </Button>
          ) : (
            <Button onClick={runTests} data-testid="button-run-tests">
              <Play className="w-4 h-4 mr-2" />
              Run All Tests
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Select Team</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger data-testid="select-test-team">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableTeams.map(team => (
                    <SelectItem key={team.id} value={team.id} data-testid={`option-team-${team.id}`}>
                      {team.name} ({team.agents} agents)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {currentRun && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Current Run</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Progress</span>
                    <span>{Math.round(currentRun.progress)}%</span>
                  </div>
                  <Progress value={currentRun.progress} className="h-2" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2 bg-green-50 rounded">
                    <div className="text-lg font-bold text-green-600" data-testid="text-passed-count">{currentRun.passedTests}</div>
                    <div className="text-xs text-green-700">Passed</div>
                  </div>
                  <div className="p-2 bg-red-50 rounded">
                    <div className="text-lg font-bold text-red-600" data-testid="text-failed-count">{currentRun.failedTests}</div>
                    <div className="text-xs text-red-700">Failed</div>
                  </div>
                </div>
                <div className="text-center p-2 bg-muted rounded">
                  <div className="text-lg font-bold" data-testid="text-pass-rate">{passRate.toFixed(0)}%</div>
                  <div className="text-xs text-muted-foreground">Pass Rate</div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Test Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Tests</span>
                <span className="font-medium">{testCases.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Passed</span>
                <span className="font-medium text-green-600">{testCases.filter(t => t.status === 'passed').length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Failed</span>
                <span className="font-medium text-red-600">{testCases.filter(t => t.status === 'failed').length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending</span>
                <span className="font-medium">{testCases.filter(t => t.status === 'pending').length}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-9">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList data-testid="tabs-testbed">
              <TabsTrigger value="tests" data-testid="tab-tests">
                <FlaskConical className="w-4 h-4 mr-2" />
                Test Cases
              </TabsTrigger>
              <TabsTrigger value="custom" data-testid="tab-custom">
                <MessageSquare className="w-4 h-4 mr-2" />
                Custom Test
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history">
                <FileText className="w-4 h-4 mr-2" />
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tests" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Test Cases</CardTitle>
                  <CardDescription>Automated tests to validate team functionality</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {testCases.map(tc => (
                        <div key={tc.id} className="flex items-center justify-between p-3 bg-muted rounded-lg" data-testid={`row-test-${tc.id}`}>
                          <div className="flex items-center gap-3">
                            {getStatusIcon(tc.status)}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm" data-testid={`text-test-name-${tc.id}`}>{tc.name}</span>
                                <Badge variant="outline" className="text-xs">{tc.type}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{tc.description}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {tc.duration && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Timer className="w-3 h-3" />
                                {tc.duration}ms
                              </span>
                            )}
                            {getStatusBadge(tc.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="custom" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Custom Test</CardTitle>
                  <CardDescription>Run a custom test with your own prompt to validate team behavior</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="custom-prompt">Test Prompt</Label>
                    <Textarea
                      id="custom-prompt"
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="Enter a task or scenario to test with the selected team..."
                      className="min-h-[150px]"
                      data-testid="textarea-custom-prompt"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={runCustomTest} data-testid="button-run-custom">
                      <Play className="w-4 h-4 mr-2" />
                      Run Custom Test
                    </Button>
                    <Button variant="outline" data-testid="button-load-template">
                      <FileText className="w-4 h-4 mr-2" />
                      Load Template
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Test History</CardTitle>
                  <CardDescription>Previous test runs and their results</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { id: 'h1', team: 'Finance Team', date: '2 hours ago', passed: 7, failed: 1, total: 8 },
                      { id: 'h2', team: 'Development Team', date: '1 day ago', passed: 8, failed: 0, total: 8 },
                      { id: 'h3', team: 'Finance Team', date: '3 days ago', passed: 6, failed: 2, total: 8 },
                    ].map(run => (
                      <div key={run.id} className="flex items-center justify-between p-3 bg-muted rounded-lg" data-testid={`row-history-${run.id}`}>
                        <div>
                          <span className="font-medium">{run.team}</span>
                          <p className="text-xs text-muted-foreground">{run.date}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-green-600">{run.passed} passed</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-red-600">{run.failed} failed</span>
                          </div>
                          <Badge variant={run.failed === 0 ? 'default' : 'secondary'}>
                            {((run.passed / run.total) * 100).toFixed(0)}%
                          </Badge>
                          <Button variant="ghost" size="sm" data-testid={`button-view-${run.id}`}>
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
