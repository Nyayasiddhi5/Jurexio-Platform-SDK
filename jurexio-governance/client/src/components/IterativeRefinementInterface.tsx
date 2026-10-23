
import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Progress } from './ui/progress';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { 
  MessageCircle, 
  RefreshCw, 
  Star, 
  ThumbsUp, 
  ThumbsDown, 
  Send, 
  History,
  GitCompare,
  Settings,
  Download,
  Share2
} from 'lucide-react';

interface RefinementSession {
  id: string;
  originalPrompt: string;
  currentPrompt: string;
  type: 'content' | 'software' | 'game';
  iterations: RefinementIteration[];
  status: 'active' | 'completed' | 'paused';
}

interface RefinementIteration {
  id: string;
  prompt: string;
  enhancedPrompt: string;
  output: any;
  userFeedback?: UserFeedback;
  timestamp: Date;
  cost: number;
  quality: number;
}

interface UserFeedback {
  satisfaction: number;
  specificIssues: string[];
  desiredChanges: string[];
  additionalRequirements: string[];
}

interface ConversationMessage {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
}

interface IterativeRefinementInterfaceProps {
  initialPrompt?: string;
  type: 'content' | 'software' | 'game';
  onComplete?: (finalOutput: any) => void;
}

export const IterativeRefinementInterface: React.FC<IterativeRefinementInterfaceProps> = ({
  initialPrompt = '',
  type,
  onComplete
}) => {
  const [session, setSession] = useState<RefinementSession | null>(null);
  const [currentIteration, setCurrentIteration] = useState<RefinementIteration | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const [feedback, setFeedback] = useState<Partial<UserFeedback>>({
    satisfaction: 7,
    specificIssues: [],
    desiredChanges: [],
    additionalRequirements: []
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('output');
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialPrompt && !session) {
      startRefinementSession();
    }
  }, [initialPrompt]);

  useEffect(() => {
    scrollToBottom();
  }, [conversationHistory]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const startRefinementSession = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/refinement/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: initialPrompt,
          type,
          context: { userInterface: 'iterative-refinement' },
          userId: 1
        })
      });

      if (!response.ok) throw new Error('Failed to start refinement session');

      const result = await response.json();
      if (result.success) {
        // Get full session details
        await loadSessionDetails(result.data.sessionId);
      }
    } catch (error) {
      console.error('Failed to start refinement session:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionDetails = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/refinement/${sessionId}`);
      if (!response.ok) throw new Error('Failed to load session');

      const result = await response.json();
      if (result.success) {
        setSession(result.data.session);
        setCurrentIteration(result.data.session.iterations[result.data.session.iterations.length - 1]);
        setConversationHistory(result.data.conversationHistory);
      }
    } catch (error) {
      console.error('Failed to load session details:', error);
    }
  };

  const submitFeedback = async () => {
    if (!session || !feedback.satisfaction) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/refinement/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: {
            satisfaction: feedback.satisfaction,
            specificIssues: feedback.specificIssues || [],
            desiredChanges: feedback.desiredChanges || [],
            additionalRequirements: feedback.additionalRequirements || []
          }
        })
      });

      if (!response.ok) throw new Error('Failed to submit feedback');

      const result = await response.json();
      if (result.success) {
        await loadSessionDetails(session.id);
        setShowFeedbackPanel(false);
        setFeedback({
          satisfaction: 7,
          specificIssues: [],
          desiredChanges: [],
          additionalRequirements: []
        });
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendChatMessage = async () => {
    if (!session || !chatMessage.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/refinement/${session.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatMessage })
      });

      if (!response.ok) throw new Error('Failed to send message');

      const result = await response.json();
      if (result.success) {
        setChatMessage('');
        await loadSessionDetails(session.id);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setLoading(false);
    }
  };

  const addToFeedbackList = (field: keyof UserFeedback, value: string) => {
    if (!value.trim()) return;
    
    setFeedback(prev => ({
      ...prev,
      [field]: [...(prev[field] || []), value]
    }));
  };

  const removeFromFeedbackList = (field: keyof UserFeedback, index: number) => {
    setFeedback(prev => ({
      ...prev,
      [field]: (prev[field] || []).filter((_, i) => i !== index)
    }));
  };

  const renderOutput = () => {
    if (!currentIteration) return null;

    const output = currentIteration.output;

    switch (type) {
      case 'content':
        return (
          <div className="space-y-4">
            <div className="prose max-w-none">
              {output.content && (
                <div dangerouslySetInnerHTML={{ __html: output.content }} />
              )}
            </div>
            {output.metadata && (
              <div className="text-sm text-gray-600">
                <p>Type: {output.type}</p>
                <p>Provider: {output.metadata.provider}</p>
              </div>
            )}
          </div>
        );
      
      case 'software':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Architecture</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{output.architecture}</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Features</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1">
                    {output.features?.map((feature: string, idx: number) => (
                      <li key={idx}>• {feature}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Generated Code</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
                  <code>{output.code}</code>
                </pre>
              </CardContent>
            </Card>
          </div>
        );
      
      case 'game':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Game Mechanics</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1">
                    {output.mechanics?.map((mechanic: string, idx: number) => (
                      <li key={idx}>• {mechanic}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Assets</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1">
                    {output.assets?.map((asset: string, idx: number) => (
                      <li key={idx}>• {asset}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Levels</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1">
                    {output.levels?.map((level: string, idx: number) => (
                      <li key={idx}>• {level}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Game Code</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
                  <code>{output.gameCode}</code>
                </pre>
              </CardContent>
            </Card>
          </div>
        );
      
      default:
        return <pre className="text-sm">{JSON.stringify(output, null, 2)}</pre>;
    }
  };

  if (loading && !session) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Starting your refinement session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center p-8">
        <p>No active refinement session. Please provide an initial prompt to get started.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Iterative {type.charAt(0).toUpperCase() + type.slice(1)} Refinement</h1>
          <p className="text-gray-600">Iteration {session.iterations.length} of your {type} project</p>
        </div>
        
        <div className="flex items-center space-x-4">
          <Badge variant={session.status === 'active' ? 'default' : 'secondary'}>
            {session.status}
          </Badge>
          
          {currentIteration && (
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <Star className="w-4 h-4" />
              <span>Quality: {Math.round(currentIteration.quality * 100)}%</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="output">Output</TabsTrigger>
              <TabsTrigger value="prompt">Prompt</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="compare">Compare</TabsTrigger>
            </TabsList>
            
            <TabsContent value="output" className="mt-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Generated {type.charAt(0).toUpperCase() + type.slice(1)}</CardTitle>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowFeedbackPanel(true)}
                      >
                        <MessageCircle className="w-4 h-4 mr-2" />
                        Provide Feedback
                      </Button>
                      <Button variant="outline" size="sm">
                        <Download className="w-4 h-4 mr-2" />
                        Export
                      </Button>
                      <Button variant="outline" size="sm">
                        <Share2 className="w-4 h-4 mr-2" />
                        Share
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {renderOutput()}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="prompt" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Current Prompt</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Original Prompt:</h4>
                    <p className="text-sm bg-gray-50 p-3 rounded">{session.originalPrompt}</p>
                  </div>
                  
                  {currentIteration && (
                    <div>
                      <h4 className="font-semibold text-sm mb-2">Enhanced Prompt:</h4>
                      <p className="text-sm bg-blue-50 p-3 rounded">{currentIteration.enhancedPrompt}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="history" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Iteration History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {session.iterations.map((iteration, index) => (
                      <div key={iteration.id} className="border rounded p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold">Iteration {index + 1}</h4>
                          <div className="flex items-center space-x-2">
                            <Badge variant="outline">
                              Quality: {Math.round(iteration.quality * 100)}%
                            </Badge>
                            <span className="text-xs text-gray-500">
                              ${iteration.cost.toFixed(3)}
                            </span>
                          </div>
                        </div>
                        
                        <p className="text-sm text-gray-600 mb-2">
                          {new Date(iteration.timestamp).toLocaleString()}
                        </p>
                        
                        {iteration.userFeedback && (
                          <div className="text-sm">
                            <p>Satisfaction: {iteration.userFeedback.satisfaction}/10</p>
                            {iteration.userFeedback.specificIssues.length > 0 && (
                              <p>Issues: {iteration.userFeedback.specificIssues.join(', ')}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="compare" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Compare Iterations</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600">
                    Select two iterations to compare their outputs and improvements.
                  </p>
                  {/* Comparison functionality would go here */}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Chat & Feedback Sidebar */}
        <div className="space-y-6">
          {/* Chat Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Chat with AI Assistant</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64 mb-4">
                <div className="space-y-3">
                  {conversationHistory.map((message, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded text-sm ${
                        message.role === 'user'
                          ? 'bg-blue-100 ml-4'
                          : message.role === 'agent'
                          ? 'bg-gray-100 mr-4'
                          : 'bg-yellow-50 text-center'
                      }`}
                    >
                      <div className="font-semibold text-xs mb-1 capitalize">
                        {message.role}
                      </div>
                      <div>{message.content}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>
              
              <div className="flex space-x-2">
                <Input
                  placeholder="Ask questions or describe changes..."
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                />
                <Button onClick={sendChatMessage} disabled={loading || !chatMessage.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setShowFeedbackPanel(true)}
              >
                <ThumbsUp className="w-4 h-4 mr-2" />
                Provide Detailed Feedback
              </Button>
              
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => submitFeedback()}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Regenerate with Current Settings
              </Button>
              
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => onComplete?.(currentIteration?.output)}
              >
                <Settings className="w-4 h-4 mr-2" />
                Mark as Complete
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Feedback Panel Modal */}
      {showFeedbackPanel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl m-4">
            <CardHeader>
              <CardTitle>Provide Detailed Feedback</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Satisfaction Level (1-10)
                </label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={feedback.satisfaction || 7}
                  onChange={(e) => setFeedback(prev => ({
                    ...prev,
                    satisfaction: parseInt(e.target.value)
                  }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Specific Issues
                </label>
                <div className="space-y-2">
                  <div className="flex space-x-2">
                    <Input
                      placeholder="What specific issues do you see?"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          addToFeedbackList('specificIssues', (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={(e) => {
                        const input = (e.target as HTMLElement).parentElement?.querySelector('input');
                        if (input) {
                          addToFeedbackList('specificIssues', input.value);
                          input.value = '';
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    {feedback.specificIssues?.map((issue, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => removeFromFeedbackList('specificIssues', index)}
                      >
                        {issue} ×
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Desired Changes
                </label>
                <div className="space-y-2">
                  <div className="flex space-x-2">
                    <Input
                      placeholder="What changes would you like to see?"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          addToFeedbackList('desiredChanges', (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={(e) => {
                        const input = (e.target as HTMLElement).parentElement?.querySelector('input');
                        if (input) {
                          addToFeedbackList('desiredChanges', input.value);
                          input.value = '';
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    {feedback.desiredChanges?.map((change, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => removeFromFeedbackList('desiredChanges', index)}
                      >
                        {change} ×
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex space-x-4">
                <Button
                  onClick={() => setShowFeedbackPanel(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitFeedback}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
                  Submit Feedback & Regenerate
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default IterativeRefinementInterface;
