import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { 
  Send, Upload, Mic, MicOff, Volume2, VolumeX, Copy, Download, 
  RotateCcw, Bot, User, Sparkles, Settings, FileText, Image, 
  Video, Music, Code, Workflow, ChevronRight, Check, Clock,
  Globe, Wand2, Zap, Brain, Target, Users, Building2, Briefcase,
  GraduationCap, Layers, Play, Pause, Save, History, Trash2,
  ChevronDown, Filter, Search, X, Plus, FileDown, FileSpreadsheet,
  Presentation, File, MessageSquare, Languages, Headphones, Network,
  FolderOpen, Star, BookOpen, Cpu, Shield, Lightbulb, MoreVertical
} from 'lucide-react';

interface ChatMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: Array<{
    type: 'image' | 'document' | 'audio' | 'video';
    name: string;
    url?: string;
    preview?: string;
  }>;
  metadata: {
    agentId?: string;
    agentName?: string;
    agentTier?: string;
    modelUsed?: string;
    tokensUsed?: number;
    processingTime?: number;
    language?: string;
  };
  timestamp: string;
}

interface ChatSession {
  sessionId: string;
  title: string;
  lastMessage: string;
  agentMode: string;
  createdAt: string;
  messageCount: number;
}

interface AgentGroup {
  id: string;
  name: string;
  description: string;
  agentCount: number;
  icon?: string;
}

interface AgentTeam {
  id: string;
  name: string;
  description: string;
  template: string;
  memberCount: number;
}

interface Agent {
  id: string;
  name: string;
  description: string;
  tier: string;
  capabilities: string[];
  status: string;
}

interface DomainCategory {
  id: string;
  name: string;
  description: string;
  agentCount: number;
  icon: string;
}

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' }
];

const DOMAIN_CATEGORIES: DomainCategory[] = [
  { id: 'finance', name: 'Finance & Banking', description: 'CFO, Financial Analysts, Compliance', agentCount: 12, icon: 'Building2' },
  { id: 'healthcare', name: 'Healthcare', description: 'Medical, Clinical, Compliance', agentCount: 8, icon: 'Shield' },
  { id: 'technology', name: 'Technology', description: 'Development, DevOps, Architecture', agentCount: 45, icon: 'Cpu' },
  { id: 'marketing', name: 'Marketing & Sales', description: 'CMO, Content, Lead Generation', agentCount: 15, icon: 'Target' },
  { id: 'education', name: 'Education', description: 'Learning, Curriculum, Assessment', agentCount: 10, icon: 'GraduationCap' },
  { id: 'legal', name: 'Legal & Compliance', description: 'Contract Review, GDPR, Audit', agentCount: 8, icon: 'BookOpen' },
  { id: 'hr', name: 'Human Resources', description: 'Recruitment, Training, Performance', agentCount: 7, icon: 'Users' },
  { id: 'research', name: 'Research & Analysis', description: 'Market Research, Data Science', agentCount: 12, icon: 'Lightbulb' }
];

const PROMPT_TEMPLATES = [
  { id: 'detailed', name: 'Detailed Analysis', description: 'Comprehensive, step-by-step response' },
  { id: 'concise', name: 'Concise Summary', description: 'Brief, to-the-point answer' },
  { id: 'technical', name: 'Technical Deep-Dive', description: 'Code and technical explanations' },
  { id: 'creative', name: 'Creative Content', description: 'Marketing, storytelling, ideas' },
  { id: 'research', name: 'Research Report', description: 'Cited sources and analysis' },
  { id: 'business', name: 'Business Document', description: 'Professional proposals and reports' }
];

