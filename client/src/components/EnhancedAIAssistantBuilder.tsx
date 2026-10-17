/**
 * Enhanced AI Assistant Builder - Phase 3 Enterprise Feature
 * 
 * No-code UI for creating AI assistants with custom knowledge bases,
 * prompt templates, auto-generated APIs, and enterprise integrations
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { 
  Bot, Brain, Wand2, Database, Code, Settings, Upload, Download,
  MessageCircle, Zap, Globe, Shield, Users, Star, CheckCircle,
  AlertTriangle, FileText, Image, Video, Music, Mic, Eye,
  Sparkles, Layers, Network, GitBranch, Play, Pause, Save
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface AIAssistant {
  id: string;
  name: string;
  description: string;
  avatar: string;
  personality: string;
  capabilities: string[];
  knowledgeBase: KnowledgeBase;
  promptTemplate: PromptTemplate;
  integrations: Integration[];
  apiEndpoint: string;
  status: 'draft' | 'training' | 'active' | 'paused';
  usage: AssistantUsage;
  performance: AssistantPerformance;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  sources: KnowledgeSource[];
  vectorCount: number;
  lastUpdated: string;
  size: string;
  accuracy: number;
}

interface KnowledgeSource {
  id: string;
  type: 'document' | 'website' | 'database' | 'api';
  name: string;
  url?: string;
  status: 'processing' | 'active' | 'error';
  lastSync: string;
  documentCount?: number;
}

interface PromptTemplate {
  id: string;
  name: string;
  systemPrompt: string;
  userPromptPrefix: string;
  responseFormat: string;
  variables: PromptVariable[];
  examples: PromptExample[];
  version: string;
}

interface PromptVariable {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'array';
  description: string;
  defaultValue?: any;
  required: boolean;
}

interface PromptExample {
  input: string;
  output: string;
  context?: string;
}

interface Integration {
  id: string;
  platform: string;
  type: 'webhook' | 'api' | 'widget' | 'chatbot';
  config: any;
  status: 'active' | 'inactive';
  lastUsed: string;
}

interface AssistantUsage {
  totalInteractions: number;
  dailyUsage: number;
  averageResponseTime: number;
  satisfactionScore: number;
  topQueries: string[];
}

interface AssistantPerformance {
  accuracy: number;
  responseQuality: number;
  userRetention: number;
  errorRate: number;
  uptime: number;
}

export default function EnhancedAIAssistantBuilder() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedAssistant, setSelectedAssistant] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [assistantForm, setAssistantForm] = useState({
    name: '',
    description: '',
    personality: 'helpful',
    capabilities: [] as string[],
    avatar: ''
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch assistants using Jurexio orchestration
  const { data: assistants = [], isLoading: assistantsLoading } = useQuery({
    queryKey: ['/api/nyayavigya/assistants'],
    queryFn: () => apiRequest('/api/nyayavigya/assistants')
  });

  // Fetch prompt templates using Jurexio orchestration
  const { data: promptTemplates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['/api/nyayavigya/assistants/templates'],
    queryFn: () => apiRequest('/api/nyayavigya/assistants/templates')
  });

  // Fetch knowledge bases using Jurexio orchestration
  const { data: knowledgeBases = [], isLoading: knowledgeLoading } = useQuery({
    queryKey: ['/api/nyayavigya/assistants/knowledge-bases'],
    queryFn: () => apiRequest('/api/nyayavigya/assistants/knowledge-bases')
  });

  // Create assistant mutation
  const createAssistant = useMutation({
    mutationFn: (assistant: any) => apiRequest('/api/nyayavigya/assistants', {
      method: 'POST',
      body: JSON.stringify(assistant)
    }),
    onSuccess: (assistant) => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya/assistants'] });
      setIsCreating(false);
      setAssistantForm({ name: '', description: '', personality: 'helpful', capabilities: [], avatar: '' });
      toast({
        title: "Assistant Created",
        description: `${assistant.name} has been created successfully`
      });
    }
  });

  // Train assistant mutation
  const trainAssistant = useMutation({
    mutationFn: (assistantId: string) => apiRequest(`/api/nyayavigya/assistants/${assistantId}/train`, {
      method: 'POST'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya/assistants'] });
      toast({
        title: "Training Started",
        description: "Assistant training has been initiated"
      });
    }
  });

  // Deploy assistant mutation
  const deployAssistant = useMutation({
    mutationFn: (assistantId: string) => apiRequest(`/api/nyayavigya/assistants/${assistantId}/deploy`, {
      method: 'POST'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya/assistants'] });
      toast({
        title: "Assistant Deployed",
        description: "Assistant is now live and available"
      });
    }
  });

  const mockAssistants: AIAssistant[] = [
    {
      id: '1',
      name: 'Customer Support Bot',
      description: 'AI assistant for handling customer inquiries and support tickets',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=support',
      personality: 'helpful and empathetic',
      capabilities: ['Customer Support', 'Ticket Management', 'FAQ', 'Escalation'],
      knowledgeBase: {
        id: 'kb1',
        name: 'Support Knowledge Base',
        sources: [
          { id: 's1', type: 'document', name: 'Product Documentation', status: 'active', lastSync: '2025-08-17T10:00:00Z', documentCount: 156 },
          { id: 's2', type: 'website', name: 'FAQ Website', url: 'https://example.com/faq', status: 'active', lastSync: '2025-08-17T08:00:00Z' }
        ],
        vectorCount: 15678,
        lastUpdated: '2025-08-17T10:00:00Z',
        size: '2.3 GB',
        accuracy: 94.2
      },
      promptTemplate: {
        id: 'pt1',
        name: 'Support Template',
        systemPrompt: 'You are a helpful customer support assistant...',
        userPromptPrefix: 'Customer inquiry: ',
        responseFormat: 'Professional and empathetic',
        variables: [
          { name: 'customerName', type: 'text', description: 'Customer name', required: false },
          { name: 'ticketId', type: 'text', description: 'Support ticket ID', required: false }
        ],
        examples: [
          { input: 'How do I reset my password?', output: 'I can help you reset your password...' }
        ],
        version: '1.2'
      },
      integrations: [
        { id: 'i1', platform: 'Slack', type: 'chatbot', config: {}, status: 'active', lastUsed: '2025-08-17T09:00:00Z' },
        { id: 'i2', platform: 'Website', type: 'widget', config: {}, status: 'active', lastUsed: '2025-08-17T11:00:00Z' }
      ],
      apiEndpoint: 'https://api.nyayavigya-devstudio.com/assistants/1',
      status: 'active',
      usage: {
        totalInteractions: 15678,
        dailyUsage: 234,
        averageResponseTime: 850,
        satisfactionScore: 4.6,
        topQueries: ['Password reset', 'Billing inquiry', 'Feature request']
      },
      performance: {
        accuracy: 94.2,
        responseQuality: 4.6,
        userRetention: 78.3,
        errorRate: 2.1,
        uptime: 99.8
      },
      createdAt: '2025-08-10T00:00:00Z',
      updatedAt: '2025-08-17T10:00:00Z'
    },
    {
      id: '2',
      name: 'Sales Assistant',
      description: 'AI assistant for lead qualification and sales support',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sales',
      personality: 'professional and persuasive',
      capabilities: ['Lead Qualification', 'Product Information', 'Pricing', 'Scheduling'],
      knowledgeBase: {
        id: 'kb2',
        name: 'Sales Knowledge Base',
        sources: [
          { id: 's3', type: 'document', name: 'Product Catalog', status: 'active', lastSync: '2025-08-17T09:00:00Z', documentCount: 89 },
          { id: 's4', type: 'database', name: 'CRM Database', status: 'active', lastSync: '2025-08-17T10:30:00Z' }
        ],
        vectorCount: 8945,
        lastUpdated: '2025-08-17T10:30:00Z',
        size: '1.8 GB',
        accuracy: 91.7
      },
      promptTemplate: {
        id: 'pt2',
        name: 'Sales Template',
        systemPrompt: 'You are a professional sales assistant...',
        userPromptPrefix: 'Sales inquiry: ',
        responseFormat: 'Professional and persuasive',
        variables: [
          { name: 'leadSource', type: 'text', description: 'Lead source', required: false },
          { name: 'companySize', type: 'text', description: 'Company size', required: false }
        ],
        examples: [
          { input: 'Tell me about your pricing plans', output: 'Our pricing is designed to scale with your business...' }
        ],
        version: '1.0'
      },
      integrations: [
        { id: 'i3', platform: 'HubSpot', type: 'api', config: {}, status: 'active', lastUsed: '2025-08-17T11:15:00Z' }
      ],
      apiEndpoint: 'https://api.nyayavigya-devstudio.com/assistants/2',
      status: 'training',
      usage: {
        totalInteractions: 3456,
        dailyUsage: 78,
        averageResponseTime: 920,
        satisfactionScore: 4.3,
        topQueries: ['Pricing information', 'Feature comparison', 'Demo request']
      },
      performance: {
        accuracy: 91.7,
        responseQuality: 4.3,
        userRetention: 72.1,
        errorRate: 3.2,
        uptime: 99.5
      },
      createdAt: '2025-08-15T00:00:00Z',
      updatedAt: '2025-08-17T11:15:00Z'
    }
  ];

  const availableCapabilities = [
    'Customer Support', 'Sales Assistance', 'Lead Qualification', 'Content Creation',
    'Data Analysis', 'Scheduling', 'FAQ', 'Product Information', 'Pricing',
    'Technical Support', 'Onboarding', 'Training', 'Reporting', 'Integration'
  ];

  const handleCreateAssistant = async () => {
    if (!assistantForm.name.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter an assistant name",
        variant: "destructive"
      });
      return;
    }

    const newAssistant = {
      ...assistantForm,
      id: `assistant-${Date.now()}`,
      avatar: assistantForm.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${assistantForm.name}`,
      status: 'draft'
    };

    await createAssistant.mutateAsync(newAssistant);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-600';
      case 'training': return 'text-blue-600';
      case 'draft': return 'text-yellow-600';
      case 'paused': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return 'default';
      case 'training': return 'secondary';
      case 'draft': return 'outline';
      case 'paused': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">AI Assistant Builder</h2>
          <p className="text-muted-foreground">
            Create, train, and deploy custom AI assistants with no-code tools
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="px-3 py-1">
            <Brain className="h-3 w-3 mr-1" />
            Enterprise AI
          </Badge>
          <Button
            onClick={() => setIsCreating(true)}
            disabled={createAssistant.isPending}
          >
            <Bot className="h-4 w-4 mr-2" />
            Create Assistant
          </Button>
        </div>
      </div>

      {/* Create Assistant Modal */}
      <AnimatePresence>
        {isCreating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setIsCreating(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background rounded-lg p-6 w-full max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Create New Assistant</h3>
                  <p className="text-sm text-muted-foreground">
                    Configure your AI assistant's basic settings
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Assistant Name</label>
                    <Input
                      placeholder="Enter assistant name..."
                      value={assistantForm.name}
                      onChange={(e) => setAssistantForm(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      placeholder="Describe what this assistant will do..."
                      value={assistantForm.description}
                      onChange={(e) => setAssistantForm(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium">Personality</label>
                    <select
                      value={assistantForm.personality}
                      onChange={(e) => setAssistantForm(prev => ({ ...prev, personality: e.target.value }))}
                      className="w-full px-3 py-2 rounded-md border bg-background"
                    >
                      <option value="helpful">Helpful</option>
                      <option value="professional">Professional</option>
                      <option value="friendly">Friendly</option>
                      <option value="formal">Formal</option>
                      <option value="casual">Casual</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Capabilities</label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {availableCapabilities.map((capability) => (
                        <Badge
                          key={capability}
                          variant={assistantForm.capabilities.includes(capability) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => {
                            setAssistantForm(prev => ({
                              ...prev,
                              capabilities: prev.capabilities.includes(capability)
                                ? prev.capabilities.filter(c => c !== capability)
                                : [...prev.capabilities, capability]
                            }));
                          }}
                        >
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setIsCreating(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateAssistant}
                    disabled={createAssistant.isPending}
                    className="flex-1"
                  >
                    {createAssistant.isPending ? (
                      <>
                        <Wand2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Bot className="h-4 w-4 mr-2" />
                        Create
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assistants">Assistants</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Assistants</p>
                    <p className="text-2xl font-bold">{mockAssistants.length}</p>
                  </div>
                  <Bot className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active Assistants</p>
                    <p className="text-2xl font-bold">
                      {mockAssistants.filter(a => a.status === 'active').length}
                    </p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Interactions</p>
                    <p className="text-2xl font-bold">
                      {mockAssistants.reduce((sum, a) => sum + a.usage.totalInteractions, 0).toLocaleString()}
                    </p>
                  </div>
                  <MessageCircle className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Satisfaction</p>
                    <p className="text-2xl font-bold">
                      {(mockAssistants.reduce((sum, a) => sum + a.usage.satisfactionScore, 0) / mockAssistants.length).toFixed(1)}
                    </p>
                  </div>
                  <Star className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  Assistant Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {mockAssistants.map((assistant) => (
                  <div key={assistant.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src={assistant.avatar}
                        alt={assistant.name}
                        className="w-8 h-8 rounded-full"
                      />
                      <div>
                        <div className="font-medium text-sm">{assistant.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {assistant.usage.totalInteractions.toLocaleString()} interactions
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{assistant.performance.accuracy}%</div>
                      <div className="text-xs text-muted-foreground">accuracy</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Knowledge Base Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {mockAssistants.map((assistant) => (
                  <div key={assistant.id} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">{assistant.knowledgeBase.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {assistant.knowledgeBase.vectorCount.toLocaleString()} vectors
                      </Badge>
                    </div>
                    <Progress value={assistant.knowledgeBase.accuracy} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Accuracy: {assistant.knowledgeBase.accuracy}%</span>
                      <span>Size: {assistant.knowledgeBase.size}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Assistants Tab */}
        <TabsContent value="assistants" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {mockAssistants.map((assistant) => (
              <motion.div
                key={assistant.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="group"
              >
                <Card className="h-full transition-all group-hover:shadow-lg">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <img
                          src={assistant.avatar}
                          alt={assistant.name}
                          className="w-10 h-10 rounded-full"
                        />
                        <div>
                          <CardTitle className="text-base">{assistant.name}</CardTitle>
                          <Badge variant={getStatusBadge(assistant.status)} className="text-xs">
                            {assistant.status}
                          </Badge>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {assistant.description}
                    </p>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Interactions</span>
                        <span className="font-medium">
                          {assistant.usage.totalInteractions.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Accuracy</span>
                        <span className="font-medium">{assistant.performance.accuracy}%</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Satisfaction</span>
                        <span className="font-medium">{assistant.usage.satisfactionScore}/5</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-sm text-muted-foreground">Capabilities</span>
                      <div className="flex flex-wrap gap-1">
                        {assistant.capabilities.slice(0, 3).map((capability) => (
                          <Badge key={capability} variant="secondary" className="text-xs">
                            {capability}
                          </Badge>
                        ))}
                        {assistant.capabilities.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{assistant.capabilities.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      {assistant.status === 'draft' && (
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => trainAssistant.mutate(assistant.id)}
                          disabled={trainAssistant.isPending}
                        >
                          <Brain className="h-3 w-3 mr-1" />
                          Train
                        </Button>
                      )}
                      {assistant.status === 'training' && (
                        <Button size="sm" className="flex-1" disabled>
                          <Wand2 className="h-3 w-3 mr-1 animate-spin" />
                          Training...
                        </Button>
                      )}
                      {assistant.status === 'active' && (
                        <Button size="sm" variant="outline" className="flex-1">
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                      )}
                      <Button size="sm" variant="outline">
                        <Code className="h-3 w-3 mr-1" />
                        API
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </TabsContent>

        {/* Knowledge Tab */}
        <TabsContent value="knowledge" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Knowledge Bases
              </CardTitle>
              <CardDescription>
                Manage data sources and knowledge for your AI assistants
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mockAssistants.map((assistant) => (
                  <motion.div
                    key={assistant.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border rounded-lg p-6 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{assistant.knowledgeBase.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {assistant.knowledgeBase.vectorCount.toLocaleString()} vectors • {assistant.knowledgeBase.size}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {assistant.knowledgeBase.accuracy}% accuracy
                        </Badge>
                        <Button variant="outline" size="sm">
                          <Upload className="h-4 w-4 mr-2" />
                          Add Source
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <span className="text-sm font-medium">Data Sources</span>
                      {assistant.knowledgeBase.sources.map((source) => (
                        <div key={source.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              {source.type === 'document' && <FileText className="h-4 w-4" />}
                              {source.type === 'website' && <Globe className="h-4 w-4" />}
                              {source.type === 'database' && <Database className="h-4 w-4" />}
                              {source.type === 'api' && <Code className="h-4 w-4" />}
                            </div>
                            <div>
                              <div className="font-medium text-sm">{source.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {source.type} • Last sync: {new Date(source.lastSync).toLocaleString()}
                                {source.documentCount && ` • ${source.documentCount} documents`}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={source.status === 'active' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {source.status}
                            </Badge>
                            <Button variant="ghost" size="sm">
                              <Settings className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Prompt Templates
              </CardTitle>
              <CardDescription>
                Pre-configured prompt templates for different use cases
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {mockAssistants.map((assistant) => (
                  <motion.div
                    key={assistant.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border rounded-lg p-6 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{assistant.promptTemplate.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          Version {assistant.promptTemplate.version}
                        </p>
                      </div>
                      <Button variant="outline" size="sm">
                        <Settings className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <span className="text-sm font-medium">System Prompt</span>
                        <div className="mt-1 p-3 bg-muted rounded-lg text-xs font-mono">
                          {assistant.promptTemplate.systemPrompt.slice(0, 100)}...
                        </div>
                      </div>

                      <div>
                        <span className="text-sm font-medium">Variables ({assistant.promptTemplate.variables.length})</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {assistant.promptTemplate.variables.map((variable) => (
                            <Badge key={variable.name} variant="outline" className="text-xs">
                              {variable.name}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className="text-sm font-medium">Examples ({assistant.promptTemplate.examples.length})</span>
                        <div className="mt-1 space-y-2">
                          {assistant.promptTemplate.examples.slice(0, 1).map((example, index) => (
                            <div key={index} className="text-xs space-y-1">
                              <div>
                                <span className="text-muted-foreground">Input:</span> {example.input}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Output:</span> {example.output.slice(0, 50)}...
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations Tab */}
        <TabsContent value="integrations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" />
                Platform Integrations
              </CardTitle>
              <CardDescription>
                Connect your AI assistants to external platforms and services
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {mockAssistants.map((assistant) => (
                  <motion.div
                    key={assistant.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border rounded-lg p-6 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{assistant.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {assistant.integrations.length} active integrations
                        </p>
                      </div>
                      <Button variant="outline" size="sm">
                        <Network className="h-4 w-4 mr-2" />
                        Add Integration
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {assistant.integrations.map((integration) => (
                        <div key={integration.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              <Globe className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="font-medium text-sm">{integration.platform}</div>
                              <div className="text-xs text-muted-foreground">
                                {integration.type} • Last used: {new Date(integration.lastUsed).toLocaleString()}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={integration.status === 'active' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {integration.status}
                            </Badge>
                            <Button variant="ghost" size="sm">
                              <Settings className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="bg-muted p-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Code className="h-4 w-4" />
                        <span className="text-sm font-medium">API Endpoint</span>
                      </div>
                      <code className="text-xs font-mono bg-background px-2 py-1 rounded">
                        {assistant.apiEndpoint}
                      </code>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}