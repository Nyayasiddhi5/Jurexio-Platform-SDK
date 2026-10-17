import { getAuthToken } from '@/lib/jrx-auth-token';
import { p, NV_API } from '@/lib/jrx-api-paths';
import { NyvEmptyState } from '@/components/NyvEmptyState';
/**
 * OpenBot™ Studio — Multi-Channel Bot Management Studio
 * Jurexio Enterprise Platform 312 | Channel Operations
 *
 * Features:
 *   - Multi-channel configuration (WhatsApp, Slack, Teams, Telegram, Email)
 *   - Unified message inbox across all channels
 *   - Bot routing rule builder
 *   - Channel health monitoring
 *   - Live message feed
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Radio, Plus, Settings, Globe, MessageSquare, Mail, Zap,
  Phone, Monitor, Activity, ArrowRight, CheckCircle, XCircle,
  Loader2, RefreshCw, Eye, Filter, BarChart3, Clock,
  AlertCircle, ChevronRight, Send, Users, Layers, Inbox, AlertTriangle
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { NyvGovernanceBadge } from '@/components/NyvGovernanceBadge';

type ChannelType = 'whatsapp' | 'slack' | 'teams' | 'telegram' | 'email' | 'web' | 'api';

interface Channel {
  channelId: string;
  channel: ChannelType;
  name: string;
  status: 'active' | 'paused' | 'error';
  botIds: string[];
  isVerified: boolean;
  createdAt: string;
  webhookUrl?: string;
}

interface InboxMessage {
  messageId: string;
  channel: ChannelType;
  from: string;
  content: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  status: string;
}

interface RoutingRule {
  ruleId: string;
  name: string;
  priority: number;
  conditions: { channels?: string[]; keywords?: string[] };
  targetBotId: string;
  isActive: boolean;
}

const CHANNEL_META: Record<ChannelType, { icon: React.ReactNode; color: string; label: string; description: string }> = {
  whatsapp: { icon: <Phone className="h-5 w-5" />, color: 'text-green-400', label: 'WhatsApp', description: 'WhatsApp Business API' },
  slack:    { icon: <MessageSquare className="h-5 w-5" />, color: 'text-yellow-400', label: 'Slack', description: 'Slack Bot (OAuth)' },
  teams:    { icon: <Monitor className="h-5 w-5" />, color: 'text-blue-400', label: 'MS Teams', description: 'Teams Bot Framework' },
  telegram: { icon: <Radio className="h-5 w-5" />, color: 'text-sky-400', label: 'Telegram', description: 'Telegram Bot API' },
  email:    { icon: <Mail className="h-5 w-5" />, color: 'text-orange-400', label: 'Email', description: 'SMTP / SendGrid' },
  web:      { icon: <Globe className="h-5 w-5" />, color: 'text-purple-400', label: 'Web Widget', description: 'Embeddable web chat' },
  api:      { icon: <Zap className="h-5 w-5" />, color: 'text-pink-400', label: 'REST API', description: 'Direct API integration' },
};

function formatTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export default function OpenBotStudio() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);

  const channelsQuery = useQuery<{ success: boolean; channels: Channel[]; error?: string }>({
    queryKey: [p('OPENBOT_CHANNELS')],
  });
  const inboxQuery = useQuery<{ success: boolean; messages: InboxMessage[]; error?: string }>({
    queryKey: [p('OPENBOT_INBOX')],
  });
  const rulesQuery = useQuery<{ success: boolean; rules: RoutingRule[]; error?: string }>({
    queryKey: [p('OPENBOT_RULES')],
  });
  const channelsLoading = channelsQuery.isLoading;
  const inboxLoading = inboxQuery.isLoading;
  const channelsError = channelsQuery.error
    ? (channelsQuery.error as Error).message
    : (channelsQuery.data && channelsQuery.data.success === false ? (channelsQuery.data.error ?? 'Unexpected response') : null);
  const inboxError = inboxQuery.error
    ? (inboxQuery.error as Error).message
    : (inboxQuery.data && inboxQuery.data.success === false ? (inboxQuery.data.error ?? 'Unexpected response') : null);

  useEffect(() => {
    if (channelsQuery.data?.success && Array.isArray(channelsQuery.data.channels)) {
      setChannels(channelsQuery.data.channels);
    }
  }, [channelsQuery.data]);
  useEffect(() => {
    if (inboxQuery.data?.success && Array.isArray(inboxQuery.data.messages)) {
      setMessages(inboxQuery.data.messages);
    }
  }, [inboxQuery.data]);
  useEffect(() => {
    if (rulesQuery.data?.success && Array.isArray(rulesQuery.data.rules)) {
      setRules(rulesQuery.data.rules);
    }
  }, [rulesQuery.data]);
  const [activeTab, setActiveTab] = useState('channels');
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelType, setNewChannelType] = useState<ChannelType>('whatsapp');
  const [newChannelName, setNewChannelName] = useState('');
  const [inboxFilter, setInboxFilter] = useState<ChannelType | 'all'>('all');
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sendDest, setSendDest] = useState('');
  const [sendBody, setSendBody] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [rulePriority, setRulePriority] = useState(50);
  const [ruleChannels, setRuleChannels] = useState<ChannelType[]>([]);
  const [ruleKeywords, setRuleKeywords] = useState('');
  const [ruleTargetBot, setRuleTargetBot] = useState('');
  const [ruleIsActive, setRuleIsActive] = useState(true);
  const [ruleBusy, setRuleBusy] = useState(false);

  const openAddRule = useCallback(() => {
    setRuleName('');
    setRulePriority(50);
    setRuleChannels([]);
    setRuleKeywords('');
    setRuleTargetBot('');
    setRuleIsActive(true);
    setShowAddRule(true);
  }, []);

  const toggleRuleChannel = (c: ChannelType) => {
    setRuleChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const submitRule = useCallback(async () => {
    if (!ruleName.trim() || !ruleTargetBot.trim()) return;
    setRuleBusy(true);
    try {
      const token = getAuthToken();
      const keywords = ruleKeywords.split(',').map((k) => k.trim()).filter(Boolean);
      const conditions: { channels?: ChannelType[]; keywords?: string[] } = {};
      if (ruleChannels.length > 0) conditions.channels = ruleChannels;
      if (keywords.length > 0) conditions.keywords = keywords;
      const body = {
        name: ruleName.trim(),
        priority: Number.isFinite(rulePriority) ? rulePriority : 50,
        targetBotId: ruleTargetBot.trim(),
        isActive: ruleIsActive,
        ...(Object.keys(conditions).length > 0 ? { conditions } : {}),
      };
      const res = await fetch(p('OPENBOT_RULES'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        let msg: string;
        if (typeof data.error === 'string') {
          msg = data.error;
        } else if (Array.isArray(data.error)) {
          msg = data.error
            .map((e: unknown) =>
              typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
                ? (e as { message: string }).message
                : String(e),
            )
            .join(', ');
        } else {
          msg = `HTTP ${res.status}`;
        }
        toast({ title: 'Add routing rule failed', description: msg, variant: 'destructive' });
        return;
      }
      toast({ title: 'Routing rule added', description: `${body.name} is now ${ruleIsActive ? 'active' : 'inactive'}.` });
      setShowAddRule(false);
      await queryClient.invalidateQueries({ queryKey: [p('OPENBOT_RULES')] });
    } catch (err: unknown) {
      toast({ title: 'Add routing rule failed', description: err instanceof Error ? err.message : 'Network error', variant: 'destructive' });
    } finally {
      setRuleBusy(false);
    }
  }, [ruleName, rulePriority, ruleChannels, ruleKeywords, ruleTargetBot, ruleIsActive, queryClient, toast]);

  const refreshInbox = useCallback(async () => {
    try {
      const token = getAuthToken();
      const res = await fetch(p('OPENBOT_INBOX'), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        setInboxError(`Backend returned ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        setMessages(data.messages);
        setInboxError(null);
      }
    } catch (err: unknown) {
      setInboxError(err instanceof Error ? err.message : 'Network error');
    }
  }, []);

  const sendTestMessage = useCallback(async () => {
    if (!sendingTo || !sendDest.trim() || !sendBody.trim()) return;
    setSendBusy(true);
    try {
      const token = getAuthToken();
      const url = p('OPENBOT_CHANNEL_SEND').replace(':channelId', sendingTo);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: sendDest, content: sendBody }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const msg = typeof data.error === 'string' ? data.error : 'Send failed';
        toast({ title: 'Send failed', description: msg, variant: 'destructive' });
      } else {
        toast({ title: 'Message sent', description: `Delivered to ${sendDest}` });
        setSendingTo(null); setSendDest(''); setSendBody('');
        await refreshInbox();
        setActiveTab('inbox');
      }
    } catch (err: unknown) {
      toast({ title: 'Send failed', description: err instanceof Error ? err.message : 'Network error', variant: 'destructive' });
    } finally {
      setSendBusy(false);
    }
  }, [sendingTo, sendDest, sendBody, refreshInbox, toast]);

  const filteredMessages = inboxFilter === 'all' ? messages : messages.filter((m) => m.channel === inboxFilter);

  const addChannel = async () => {
    if (!newChannelName.trim()) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${NV_API.OPENBOT.path}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ channel: newChannelType, name: newChannelName }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast({ title: 'Add channel failed — backend pending', description: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`, variant: 'destructive' });
        return;
      }
      setChannels((prev) => [...prev, data.channel]);
      setShowAddChannel(false);
      setNewChannelName('');
      toast({ title: 'Channel added', description: `${newChannelName} is now configured.` });
    } catch (err: unknown) {
      toast({ title: 'Add channel failed — backend pending', description: err instanceof Error ? err.message : 'Network error', variant: 'destructive' });
    }
  };

  const stats = {
    total: channels.length,
    active: channels.filter((c) => c.status === 'active').length,
    messages: messages.length,
    inbound: messages.filter((m) => m.direction === 'inbound').length,
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
              <Radio className="h-5 w-5 text-slate-900" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">OpenBot™ Studio</h1>
              <p className="text-xs text-slate-700">Multi-Channel Legal Bot Studio — Jurexio Enterprise Platform 312</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NyvGovernanceBadge compact governance={{ risk_score: 25, risk_badge: 'YELLOW', risk_blocked: false, pattern_key: 'OPENBOT', warnings: ['AI Multi-Channel Studio — Outputs require human review before deployment'], timestamp: new Date().toISOString() }} />
            <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-xs" role="status">{stats.active} Active Channels</Badge>
            <Button size="sm" onClick={() => setShowAddChannel(true)} className="bg-blue-600 hover:bg-blue-700 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1.5" />Add Channel
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 p-6 pb-0">
        {[
          { label: 'Total Channels', value: stats.total, icon: <Layers className="h-4 w-4 text-blue-400" /> },
          { label: 'Active', value: stats.active, icon: <Activity className="h-4 w-4 text-green-400" /> },
          { label: 'Messages Today', value: stats.messages, icon: <MessageSquare className="h-4 w-4 text-purple-400" /> },
          { label: 'Inbound', value: stats.inbound, icon: <Inbox className="h-4 w-4 text-orange-400" /> },
        ].map((s) => (
          <Card key={s.label} className="bg-white border-slate-200">
            <CardContent className="p-4 flex items-center gap-3">
              {s.icon}
              <div>
                <p className="text-xl font-bold">{s.value}</p>
                <p className="text-xs text-slate-700">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Tabs */}
      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 p-1 h-9 gap-1" aria-label="Navigation tabs">
            {[
              { id: 'channels', label: 'Channels', icon: <Layers className="h-3.5 w-3.5" /> },
              { id: 'inbox', label: `Inbox (${messages.length})`, icon: <Inbox className="h-3.5 w-3.5" /> },
              { id: 'routing', label: 'Routing Rules', icon: <Filter className="h-3.5 w-3.5" /> },
            ].map((t) => (
              <TabsTrigger key={t.id} value={t.id}
                className="text-xs data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 text-slate-700 flex items-center gap-1.5 px-3">
                {t.icon}{t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* CHANNELS */}
          <TabsContent value="channels" className="mt-4">
            {channelsLoading ? (
              <div className="grid grid-cols-3 gap-4" data-testid="channels-loading">
                {[0,1,2].map((i) => (
                  <div key={i} className="h-44 rounded-lg bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : channelsError ? (
              <div className="border border-red-200 bg-red-50 rounded-lg p-6 text-center text-sm text-red-600" data-testid="channels-error">
                <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
                Could not load channels: {channelsError}
              </div>
            ) : channels.length === 0 ? (
              <NyvEmptyState
                icon={Radio}
                title="No channels configured"
                description="No channels configured yet. Add a WhatsApp, Slack, Teams, Telegram, Email, Web or REST API channel to start receiving messages."
                cta={{ label: 'Add Channel', onClick: () => setShowAddChannel(true) }}
                variant="card"
              />
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {channels.map((ch) => {
                  const meta = CHANNEL_META[ch.channel];
                  return (
                    <Card key={ch.channelId} className={`border ${ch.status === 'active' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className={`h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center ${meta.color}`}>
                            {meta.icon}
                          </div>
                          <Badge className={`text-xs border ${
                            ch.status === 'active' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                            ch.status === 'paused' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                            'bg-red-500/20 text-red-400 border-red-500/30'
                          }`}>
                            {ch.status}
                          </Badge>
                        </div>
                        <h3 className="text-sm font-semibold">{ch.name}</h3>
                        <p className="text-xs text-slate-700 mt-0.5">{meta.description}</p>
                        <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-600">Channel ID</span>
                            <code className="text-purple-400">{ch.channelId}</code>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-600">Bots linked</span>
                            <span>{ch.botIds.length}</span>
                          </div>
                          {ch.webhookUrl && (
                            <div className="text-xs">
                              <span className="text-slate-600">Webhook:</span>
                              <code className="block mt-0.5 text-purple-400 break-all">{ch.webhookUrl}</code>
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full mt-3 text-xs h-7"
                          onClick={() => { setSendingTo(ch.channelId); setSendDest(''); setSendBody(''); }}
                          data-testid={`channel-send-${ch.channelId}`}
                        >
                          <Send className="h-3 w-3 mr-1.5" /> Send test message
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}

                {/* Add Channel CTA */}
                <Card className="border-dashed border-slate-200 bg-transparent cursor-pointer hover:bg-slate-50 transition-all"
                  onClick={() => setShowAddChannel(true)}>
                  <CardContent className="p-4 h-full flex flex-col items-center justify-center gap-2 text-slate-600">
                    <Plus className="h-8 w-8" />
                    <p className="text-sm">Add Channel</p>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* INBOX */}
          <TabsContent value="inbox" className="mt-4">
            <div className="flex items-center gap-2 mb-4">
              <p className="text-xs text-slate-700 mr-2">Filter by channel:</p>
              {(['all', 'whatsapp', 'web', 'api', 'slack', 'telegram', 'email'] as const).map((c) => (
                <Button key={c} size="sm" variant={inboxFilter === c ? 'default' : 'outline'}
                  className={`text-xs h-7 ${inboxFilter === c ? 'bg-blue-600' : 'border-slate-200 text-slate-700 hover:bg-white'}`}
                  onClick={() => setInboxFilter(c as any)}>
                  {c === 'all' ? 'All' : CHANNEL_META[c]?.label ?? c}
                </Button>
              ))}
            </div>
            <ScrollArea className="h-96" aria-label="Scrollable content">
              <div className="space-y-2">
                {inboxLoading ? (
                  <div className="space-y-2" data-testid="inbox-loading">
                    {[0,1,2,3].map((i) => <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />)}
                  </div>
                ) : inboxError ? (
                  <div className="border border-red-200 bg-red-50 rounded-lg p-6 text-center text-sm text-red-600" data-testid="inbox-error">
                    <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
                    Could not load inbox: {inboxError}
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <NyvEmptyState
                    icon={Inbox}
                    title="Inbox Empty"
                    description={inboxFilter === 'all'
                      ? "No messages yet. Send a test message from the Channels tab or wait for an inbound webhook to populate the unified inbox."
                      : `No messages found for the ${CHANNEL_META[inboxFilter]?.label} channel.`
                    }
                    variant="card"
                    size="sm"
                  />
                ) : filteredMessages.map((msg) => {
                  const meta = CHANNEL_META[msg.channel];
                  return (
                    <div key={msg.messageId} className={`flex items-start gap-3 p-3 rounded-lg border ${
                      msg.direction === 'inbound' ? 'border-blue-500/20 bg-blue-500/5' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className={`h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0 ${meta?.color}`}>
                        {meta?.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">{msg.from}</span>
                          <Badge className={`text-xs ${msg.direction === 'inbound' ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-100 text-slate-700'}`}>
                            {msg.direction}
                          </Badge>
                          <span className="text-xs text-slate-600 ml-auto">{formatTime(msg.timestamp)}</span>
                        </div>
                        <p className="text-sm text-slate-700 truncate">{msg.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ROUTING RULES */}
          <TabsContent value="routing" className="mt-4">
            {rules.length === 0 ? (
              <NyvEmptyState
                icon={Layers}
                title="No routing rules"
                description="No routing rules configured yet. Add a rule to route inbound messages by channel, keyword or user group to the right bot."
                cta={{ label: "Add Routing Rule", onClick: openAddRule }}
                variant="card"
              />
            ) : (
              <div className="space-y-3">
                {rules.map((rule) => (
                  <Card key={rule.ruleId} className="bg-white border-slate-200">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                            rule.isActive ? "bg-green-500/20 text-green-400" : "bg-slate-100 text-slate-600"
                          }`}>{rule.priority}</div>
                          <div>
                            <p className="text-sm font-medium">{rule.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {rule.conditions.channels?.map((c) => (
                                <Badge key={c} variant="outline" className="text-xs border-slate-200 text-slate-700" role="status">{c}</Badge>
                              ))}
                              {rule.conditions.keywords?.map((k) => (
                                <Badge key={k} variant="outline" className="text-xs border-purple-500/30 text-purple-400" role="status">{k}</Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <ArrowRight className="h-4 w-4 text-slate-600" />
                          <code className="text-xs bg-slate-100 text-green-400 px-2 py-0.5 rounded">{rule.targetBotId}</code>
                          <Badge className={rule.isActive ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-slate-100 text-slate-600"}>
                            {rule.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                <Button
                  variant="outline"
                  className="border-dashed border-slate-200 text-slate-600 hover:bg-white w-full"
                  onClick={openAddRule}
                  data-testid="add-routing-rule"
                >
                  <Plus className="h-4 w-4 mr-2" />Add Routing Rule
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Channel Modal */}
      {showAddChannel && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="bg-white border-slate-200 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-slate-900">Add Channel</CardTitle>
              <CardDescription className="text-slate-700">Connect a new messaging channel</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-slate-600 text-sm">Channel Type</Label>
                <Select value={newChannelType} onValueChange={(v) => setNewChannelType(v as ChannelType)}>
                  <SelectTrigger className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    {(Object.keys(CHANNEL_META) as ChannelType[]).map((c) => (
                      <SelectItem key={c} value={c} className="text-slate-900 hover:bg-slate-100">
                        <span className={CHANNEL_META[c].color}>{CHANNEL_META[c].label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-600 text-sm">Channel Name *</Label>
                <Input value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder={`e.g. ${CHANNEL_META[newChannelType].label} — Nyayamitra`}
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600" />
              </div>
            </CardContent>
            <div className="flex gap-3 px-6 pb-6">
              <Button variant="outline" className="flex-1 border-slate-200 text-slate-600" onClick={() => setShowAddChannel(false)}>Cancel</Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-slate-50" onClick={addChannel}>Add Channel</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Add Routing Rule Modal */}
      {showAddRule && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" data-testid="add-rule-modal">
          <Card className="bg-white border-slate-200 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-slate-900">Add Routing Rule</CardTitle>
              <CardDescription className="text-slate-700">Route inbound messages by channel and keyword to a target bot</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-slate-600 text-sm">Rule Name *</Label>
                <Input
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g. WhatsApp → Nyayamitra"
                  data-testid="rule-name"
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600"
                />
              </div>
              <div>
                <Label className="text-slate-600 text-sm">Channels (optional)</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(Object.keys(CHANNEL_META) as ChannelType[]).map((c) => {
                    const selected = ruleChannels.includes(c);
                    return (
                      <Button
                        key={c}
                        type="button"
                        size="sm"
                        variant={selected ? 'default' : 'outline'}
                        className={`text-xs h-7 ${selected ? 'bg-blue-600 text-slate-50' : 'border-slate-200 text-slate-600'}`}
                        onClick={() => toggleRuleChannel(c)}
                        data-testid={`rule-channel-${c}`}
                      >
                        {CHANNEL_META[c].label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="text-slate-600 text-sm">Keywords (comma-separated, optional)</Label>
                <Input
                  value={ruleKeywords}
                  onChange={(e) => setRuleKeywords(e.target.value)}
                  placeholder="urgent, contract, refund"
                  data-testid="rule-keywords"
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600"
                />
              </div>
              <div>
                <Label className="text-slate-600 text-sm">Target Bot ID *</Label>
                <Input
                  value={ruleTargetBot}
                  onChange={(e) => setRuleTargetBot(e.target.value)}
                  placeholder="bot_nyayamitra_in"
                  data-testid="rule-target-bot"
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-600 text-sm">Priority (1–100)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={rulePriority}
                    onChange={(e) => setRulePriority(parseInt(e.target.value, 10))}
                    data-testid="rule-priority"
                    className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900"
                  />
                </div>
                <div>
                  <Label className="text-slate-600 text-sm">Status</Label>
                  <div className="mt-1.5 flex items-center gap-2 h-9">
                    <input
                      id="rule-active"
                      type="checkbox"
                      checked={ruleIsActive}
                      onChange={(e) => setRuleIsActive(e.target.checked)}
                      data-testid="rule-active"
                      className="h-4 w-4"
                    />
                    <Label htmlFor="rule-active" className="text-sm text-slate-700 cursor-pointer">Active</Label>
                  </div>
                </div>
              </div>
            </CardContent>
            <div className="flex gap-3 px-6 pb-6">
              <Button
                variant="outline"
                className="flex-1 border-slate-200 text-slate-600"
                onClick={() => setShowAddRule(false)}
                disabled={ruleBusy}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-slate-50"
                onClick={submitRule}
                disabled={ruleBusy || !ruleName.trim() || !ruleTargetBot.trim()}
                data-testid="rule-submit"
              >
                {ruleBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Add Rule
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Send Test Message Modal */}
      {sendingTo && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" data-testid="send-test-modal">
          <Card className="bg-white border-slate-200 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-slate-900">Send test message</CardTitle>
              <CardDescription className="text-slate-700">
                Channel <code className="text-purple-500">{sendingTo}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-slate-600 text-sm">Recipient (phone / handle / email) *</Label>
                <Input value={sendDest} onChange={(e) => setSendDest(e.target.value)}
                  placeholder="+919999912345"
                  data-testid="send-test-dest"
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600" />
              </div>
              <div>
                <Label className="text-slate-600 text-sm">Message *</Label>
                <Input value={sendBody} onChange={(e) => setSendBody(e.target.value)}
                  placeholder="Hello from OpenBot"
                  data-testid="send-test-body"
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600" />
              </div>
            </CardContent>
            <div className="flex gap-3 px-6 pb-6">
              <Button variant="outline" className="flex-1 border-slate-200 text-slate-600"
                onClick={() => { setSendingTo(null); setSendDest(''); setSendBody(''); }} disabled={sendBusy}>
                Cancel
              </Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700 text-slate-50"
                onClick={sendTestMessage} disabled={sendBusy || !sendDest.trim() || !sendBody.trim()}
                data-testid="send-test-submit">
                {sendBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Send
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