export default function GlobalAgentChat() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [agentMode, setAgentMode] = useState<'all' | 'group' | 'team' | 'individual'>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');

  const [isRecording, setIsRecording] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState<string>('detailed');
  const [customInstructions, setCustomInstructions] = useState<string>('');

  const { data: agentGroups } = useQuery<{ success: boolean; data: AgentGroup[] }>({
    queryKey: ['/api/agentic-groups/groups'],
    refetchInterval: 60000
  });

  const { data: agentTeams } = useQuery<{ success: boolean; teams: AgentTeam[] }>({
    queryKey: ['/api/enterprise-orchestration/teams'],
    refetchInterval: 60000
  });

  const { data: agents } = useQuery<{ success: boolean; agents: Agent[] }>({
    queryKey: ['/api/agents/registry'],
    refetchInterval: 60000
  });

  const { data: chatHistory } = useQuery<{ success: boolean; sessions: ChatSession[] }>({
    queryKey: ['/api/chat/history'],
    enabled: showHistory
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentMode,
          agentGroupId: selectedGroup,
          agentTeamId: selectedTeam,
          agentId: selectedAgent,
          domainId: selectedDomain === 'all' ? '' : selectedDomain,
          language: selectedLanguage,
          promptTemplate
        })
      });
    },
    onSuccess: (data: any) => {
      setSessionId(data.data?.sessionId || `session-${Date.now()}`);
    }
  });

  const uploadedFilesRef = useRef<File[]>([]);
  useEffect(() => {
    uploadedFilesRef.current = uploadedFiles;
  }, [uploadedFiles]);

  const sendMessageMutation = useMutation({
    mutationFn: async (payload: { content: string; files: File[] }) => {
      const formData = new FormData();
      formData.append('content', payload.content);
      formData.append('agentMode', agentMode);
      formData.append('language', selectedLanguage);
      formData.append('promptTemplate', promptTemplate);
      if (customInstructions) formData.append('customInstructions', customInstructions);
      if (selectedGroup) formData.append('agentGroupId', selectedGroup);
      if (selectedTeam) formData.append('agentTeamId', selectedTeam);
      if (selectedAgent) formData.append('agentId', selectedAgent);
      if (selectedDomain && selectedDomain !== 'all') formData.append('domainId', selectedDomain);
      
      payload.files.forEach(file => formData.append('files', file));

      const response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Failed to send message');
      }
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.data) {
        if (data.data.assistantMessage) {
          setMessages(prev => [...prev, data.data.assistantMessage]);
        }
      }
      setUploadedFiles([]);
      setIsLoading(false);
      queryClient.invalidateQueries({ queryKey: ['/api/chat/history'] });
    },
    onError: (error: Error) => {
      setIsLoading(false);
      toast({ title: 'Failed to send message', description: error.message, variant: 'destructive' });
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

  const handleSend = () => {
    if (!inputValue.trim() || !sessionId) return;
    setIsLoading(true);
    
    const currentFiles = [...uploadedFiles];
    const userMessage: ChatMessage = {
      messageId: `msg-${Date.now()}`,
      role: 'user',
      content: inputValue,
      attachments: currentFiles.map(f => ({
        type: f.type.startsWith('image') ? 'image' : f.type.includes('audio') ? 'audio' : 'document',
        name: f.name
      })),
      metadata: {},
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);
    
    const messageContent = inputValue;
    setInputValue('');
    
    sendMessageMutation.mutate({ content: messageContent, files: currentFiles });
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
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const downloadAs = async (content: string, format: 'txt' | 'pdf' | 'docx' | 'md') => {
    let mimeType = 'text/plain';
    let formattedContent = content;
    
    switch (format) {
      case 'md':
        mimeType = 'text/markdown';
        formattedContent = `# AI Response\n\n${content}\n\n---\n*Generated by Jurexio Agent Chat*`;
        break;
      case 'txt':
        mimeType = 'text/plain';
        break;
      case 'pdf':
      case 'docx':
        try {
          const response = await fetch('/api/export/document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, format })
          });
          if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `response-${Date.now()}.${format}`;
            a.click();
            URL.revokeObjectURL(url);
            toast({ title: `Downloaded as ${format.toUpperCase()}` });
            return;
          }
        } catch (error) {
          console.warn('Server-side export failed, falling back to text');
        }
        mimeType = 'text/plain';
        formattedContent = content;
        break;
    }
    
    const blob = new Blob([formattedContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response-${Date.now()}.${format === 'md' ? 'md' : 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Downloaded as ${format.toUpperCase()}` });
  };

  const startNewChat = () => {
    setMessages([]);
    setSessionId(null);
    setUploadedFiles([]);
    createSessionMutation.mutate();
    toast({ title: 'New conversation started' });
  };

  const loadSession = async (session: ChatSession) => {
    try {
      const response = await fetch(`/api/chat/sessions/${session.sessionId}/messages`);
      if (response.ok) {
        const data = await response.json();
        if (data.data?.messages) {
          setMessages(data.data.messages);
        }
      }
      setSessionId(session.sessionId);
      setShowHistory(false);
      toast({ title: 'Session loaded', description: session.title });
    } catch (error) {
      toast({ title: 'Unable to retrieve session', variant: 'destructive' });
    }
  };

  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesisUtterance | null>(null);

  const startVoiceRecording = async () => {
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        toast({ title: 'Voice input not supported', description: 'Your browser does not support speech recognition', variant: 'destructive' });
        return;
      }
      
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = selectedLanguage === 'en' ? 'en-US' : selectedLanguage;
      
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputValue(prev => prev + ' ' + transcript);
        toast({ title: 'Voice captured', description: transcript.slice(0, 50) + '...' });
      };
      
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        toast({ title: 'Voice error', description: event.error, variant: 'destructive' });
      };
      
      recognition.onend = () => {
        setIsRecording(false);
      };
      
      recognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
      toast({ title: 'Listening...', description: 'Speak now' });
    } catch (error) {
      toast({ title: 'Microphone access denied', variant: 'destructive' });
    }
  };

  const stopVoiceRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  };

  const speakText = (text: string) => {
    if (!voiceOutputEnabled) return;
    
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = selectedLanguage === 'en' ? 'en-US' : selectedLanguage;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      synthesisRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }
  };

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant' && voiceOutputEnabled) {
      speakText(lastMessage.content);
    }
  }, [messages, voiceOutputEnabled]);

  const getModeIcon = () => {
    switch (agentMode) {
      case 'all': return <Brain className="w-5 h-5" />;
      case 'group': return <Layers className="w-5 h-5" />;
      case 'team': return <Users className="w-5 h-5" />;
      case 'individual': return <Bot className="w-5 h-5" />;
      default: return <Sparkles className="w-5 h-5" />;
    }
  };

  const getModeDescription = () => {
    switch (agentMode) {
      case 'all': return '164 Agents Orchestrated';
      case 'group': return agentGroups?.data?.find(g => g.id === selectedGroup)?.name || 'Select Group';
      case 'team': return agentTeams?.teams?.find(t => t.id === selectedTeam)?.name || 'Select Team';
      case 'individual': return agents?.agents?.find(a => a.id === selectedAgent)?.name || 'Select Agent';
      default: return 'All Agents';
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" data-testid="global-agent-chat">
      <div className="w-72 border-r border-slate-200/50 bg-white/80 backdrop-blur-xl flex flex-col">
        <div className="p-4 border-b border-slate-200/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-[#152448]">Jurexio Agent Chat</h1>
              <p className="text-xs text-slate-600">Global Orchestration</p>
            </div>
          </div>
          
          <Button 
            onClick={startNewChat}
            className="w-full bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
            data-testid="btn-new-chat"
          >
            <Plus className="w-4 h-4 mr-2" /> New Conversation
          </Button>
        </div>

        <div className="p-4 border-b border-slate-200/50">
          <Label className="text-xs text-slate-600 mb-2 block">AGENT MODE</Label>
          <Select value={agentMode} onValueChange={(v: any) => setAgentMode(v)}>
            <SelectTrigger className="bg-slate-100 border-slate-300" data-testid="select-agent-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-violet-400" />
                  <span>All 164 Agents (Orchestrated)</span>
                </div>
              </SelectItem>
              <SelectItem value="group">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  <span>Agentic Group</span>
                </div>
              </SelectItem>
              <SelectItem value="team">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-green-400" />
                  <span>Agent Team</span>
                </div>
              </SelectItem>
              <SelectItem value="individual">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-orange-400" />
                  <span>Individual Agent</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {agentMode === 'group' && (
            <Select value={selectedGroup} onValueChange={setSelectedGroup} aria-label="Select option">
              <SelectTrigger className="mt-2 bg-slate-100 border-slate-300" data-testid="select-agent-group">
                <SelectValue placeholder="Select Group" />
              </SelectTrigger>
              <SelectContent>
                {agentGroups?.data?.map(group => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name} ({group.agentCount} agents)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {agentMode === 'team' && (
            <Select value={selectedTeam} onValueChange={setSelectedTeam} aria-label="Select option">
              <SelectTrigger className="mt-2 bg-slate-100 border-slate-300" data-testid="select-agent-team">
                <SelectValue placeholder="Select Team" />
              </SelectTrigger>
              <SelectContent>
                {agentTeams?.teams?.map(team => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name} ({team.memberCount} members)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {agentMode === 'individual' && (
            <Select value={selectedAgent} onValueChange={setSelectedAgent} aria-label="Select option">
              <SelectTrigger className="mt-2 bg-slate-100 border-slate-300" data-testid="select-individual-agent">
                <SelectValue placeholder="Select Agent" />
              </SelectTrigger>
              <SelectContent>
                {agents?.agents?.slice(0, 50).map(agent => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]" role="status">{agent.tier}</Badge>
                      {agent.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="p-4 border-b border-slate-200/50">
          <Label className="text-xs text-slate-600 mb-2 block">DOMAIN / SME</Label>
          <Select value={selectedDomain} onValueChange={setSelectedDomain} aria-label="Select option">
            <SelectTrigger className="bg-slate-100 border-slate-300" data-testid="select-domain">
              <SelectValue placeholder="All Domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Domains</SelectItem>
              {DOMAIN_CATEGORIES.map(domain => (
                <SelectItem key={domain.id} value={domain.id}>
                  {domain.name} ({domain.agentCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="p-4 border-b border-slate-200/50">
          <Label className="text-xs text-slate-600 mb-2 block">LANGUAGE</Label>
          <Select value={selectedLanguage} onValueChange={setSelectedLanguage} aria-label="Select option">
            <SelectTrigger className="bg-slate-100 border-slate-300" data-testid="select-language">
              <Globe className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map(lang => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.native} ({lang.name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="flex-1 p-4" aria-label="Scrollable content">
          <div className="flex items-center justify-between mb-3">
            <Label className="text-xs text-slate-600">CHAT HISTORY</Label>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>
              <History className="w-4 h-4" />
            </Button>
          </div>
          
          {chatHistory?.sessions?.map(session => (
            <Card 
              key={session.sessionId}
              className="mb-2 bg-slate-100/50 border-slate-200 cursor-pointer hover:bg-slate-200/50"
              onClick={() => loadSession(session)}
              data-testid={`history-session-${session.sessionId}`}
            >
              <CardContent className="p-3">
                <p className="text-sm text-[#152448] font-medium truncate">{session.title}</p>
                <p className="text-xs text-slate-600 truncate">{session.lastMessage}</p>
                <div className="flex items-center justify-between mt-2">
                  <Badge variant="outline" className="text-[10px]" role="status">{session.agentMode}</Badge>
                  <span className="text-[10px] text-slate-700">{session.messageCount} msgs</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col">
        <header className="border-b border-slate-200/50 bg-white/50 backdrop-blur-sm p-4" role="banner" aria-label="Page header">
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/30">
                {getModeIcon()}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#152448]">{getModeDescription()}</h2>
                <p className="text-xs text-slate-600">
                  {selectedLanguage && SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage)?.name} • 
                  {selectedDomain && selectedDomain !== 'all' ? ` ${DOMAIN_CATEGORIES.find(d => d.id === selectedDomain)?.name}` : ' All Domains'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setVoiceOutputEnabled(!voiceOutputEnabled)}
                className={voiceOutputEnabled ? 'bg-violet-500/20 border-violet-500' : ''}
                data-testid="btn-voice-output"
              >
                {voiceOutputEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </Button>
              
              <Dialog>
                <DialogTrigger asChild aria-label="Open dialog">
                  <Button variant="outline" size="sm" data-testid="btn-settings">
                    <Settings className="w-4 h-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-white border-slate-200">
                  <DialogHeader>
                    <DialogTitle className="text-[#152448]">Chat Settings</DialogTitle>
                    <DialogDescription>Configure prompts, templates, and output preferences</DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4 mt-4">
                    <div>
                      <Label className="text-[#152448]">Prompt Template</Label>
                      <Select value={promptTemplate} onValueChange={setPromptTemplate} aria-label="Select option">
                        <SelectTrigger className="mt-2 bg-slate-100 border-slate-300">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROMPT_TEMPLATES.map(t => (
                            <SelectItem key={t.id} value={t.id}>
                              <div>
                                <span className="font-medium">{t.name}</span>
                                <span className="text-xs text-slate-600 ml-2">{t.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label className="text-[#152448]">Custom Instructions</Label>
                      <Textarea
                        value={customInstructions}
                        onChange={(e) => setCustomInstructions(e.target.value)}
                        placeholder="Add specific instructions for all responses..."
                        className="mt-2 bg-slate-100 border-slate-300 h-24"
                        data-testid="input-custom-instructions"
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <Label className="text-[#152448]">Voice Output</Label>
                      <Switch checked={voiceOutputEnabled} onCheckedChange={setVoiceOutputEnabled}  aria-label="Toggle setting"/>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </header>

        <ScrollArea className="flex-1 p-4" aria-label="Scrollable content">
          <div className="max-w-4xl mx-auto space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-16">
                <div className="inline-flex p-6 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/30 mb-6">
                  <Brain className="w-16 h-16 text-violet-400" />
                </div>
                <h2 className="text-2xl font-bold text-[#152448] mb-3">Welcome to Jurexio Global Agent Chat</h2>
                <p className="text-slate-600 mb-8 max-w-lg mx-auto">
                  Choose your agent mode, upload documents, and chat with 164 autonomous agents 
                  across all domains. Supports 23 languages with voice I/O.
                </p>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto mb-8">
                  {[
                    { icon: Code, label: 'Code & Dev', color: 'text-blue-400', bg: 'bg-blue-500/10' },
                    { icon: FileText, label: 'Documents', color: 'text-green-400', bg: 'bg-green-500/10' },
                    { icon: Target, label: 'Research', color: 'text-orange-400', bg: 'bg-orange-500/10' },
                    { icon: Building2, label: 'Business', color: 'text-purple-400', bg: 'bg-purple-500/10' }
                  ].map((item, i) => (
                    <Card key={i} className="bg-slate-100/50 border-slate-200 cursor-pointer hover:border-violet-500/50" data-testid={`quick-action-${i}`}>
                      <CardContent className="p-4 text-center">
                        <div className={`inline-flex p-3 rounded-xl ${item.bg} mb-2`}>
                          <item.icon className={`w-6 h-6 ${item.color}`} />
                        </div>
                        <p className="text-sm text-[#152448] font-medium">{item.label}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex flex-wrap justify-center gap-2">
                  {['Analyze my document', 'Write code for...', 'Research about...', 'Create a business plan'].map((prompt, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="border-slate-300 text-slate-700 hover:bg-slate-200"
                      onClick={() => setInputValue(prompt)}
                      data-testid={`suggested-prompt-${i}`}
                    >
                      {prompt}
                    </Button>
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
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
                    <Bot className="w-5 h-5" />
                  </div>
                )}
                
                <div className={`max-w-[75%] ${message.role === 'user' ? 'order-first' : ''}`}>
                  <Card className={message.role === 'user' 
                    ? 'bg-gradient-to-br from-violet-500 to-purple-600 border-0' 
                    : 'bg-slate-100 border-slate-200'}>
                    <CardContent className="p-4">
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {message.attachments.map((att, i) => (
                            <Badge key={i} variant="secondary" className="flex items-center gap-1" role="status">
                              {att.type === 'image' && <Image className="w-3 h-3" />}
                              {att.type === 'document' && <FileText className="w-3 h-3" />}
                              {att.type === 'audio' && <Headphones className="w-3 h-3" />}
                              {att.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                      
                      <p className={`whitespace-pre-wrap ${message.role === 'user' ? 'text-white' : 'text-slate-800'}`}>
                        {message.content}
                      </p>
                      
                      {message.metadata.agentName && (
                        <div className="mt-3 pt-3 border-t border-slate-200/50 flex items-center justify-between text-xs text-slate-600">
                          <span className="flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {message.metadata.agentName}
                            {message.metadata.agentTier && (
                              <Badge variant="outline" className="ml-1 text-[10px]" role="status">{message.metadata.agentTier}</Badge>
                            )}
                          </span>
                          <span className="flex items-center gap-2">
                            {message.metadata.tokensUsed && <span>{message.metadata.tokensUsed} tokens</span>}
                            {message.metadata.processingTime && <span>{message.metadata.processingTime}ms</span>}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  
                  {message.role === 'assistant' && (
                    <div className="flex gap-1 mt-2">
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(message.content)} data-testid={`btn-copy-${index}`}>
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" data-testid={`btn-download-${index}`}>
                            <Download className="w-3 h-3 mr-1" /> Export
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => downloadAs(message.content, 'txt')}>
                            <FileText className="w-4 h-4 mr-2" /> Text (.txt)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadAs(message.content, 'md')}>
                            <Code className="w-4 h-4 mr-2" /> Markdown (.md)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => downloadAs(message.content, 'pdf')}>
                            <File className="w-4 h-4 mr-2" /> PDF Document
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadAs(message.content, 'docx')}>
                            <FileText className="w-4 h-4 mr-2" /> Word Document
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      
                      <Button variant="ghost" size="sm" onClick={() => setInputValue(`Expand on: ${message.content.slice(0, 50)}...`)} data-testid={`btn-reprompt-${index}`}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Re-prompt
                      </Button>
                    </div>
                  )}
                </div>
                
                {message.role === 'user' && (
                  <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-slate-700" />
                  </div>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="flex gap-3 justify-start" data-testid="loading-indicator">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center animate-pulse">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <Card className="bg-slate-100 border-slate-200">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-slate-600">
                        {agentMode === 'all' ? 'Orchestrating 164 agents...' : 'Processing with selected agents...'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <div className="border-t border-slate-200/50 bg-white/80 backdrop-blur-sm p-4">
          <div className="max-w-4xl mx-auto">
            {uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 p-3 bg-slate-100/50 rounded-lg">
                {uploadedFiles.map((file, i) => (
                  <Badge key={i} variant="secondary" className="flex items-center gap-2 py-1" role="status">
                    {file.type.startsWith('image') ? <Image className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                    {file.name}
                    <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={() => removeFile(i)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
            
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="flex items-center gap-1" role="status">
                {getModeIcon()}
                <span className="text-xs">{getModeDescription()}</span>
              </Badge>
              
              <Separator orientation="vertical" className="h-5" />
              
              <Select value={promptTemplate} onValueChange={setPromptTemplate} aria-label="Select option">
                <SelectTrigger className="w-[160px] h-8 bg-slate-100 border-slate-300" data-testid="select-prompt-template">
                  <Wand2 className="w-3 h-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_TEMPLATES.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx,.pptx,audio/*,video/*"
                onChange={handleFileSelect}
               aria-label="Upload file"/>
              
              <Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} data-testid="btn-upload">
                <Upload className="w-4 h-4" />
              </Button>
              
              <Button 
                variant="outline" 
                size="icon"
                onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                className={isRecording ? 'bg-red-500/20 border-red-500 text-red-400' : ''}
                data-testid="btn-voice-input"
               aria-label="Action">
                {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
              
              <Textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask anything... Upload documents, images, or use voice input"
                className="flex-1 min-h-[44px] max-h-[200px] resize-none bg-slate-100 border-slate-300"
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
            </div>
            
            <p className="text-xs text-slate-700 mt-2 text-center">
              164 Agents • 23 Languages • Voice I/O • Multimodal Support • Export to PDF/DOCX/XLSX
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
