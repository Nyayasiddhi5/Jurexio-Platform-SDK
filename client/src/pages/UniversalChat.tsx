import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { 
  Send, Upload, Mic, MicOff, Volume2, VolumeX, Copy, Download, 
  RotateCcw, Bot, User, Sparkles, Settings, FileText, Image, 
  Video, Music, Code, Workflow, ChevronRight, Check, Clock,
  Globe, Wand2, Zap, Brain, Target
} from 'lucide-react';

interface ChatMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: any[];
  metadata: {
    agentId?: string;
    agentName?: string;
    modelUsed?: string;
    tokensUsed?: number;
    processingTime?: number;
  };
  timestamp: string;
}

interface WorkflowStep {
  stepId: string;
  stepNumber: number;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  agentName: string;
}

interface AgentGroup {
  id: string;
  name: string;
  description: string;
  agents?: string[];
}

export default function UniversalChat() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedAgentGroup, setSelectedAgentGroup] = useState<string>('auto');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [useWorkflow, setUseWorkflow] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [promptStyle, setPromptStyle] = useState<string>('detailed');
  const [isStubMode, setIsStubMode] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: agentGroups } = useQuery<{ success: boolean; data: AgentGroup[] }>({
    queryKey: ['/api/chat/agent-groups']
  });

  const { data: languages } = useQuery<{ success: boolean; data: { code: string; name: string; native: string }[] }>({
    queryKey: ['/api/chat/languages']
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentGroupId: selectedAgentGroup,
          language: selectedLanguage
        })
      });
    },
    onSuccess: (data: any) => {
      const payload = (data?.data ?? {}) as { sessionId?: string; stub?: boolean; notice?: string };
      if (payload.sessionId) setSessionId(payload.sessionId);
      // Clear any stale red banner from a prior failed attempt (review polish).
      setSessionError(null);
      // task-257: backend now routes through orchestrateLLM, so the legacy
      // stub-mode banner only fires if the gateway is misconfigured and the
      // payload still carries `stub: true`.
      if (payload.stub) {
        setIsStubMode(true);
        toast({
          title: 'Universal Chat is in stub mode',
          description: payload.notice ?? 'Backend session router is staged.',
        });
      } else {
        setIsStubMode(false);
        toast({ title: 'Chat session started' });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to start chat session.';
      setSessionError(message);
      toast({ title: 'Failed to start chat session', description: message, variant: 'destructive' });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      return apiRequest(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, useWorkflow })
      });
    },
    onSuccess: (data: any) => {
      setMessages(prev => [...prev, data.data.userMessage, data.data.assistantMessage]);
      if (data.data.workflowSteps) {
        setWorkflowSteps(data.data.workflowSteps);
      }
      setIsLoading(false);
    },
    onError: () => {
      setIsLoading(false);
      toast({ title: 'Failed to send message', variant: 'destructive' });
    }
  });

  const uploadFilesMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));
      // Mirror `apiRequest`'s auth propagation — the upload route is gated
      // by `authenticateToken`, so we MUST attach the same Bearer token the
      // session/message calls use. (No content-type header — the browser
      // sets the multipart boundary itself.)
      const headers: Record<string, string> = {};
      const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null;
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(`/api/chat/sessions/${sessionId}/upload`, {
        method: 'POST',
        headers,
        body: formData
      }).then(res => res.json());
    },
    onSuccess: () => {
      toast({ title: `${uploadedFiles.length} file(s) uploaded` });
      setUploadedFiles([]);
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!sessionId) {
      createSessionMutation.mutate();
    }
  }, []);

  // task-303 (Demo G3A): prefill from Prompt Library "Try in Universal Chat".
  // The prompt body is parked in sessionStorage by prompt-library.tsx so the
  // navigation can stay on the canonical /chat?tab=universal URL without
  // leaking long template bodies through the query string.
  useEffect(() => {
    try {
      const PROMPT_PREFILL_KEY = 'nv_universal_chat_prefill';
      const seeded = window.sessionStorage.getItem(PROMPT_PREFILL_KEY);
      if (seeded && seeded.length > 0) {
        setInputValue(seeded);
        window.sessionStorage.removeItem(PROMPT_PREFILL_KEY);
      }
    } catch { /* sessionStorage unavailable — non-fatal */ }
  }, []);

  const handleSend = () => {
    if (!inputValue.trim() || !sessionId) return;
    setIsLoading(true);
    sendMessageMutation.mutate(inputValue);
    setInputValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files]);
    if (sessionId && files.length > 0) {
      uploadFilesMutation.mutate(files);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const downloadResponse = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const restartSession = () => {
    setMessages([]);
    setWorkflowSteps([]);
    setSessionId(null);
    createSessionMutation.mutate();
  };

  return (
    <div className="flex h-full min-h-[640px] bg-gradient-to-br from-slate-50 to-slate-100" data-testid="universal-chat-page">
      <div className="flex-1 flex flex-col">
        <header className="border-b bg-white/80 backdrop-blur-sm p-4" role="banner" aria-label="Page header">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                <Brain className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                  Jurexio Orchestration Console
                </h1>
                <p className="text-sm text-muted-foreground">Universal Agent Interface • 164 Agents • 23 Languages</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <Select value={selectedAgentGroup} onValueChange={setSelectedAgentGroup} aria-label="Select option">
                <SelectTrigger className="w-[200px]" data-testid="select-agent-group">
                  <Bot className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Select Agent Group" />
                </SelectTrigger>
                <SelectContent>
                  {agentGroups?.data?.map(group => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage} aria-label="Select option">
                <SelectTrigger className="w-[140px]" data-testid="select-language">
                  <Globe className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Language" />
                </SelectTrigger>
                <SelectContent>
                  {languages?.data?.map(lang => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.native}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Button variant="outline" size="icon" onClick={() => setShowSettings(!showSettings)} data-testid="btn-settings">
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>

        {(isStubMode || sessionError) && (
          <div
            className={`px-4 py-2 text-sm border-b ${sessionError ? 'bg-red-50 text-red-800 border-red-200' : 'bg-amber-50 text-amber-900 border-amber-200'}`}
            role="status"
            data-testid="universal-chat-status-banner"
          >
            {sessionError
              ? `Chat session unavailable: ${sessionError}`
              : 'Universal Chat is in stub mode — selectors and uploads work, but agent replies are placeholder text until the LRM-routed chat backend lands.'}
          </div>
        )}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col">
            <ScrollArea className="flex-1 p-4" aria-label="Scrollable content">
              <div className="max-w-4xl mx-auto space-y-4">
                {messages.length === 0 && (
                  <div className="text-center py-20">
                    <div className="inline-flex p-4 rounded-full bg-gradient-to-br from-violet-100 to-purple-100 mb-4">
                      <Sparkles className="w-12 h-12 text-violet-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Welcome to Jurexio Orchestration Console</h2>
                    <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
                      Your testbed for 164 agents. Upload documents, select specialized agents, 
                      and execute complex workflows with step-by-step visualization.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
                      {[
                        { icon: Code, label: 'Code Generation', color: 'text-blue-500' },
                        { icon: Image, label: 'Image Creation', color: 'text-green-500' },
                        { icon: FileText, label: 'Document Analysis', color: 'text-orange-500' },
                        { icon: Target, label: 'Research & Analysis', color: 'text-purple-500' }
                      ].map((item, i) => (
                        <Card key={i} className="cursor-pointer hover:shadow-md transition-shadow" data-testid={`quick-action-${i}`}>
                          <CardContent className="p-4 text-center">
                            <item.icon className={`w-8 h-8 mx-auto mb-2 ${item.color}`} />
                            <span className="text-sm font-medium">{item.label}</span>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message, index) => (
                  <div
                    key={message.messageId || index}
                    className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    data-testid={`message-${message.role}-${index}`}
                  >
                    {message.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}
                    
                    <div className={`max-w-[80%] ${message.role === 'user' ? 'order-first' : ''}`}>
                      <Card className={message.role === 'user' 
                        ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white' 
                        : 'bg-white '}>
                        <CardContent className="p-4">
                          <p className="whitespace-pre-wrap">{message.content}</p>
                          
                          {message.metadata.agentName && (
                            <div className="mt-3 pt-3 border-t border-white/20 flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1">
                                <Zap className="w-3 h-3" />
                                {message.metadata.agentName}
                              </span>
                              {message.metadata.tokensUsed && (
                                <span>{message.metadata.tokensUsed} tokens</span>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                      
                      {message.role === 'assistant' && (
                        <div className="flex gap-1 mt-2">
                          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(message.content)} data-testid={`btn-copy-${index}`}>
                            <Copy className="w-3 h-3 mr-1" /> Copy
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => downloadResponse(message.content, `response-${index}.txt`)} data-testid={`btn-download-${index}`}>
                            <Download className="w-3 h-3 mr-1" /> Download
                          </Button>
                        </div>
                      )}
                    </div>
                    
                    {message.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))}
                
                {isLoading && (
                  <div className="flex gap-3 justify-start" data-testid="loading-indicator">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white animate-pulse">
                      <Bot className="w-4 h-4" />
                    </div>
                    <Card className="bg-white ">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                          <span className="text-sm text-muted-foreground">Processing with intelligent routing...</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="border-t bg-white p-4">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Switch id="workflow-mode" checked={useWorkflow} onCheckedChange={setUseWorkflow}  aria-label="Toggle setting"/>
                    <Label htmlFor="workflow-mode" className="text-sm flex items-center gap-1">
                      <Workflow className="w-4 h-4" /> Workflow Mode
                    </Label>
                  </div>
                  
                  <Separator orientation="vertical" className="h-6" />
                  
                  <Select value={promptStyle} onValueChange={setPromptStyle} aria-label="Select option">
                    <SelectTrigger className="w-[140px] h-8" data-testid="select-prompt-style">
                      <Wand2 className="w-3 h-3 mr-1" />
                      <SelectValue placeholder="Style" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="detailed">Detailed</SelectItem>
                      <SelectItem value="concise">Concise</SelectItem>
                      <SelectItem value="technical">Technical</SelectItem>
                      <SelectItem value="creative">Creative</SelectItem>
                      <SelectItem value="step_by_step">Step-by-Step</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {uploadedFiles.length > 0 && (
                    <Badge variant="secondary" className="flex items-center gap-1" role="status">
                      <FileText className="w-3 h-3" />
                      {uploadedFiles.length} file(s)
                    </Badge>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx,audio/*,video/*"
                    onChange={handleFileSelect}
                   aria-label="Upload file"/>
                  
                  <Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} data-testid="btn-upload">
                    <Upload className="w-4 h-4" />
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => setIsRecording(!isRecording)}
                    className={isRecording ? 'bg-red-100 text-red-600 border-red-300' : ''}
                    data-testid="btn-voice"
                  >
                    {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </Button>
                  
                  <Textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask anything... Upload documents, generate code, create content, or run complex workflows"
                    className="flex-1 min-h-[44px] max-h-[200px] resize-none"
                    data-testid="input-message"
                  />
                  
                  <Button 
                    onClick={handleSend} 
                    disabled={!inputValue.trim() || isLoading}
                    className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
                    data-testid="btn-send"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                  
                  <Button variant="outline" size="icon" onClick={restartSession} data-testid="btn-restart" aria-label="Action">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {workflowSteps.length > 0 && (
            <div className="w-80 border-l bg-white p-4 overflow-auto">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Workflow className="w-4 h-4" /> Workflow Progress
              </h3>
              <div className="space-y-3">
                {workflowSteps.map((step, index) => (
                  <div key={step.stepId} className="flex gap-3" data-testid={`workflow-step-${index}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      step.status === 'completed' ? 'bg-green-100 text-green-600' :
                      step.status === 'in_progress' ? 'bg-blue-100 text-blue-600 animate-pulse' :
                      step.status === 'failed' ? 'bg-red-100 text-red-600' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {step.status === 'completed' ? <Check className="w-4 h-4" /> :
                       step.status === 'in_progress' ? <Clock className="w-4 h-4" /> :
                       step.stepNumber}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{step.title}</p>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">Agent: {step.agentName}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showSettings && (
            <div className="w-80 border-l bg-white p-4 overflow-auto">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Settings className="w-4 h-4" /> Chat Settings
              </h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4" /> Voice Output
                  </Label>
                  <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled}  aria-label="Toggle setting"/>
                </div>
                
                <Separator />
                
                <div>
                  <Label className="text-sm font-medium mb-2 block">Context Engineering</Label>
                  <Textarea
                    placeholder="Add custom instructions for all responses..."
                    className="h-24 resize-none"
                    data-testid="input-custom-instructions"
                  />
                </div>
                
                <Separator />
                
                <div>
                  <Label className="text-sm font-medium mb-2 block">Features</Label>
                  <div className="space-y-2">
                    {[
                      { id: 'web-search', label: 'Web Search', icon: Globe },
                      { id: 'code-exec', label: 'Code Execution', icon: Code },
                      { id: 'doc-analysis', label: 'Document Analysis', icon: FileText }
                    ].map(feature => (
                      <div key={feature.id} className="flex items-center justify-between">
                        <Label className="flex items-center gap-2 text-sm">
                          <feature.icon className="w-4 h-4" /> {feature.label}
                        </Label>
                        <Switch defaultChecked  aria-label="Toggle setting"/>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
