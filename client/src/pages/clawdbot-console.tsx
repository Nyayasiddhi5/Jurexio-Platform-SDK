import { getAuthToken } from '@/lib/jrx-auth-token';
import { p, NV_API } from '@/lib/jrx-api-paths';
import { JrxEmptyState } from '@/components/JrxEmptyState';
/**
 * ClaWdBot™ Console — Legal Chatbot Builder
 * Jurexio Enterprise Platform 312 | Admin Interface
 *
 * Features:
 *   - No-code bot configuration with channel setup
 *   - Live test harness (chat preview in-page)
 *   - HITL escalation config
 *   - WhatsApp / Web / API channel management
 *   - Bot analytics and conversation history
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot, Plus, Settings, Play, Pause, Trash2, MessageSquare, Send,
  Phone, Globe, Code, Mail, Zap, Users, BarChart3, CheckCircle,
  XCircle, Clock, AlertTriangle, ChevronRight, RefreshCw, Copy,
  Shield, Activity, Loader2, Eye, EyeOff
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { JrxGovernanceBadge } from '@/components/JrxGovernanceBadge';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface BotConfig {
  botId: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  channels: string[];
  jurisdiction: string;
  legalDomains: string[];
  language: string;
  persona: { greeting: string; tone: string };
  hitlConfig: { enabled: boolean; maxAutoReplies: number; escalationMessage: string };
  stats: { totalConversations: number; totalMessages: number; escalations: number; avgResponseMs: number };
  createdAt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'bot' | 'system';
  content: string;
  timestamp: string;
  intent?: string;
  escalated?: boolean;
  latencyMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <Phone className="h-4 w-4 text-green-400" />,
  web:      <Globe className="h-4 w-4 text-blue-400" />,
  api:      <Code className="h-4 w-4 text-purple-400" />,
  telegram: <MessageSquare className="h-4 w-4 text-sky-400" />,
  email:    <Mail className="h-4 w-4 text-orange-400" />,
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  draft:  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  paused: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  archived: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ClaWdBotConsole() {
  const { toast } = useToast();
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [selectedBot, setSelectedBot] = useState<BotConfig | null>(null);
  const [activeTab, setActiveTab] = useState('bots');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBotName, setNewBotName] = useState('');
  const [newBotJurisdiction, setNewBotJurisdiction] = useState('IN');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [testConvId, setTestConvId] = useState<string | undefined>();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const botsQuery = useQuery<{ success: boolean; bots: BotConfig[]; error?: string }>({
    queryKey: [p('CLAWDBOT_BOTS')],
  });
  const botsLoading = botsQuery.isLoading;
  const botsError = botsQuery.error
    ? (botsQuery.error as Error).message
    : (botsQuery.data && botsQuery.data.success === false ? (botsQuery.data.error ?? 'Unexpected response') : null);

  useEffect(() => {
    if (botsQuery.data?.success && Array.isArray(botsQuery.data.bots)) {
      setBots(botsQuery.data.bots);
      setSelectedBot((cur) => cur ?? botsQuery.data!.bots[0] ?? null);
    }
  }, [botsQuery.data]);

  const sendTestMessage = useCallback(async () => {
    if (!chatInput.trim() || !selectedBot) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: chatInput,
      timestamp: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    const sentText = chatInput;
    setChatInput('');
    setChatLoading(true);

    try {
      const token = getAuthToken();
      const res = await fetch(`${NV_API.CLAWDBOT.path}/bots/${selectedBot.botId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: sentText, conversationId: testConvId, channel: 'web' }),
      });
      const data: { success: boolean; conversationId?: string; botReply?: string; intent?: string; escalated?: boolean; latencyMs?: number; error?: string } = await res.json();
      if (data.success) {
        setTestConvId(data.conversationId);
        setChatMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'bot',
          content: data.botReply!,
          timestamp: new Date().toISOString(),
          intent: data.intent,
          escalated: data.escalated,
          latencyMs: data.latencyMs,
        }]);
      } else {
        throw new Error(data.error ?? 'Chat failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Backend pending';
      toast({ title: 'Chat failed', description: `Error: ${msg}`, variant: 'destructive' });
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, selectedBot, testConvId, toast]);

  const createBot = async () => {
    if (!newBotName.trim()) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${NV_API.CLAWDBOT.path}/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: newBotName, jurisdiction: newBotJurisdiction }),
      });
      const data: { success: boolean; bot: BotConfig; error?: string } = await res.json();
      if (data.success) {
        setBots((prev) => [...prev, data.bot]);
        setShowCreateForm(false);
        setNewBotName('');
        toast({ title: 'Bot created', description: `"${data.bot.name}" is in draft mode.` });
      } else {
        throw new Error(data.error ?? 'Bot creation failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Backend unavailable';
      toast({ title: 'Bot creation failed', description: msg, variant: 'destructive' });
    }
  };

  const toggleBotStatus = async (bot: BotConfig) => {
    const action = bot.status === 'active' ? 'pause' : 'activate';
    try {
      const token = getAuthToken();
      const res = await fetch(`${NV_API.CLAWDBOT.path}/bots/${bot.botId}/${action}`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      setBots((prev) => prev.map((b) =>
        b.botId === bot.botId ? { ...b, status: action === 'activate' ? 'active' : 'paused' } : b
      ));
      if (selectedBot?.botId === bot.botId) {
        setSelectedBot((prev) => prev ? { ...prev, status: action === 'activate' ? 'active' : 'paused' } : prev);
      }
      toast({ title: action === 'activate' ? 'Bot activated' : 'Bot paused' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      toast({ title: 'Status change failed', description: msg, variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Bot className="h-5 w-5 text-slate-900" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">ClaWdBot™ Console</h1>
              <p className="text-xs text-slate-700">Legal Chatbot Builder — Jurexio Enterprise Platform 312</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-green-500/30 text-green-400 text-xs" role="status">
              {bots.filter((b) => b.status === 'active').length} Active
            </Badge>
            <JrxGovernanceBadge compact governance={{ risk_score: 30, risk_badge: 'YELLOW', risk_blocked: false, pattern_key: 'CLAWDBOT', warnings: ['AI Legal Chatbot — Not a substitute for professional legal advice'], timestamp: new Date().toISOString() }} />
            <Button size="sm" onClick={() => setShowCreateForm(true)}
              className="bg-green-600 hover:bg-green-700 text-slate-50 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1.5" /> New Bot
            </Button>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left: Bot List */}
        <div className="w-72 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-200">
            <p className="text-xs font-medium text-slate-700 uppercase tracking-wider px-1 mb-2">Chatbots ({bots.length})</p>
          </div>
          <ScrollArea className="flex-1" aria-label="Scrollable content">
            <div className="p-2 space-y-1">
              {botsLoading ? (
                <div className="p-4 space-y-2" data-testid="bots-loading">
                  {[0,1,2].map((i) => (
                    <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                  ))}
                </div>
              ) : botsError ? (
                <div className="p-6 text-center text-xs text-red-500" data-testid="bots-error">
                  <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-60" />
                  <p>Could not load bots</p>
                  <p className="text-slate-600 mt-1">{botsError}</p>
                </div>
              ) : bots.length === 0 ? (
                <div className="p-4 h-full flex items-center justify-center" data-testid="bots-empty">
                  <JrxEmptyState
                    size="sm"
                    icon={Bot}
                    title="No bots yet"
                    description="Create your first ClaWdBot to handle WhatsApp, web and API conversations."
                    cta={{ label: 'Create First Bot', onClick: () => setShowCreateForm(true) }}
                  />
                </div>
              ) : bots.map((bot) => (
                <button
                  key={bot.botId}
                  onClick={() => { setSelectedBot(bot); setChatMessages([]); setTestConvId(undefined); }}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    selectedBot?.botId === bot.botId
                      ? 'bg-green-500/10 border border-green-500/20'
                      : 'hover:bg-white border border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{bot.name}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{bot.jurisdiction} · {bot.channels.length} channel{bot.channels.length > 1 ? 's' : ''}</p>
                    </div>
                    <Badge className={`text-xs border ${STATUS_COLORS[bot.status]} shrink-0`}>
                      {bot.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {bot.channels.map((ch) => (
                      <span key={ch} title={ch}>{CHANNEL_ICONS[ch]}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedBot ? (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
              <div className="border-b border-slate-200 bg-white px-4">
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">{selectedBot.name}</h2>
                    <Badge className={`text-xs border ${STATUS_COLORS[selectedBot.status]}`}>
                      {selectedBot.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline"
                      className="border-slate-200 text-slate-600 hover:bg-white text-xs h-7"
                      onClick={() => toggleBotStatus(selectedBot)}>
                      {selectedBot.status === 'active'
                        ? <><Pause className="h-3 w-3 mr-1" />Pause</>
                        : <><Play className="h-3 w-3 mr-1" />Activate</>}
                    </Button>
                  </div>
                </div>
                <TabsList className="bg-transparent border-0 p-0 h-8 gap-1" aria-label="Navigation tabs">
                  {[
                    { id: 'test', label: 'Test Chat', icon: <MessageSquare className="h-3.5 w-3.5" /> },
                    { id: 'config', label: 'Configuration', icon: <Settings className="h-3.5 w-3.5" /> },
                    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-3.5 w-3.5" /> },
                    { id: 'channels', label: 'Channels', icon: <Zap className="h-3.5 w-3.5" /> },
                  ].map((t) => (
                    <TabsTrigger key={t.id} value={t.id}
                      className="text-xs h-8 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 text-slate-700 rounded-md flex items-center gap-1.5 px-3">
                      {t.icon}{t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              {/* Test Chat */}
              <TabsContent value="test" className="flex-1 flex flex-col m-0 overflow-hidden">
                <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3">
                  <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Test harness — messages are sent to the live bot endpoint. Bot must be <strong>active</strong> to respond.
                  </div>
                  <ScrollArea className="flex-1 bg-slate-100 rounded-lg border border-slate-200 p-4" aria-label="Scrollable content">
                    {chatMessages.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                        <div className="text-center">
                          <Bot className="h-10 w-10 mx-auto mb-3 opacity-30" />
                          <p>Start a test conversation</p>
                          <p className="text-xs mt-1">"{selectedBot.persona.greeting}"</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {chatMessages.map((msg) => (
                          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${
                              msg.role === 'user'
                                ? 'bg-green-600 text-slate-50'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}>
                              <p>{msg.content}</p>
                              <div className="flex items-center gap-2 mt-1">
                                {msg.intent && <span className="text-xs opacity-50">{msg.intent}</span>}
                                {msg.latencyMs && <span className="text-xs opacity-50">{msg.latencyMs}ms</span>}
                                {msg.escalated && <Badge className="text-xs bg-orange-500/20 text-orange-400 border-orange-500/30">Escalated</Badge>}
                              </div>
                            </div>
                          </div>
                        ))}
                        {chatLoading && (
                          <div className="flex justify-start">
                            <div className="bg-slate-100 rounded-xl px-4 py-3 border border-slate-200">
                              <Loader2 className="h-4 w-4 animate-spin text-slate-700" />
                            </div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                  <div className="flex items-center gap-2">
                    <Input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendTestMessage()}
                      placeholder={`Message ${selectedBot.name}...`}
                      className="bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600 text-sm"
                    />
                    <Button onClick={sendTestMessage} disabled={chatLoading || !chatInput.trim()}
                      className="bg-green-600 hover:bg-green-700 shrink-0">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Configuration */}
              <TabsContent value="config" className="flex-1 m-0 overflow-auto p-4">
                <div className="max-w-2xl space-y-6">
                  <Card className="bg-white border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-slate-900">Bot Identity</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-slate-600">Bot ID</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <code className="text-xs bg-slate-100 px-2 py-1 rounded text-green-400">{selectedBot.botId}</code>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                              onClick={() => { navigator.clipboard.writeText(selectedBot.botId); toast({ title: 'Copied' }); }}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-600">Jurisdiction</Label>
                          <p className="text-sm mt-1 font-medium">{selectedBot.jurisdiction}</p>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-slate-600">Legal Domains</Label>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {selectedBot.legalDomains.map((d) => (
                            <Badge key={d} variant="outline" className="border-slate-200 text-slate-600 text-xs" role="status">{d}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-slate-600">Greeting Message</Label>
                        <p className="text-sm mt-1 text-slate-700 italic">"{selectedBot.persona.greeting}"</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-slate-900 flex items-center gap-2">
                        <Users className="h-4 w-4 text-orange-400" /> HITL Configuration
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm">Human-in-the-Loop Escalation</p>
                          <p className="text-xs text-slate-700">Route to live advocate when triggered</p>
                        </div>
                        <div className={`h-5 w-9 rounded-full ${selectedBot.hitlConfig.enabled ? 'bg-green-500' : 'bg-slate-200'}`} />
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <div>
                          <Label className="text-xs text-slate-600">Max Auto-Replies</Label>
                          <p className="text-sm mt-1 font-medium">{selectedBot.hitlConfig.maxAutoReplies}</p>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-600">Escalation Message</Label>
                          <p className="text-xs mt-1 text-slate-600 italic">"{selectedBot.hitlConfig.escalationMessage}"</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Analytics */}
              <TabsContent value="analytics" className="flex-1 m-0 overflow-auto p-4">
                <div className="grid grid-cols-4 gap-4 mb-6">
                  {[
                    { label: 'Conversations', value: selectedBot.stats.totalConversations.toLocaleString(), icon: <MessageSquare className="h-5 w-5 text-blue-400" />, color: 'blue' },
                    { label: 'Messages', value: selectedBot.stats.totalMessages.toLocaleString(), icon: <Activity className="h-5 w-5 text-green-400" />, color: 'green' },
                    { label: 'Escalations', value: selectedBot.stats.escalations.toLocaleString(), icon: <Users className="h-5 w-5 text-orange-400" />, color: 'orange' },
                    { label: 'Avg Response', value: `${selectedBot.stats.avgResponseMs}ms`, icon: <Clock className="h-5 w-5 text-purple-400" />, color: 'purple' },
                  ].map((stat) => (
                    <Card key={stat.label} className="bg-white border-slate-200">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">{stat.icon}<p className="text-xs text-slate-700">{stat.label}</p></div>
                        <p className="text-2xl font-bold">{stat.value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-slate-900">Escalation Rate</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedBot.stats.totalConversations > 0 ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">HITL Escalations</span>
                          <span className="font-medium text-orange-400">
                            {Math.round((selectedBot.stats.escalations / selectedBot.stats.totalConversations) * 100)}%
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full">
                          <div
                            className="h-2 bg-gradient-to-r from-orange-500 to-orange-400 rounded-full"
                            style={{ width: `${Math.round((selectedBot.stats.escalations / selectedBot.stats.totalConversations) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600">No conversations yet</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Channels */}
              <TabsContent value="channels" className="flex-1 m-0 overflow-auto p-4">
                <div className="grid grid-cols-2 gap-4 max-w-2xl">
                  {(['whatsapp', 'web', 'api', 'telegram', 'email'] as const).map((ch) => {
                    const isActive = selectedBot.channels.includes(ch);
                    return (
                      <Card key={ch} className={`border ${isActive ? 'border-green-500/30 bg-green-500/5' : 'border-slate-200 bg-white'}`}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {CHANNEL_ICONS[ch]}
                              <div>
                                <p className="text-sm font-medium capitalize">{ch}</p>
                                <p className="text-xs text-slate-600">
                                  {ch === 'whatsapp' ? 'Business API required' :
                                   ch === 'telegram' ? 'Bot token required' :
                                   ch === 'email' ? 'SMTP credentials required' : 'Ready'}
                                </p>
                              </div>
                            </div>
                            {isActive
                              ? <CheckCircle className="h-4 w-4 text-green-400" />
                              : <XCircle className="h-4 w-4 text-slate-300" />}
                          </div>
                          {isActive && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                                <span className="text-xs text-green-400">Connected</span>
                              </div>
                              {ch === 'whatsapp' && (
                                <code className="block mt-2 text-xs bg-slate-100 px-2 py-1 rounded text-purple-400">
                                  POST /api/jrx/clawdbot/webhooks/whatsapp/{selectedBot.botId}
                                </code>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-600">
              <div className="text-center">
                <Bot className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p>Select a bot to configure</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Bot Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="bg-white border-slate-200 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-slate-900">Create New Bot</CardTitle>
              <CardDescription className="text-slate-700">Configure your ClaWdBot™ legal chatbot</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-slate-600 text-sm">Bot Name *</Label>
                <Input value={newBotName} onChange={(e) => setNewBotName(e.target.value)}
                  placeholder="e.g. Jurexio Citizen Intake Bot"
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600" />
              </div>
              <div>
                <Label className="text-slate-600 text-sm">Jurisdiction</Label>
                <Select value={newBotJurisdiction} onValueChange={setNewBotJurisdiction} aria-label="Select option">
                  <SelectTrigger className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    {[['IN', 'India']].map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-slate-900 hover:bg-slate-100">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <div className="flex gap-3 px-6 pb-6">
              <Button variant="outline" className="flex-1 border-slate-200 text-slate-600 hover:bg-white"
                onClick={() => setShowCreateForm(false)}>Cancel</Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700 text-slate-50" onClick={createBot}>
                Create Bot
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
