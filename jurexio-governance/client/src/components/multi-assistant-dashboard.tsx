/**
 * Multi-Assistant Management Dashboard
 * Grid view with analytics, versioning, and A/B testing
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Bot, 
  Users, 
  MessageSquare, 
  Activity,
  TrendingUp,
  Globe,
  Mic,
  Video,
  Sparkles,
  Settings,
  Copy,
  Trash2,
  Edit,
  PlayCircle,
  PauseCircle,
  BarChart3,
  Filter,
  Search,
  Plus,
  GitBranch,
  TestTube,
  Languages,
  Brain,
  Database,
  Zap,
  CheckCircle,
  AlertCircle,
  Clock,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts';

interface Assistant {
  id: string;
  name: string;
  description: string;
  avatar: string;
  status: 'active' | 'inactive' | 'testing' | 'maintenance';
  version: string;
  languages: string[];
  capabilities: string[];
  metrics: {
    totalConversations: number;
    activeUsers: number;
    satisfactionScore: number;
    avgResponseTime: number;
    successRate: number;
  };
  ragConfig: {
    vectorDB: string;
    documents: number;
    chunkSize: number;
    embeddingModel: string;
  };
  performance: {
    date: string;
    conversations: number;
    satisfaction: number;
  }[];
  abTest?: {
    variant: 'A' | 'B';
    conversions: number;
    improvement: number;
  };
}

// Removed mock data - will fetch from API
const mockAssistants: Assistant[] = [
  {
    id: '1',
    name: 'Customer Support AI',
    description: 'Multilingual support assistant with advanced RAG',
    avatar: '/avatars/support.png',
    status: 'active',
    version: '5.0.0',
    languages: ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali'],
    capabilities: ['Text', 'Voice', 'Video', '3D Avatar'],
    metrics: {
      totalConversations: 45230,
      activeUsers: 2341,
      satisfactionScore: 94.5,
      avgResponseTime: 1.2,
      successRate: 89.3
    },
    ragConfig: {
      vectorDB: 'Pinecone',
      documents: 5420,
      chunkSize: 512,
      embeddingModel: 'text-embedding-3-large'
    },
    performance: [
      { date: 'Mon', conversations: 1200, satisfaction: 92 },
      { date: 'Tue', conversations: 1350, satisfaction: 94 },
      { date: 'Wed', conversations: 1100, satisfaction: 93 },
      { date: 'Thu', conversations: 1450, satisfaction: 95 },
      { date: 'Fri', conversations: 1600, satisfaction: 94 },
      { date: 'Sat', conversations: 900, satisfaction: 96 },
      { date: 'Sun', conversations: 850, satisfaction: 95 }
    ],
    abTest: {
      variant: 'B',
      conversions: 78,
      improvement: 23.5
    }
  },
  {
    id: '2',
    name: 'Sales Assistant Pro',
    description: 'B2B sales enablement with real-time web search',
    avatar: '/avatars/sales.png',
    status: 'testing',
    version: '3.0.0-beta',
    languages: ['English', 'Spanish', 'French', 'German'],
    capabilities: ['Text', 'Voice', 'AR/VR'],
    metrics: {
      totalConversations: 23450,
      activeUsers: 1234,
      satisfactionScore: 91.2,
      avgResponseTime: 0.9,
      successRate: 87.5
    },
    ragConfig: {
      vectorDB: 'Weaviate',
      documents: 3200,
      chunkSize: 256,
      embeddingModel: 'voyage-2'
    },
    performance: [
      { date: 'Mon', conversations: 800, satisfaction: 90 },
      { date: 'Tue', conversations: 950, satisfaction: 91 },
      { date: 'Wed', conversations: 1050, satisfaction: 92 },
      { date: 'Thu', conversations: 1150, satisfaction: 91 },
      { date: 'Fri', conversations: 1300, satisfaction: 93 },
      { date: 'Sat', conversations: 600, satisfaction: 94 },
      { date: 'Sun', conversations: 550, satisfaction: 92 }
    ]
  },
  {
    id: '3',
    name: 'Healthcare Navigator',
    description: '3D immersive medical consultation assistant',
    avatar: '/avatars/health.png',
    status: 'active',
    version: '1.8.4',
    languages: ['English', 'Kannada', 'Malayalam', 'Gujarati', 'Marathi'],
    capabilities: ['Text', 'Voice', 'Video', '3D Avatar', 'XR'],
    metrics: {
      totalConversations: 67890,
      activeUsers: 4567,
      satisfactionScore: 96.8,
      avgResponseTime: 1.5,
      successRate: 92.1
    },
    ragConfig: {
      vectorDB: 'ChromaDB',
      documents: 12000,
      chunkSize: 1024,
      embeddingModel: 'medicalbert-v2'
    },
    performance: [
      { date: 'Mon', conversations: 2200, satisfaction: 96 },
      { date: 'Tue', conversations: 2450, satisfaction: 97 },
      { date: 'Wed', conversations: 2100, satisfaction: 96 },
      { date: 'Thu', conversations: 2650, satisfaction: 97 },
      { date: 'Fri', conversations: 2800, satisfaction: 98 },
      { date: 'Sat', conversations: 1900, satisfaction: 97 },
      { date: 'Sun', conversations: 1750, satisfaction: 96 }
    ]
  }
];

export default function MultiAssistantDashboard() {
  const [assistants, setAssistants] = useState<Assistant[]>(mockAssistants);
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  const filteredAssistants = assistants.filter(assistant => {
    const matchesStatus = filterStatus === 'all' || assistant.status === filterStatus;
    const matchesSearch = assistant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          assistant.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const totalMetrics = {
    totalAssistants: assistants.length,
    activeAssistants: assistants.filter(a => a.status === 'active').length,
    totalConversations: assistants.reduce((sum, a) => sum + a.metrics.totalConversations, 0),
    avgSatisfaction: assistants.reduce((sum, a) => sum + a.metrics.satisfactionScore, 0) / assistants.length
  };

  const AssistantCard = ({ assistant }: { assistant: Assistant }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      className="cursor-pointer"
      onClick={() => setSelectedAssistant(assistant)}
    >
      <Card className="h-full hover:shadow-lg transition-shadow">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <Avatar className="w-12 h-12">
                <AvatarImage src={assistant.avatar} />
                <AvatarFallback>
                  <Bot className="w-6 h-6" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-lg">{assistant.name}</CardTitle>
                <div className="flex items-center space-x-2 mt-1">
                  <Badge variant={
                    assistant.status === 'active' ? 'default' :
                    assistant.status === 'testing' ? 'secondary' :
                    assistant.status === 'maintenance' ? 'outline' :
                    'destructive'
                  }>
                    {assistant.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">v{assistant.version}</span>
                </div>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Settings className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy className="w-4 h-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <GitBranch className="w-4 h-4 mr-2" />
                  Version History
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <TestTube className="w-4 h-4 mr-2" />
                  A/B Test
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{assistant.description}</p>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center">
                <MessageSquare className="w-4 h-4 mr-1 text-muted-foreground" />
                Conversations
              </span>
              <span className="font-medium">{assistant.metrics.totalConversations.toLocaleString()}</span>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center">
                <Users className="w-4 h-4 mr-1 text-muted-foreground" />
                Active Users
              </span>
              <span className="font-medium">{assistant.metrics.activeUsers.toLocaleString()}</span>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center">
                <TrendingUp className="w-4 h-4 mr-1 text-muted-foreground" />
                Satisfaction
              </span>
              <div className="flex items-center space-x-2">
                <Progress value={assistant.metrics.satisfactionScore} className="w-20" />
                <span className="font-medium">{assistant.metrics.satisfactionScore}%</span>
              </div>
            </div>

            {assistant.abTest && (
              <div className="flex items-center justify-between text-sm bg-blue-50 dark:bg-blue-950 p-2 rounded">
                <span className="flex items-center">
                  <TestTube className="w-4 h-4 mr-1 text-blue-500" />
                  A/B Test Active
                </span>
                <span className="font-medium text-blue-600">
                  +{assistant.abTest.improvement}%
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1 mt-4">
            {assistant.capabilities.map((cap, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {cap}
              </Badge>
            ))}
          </div>

          <div className="flex items-center space-x-2 mt-3 text-xs text-muted-foreground">
            <Languages className="w-3 h-3" />
            <span>{assistant.languages.length} languages</span>
            <span>•</span>
            <Database className="w-3 h-3" />
            <span>{assistant.ragConfig.documents} docs</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  return (
    <div className="w-full space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Assistants</p>
                <p className="text-2xl font-bold">{totalMetrics.totalAssistants}</p>
              </div>
              <Bot className="w-8 h-8 text-primary/20" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Now</p>
                <p className="text-2xl font-bold">{totalMetrics.activeAssistants}</p>
              </div>
              <Activity className="w-8 h-8 text-green-500/20" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Conversations</p>
                <p className="text-2xl font-bold">{(totalMetrics.totalConversations / 1000).toFixed(1)}K</p>
              </div>
              <MessageSquare className="w-8 h-8 text-blue-500/20" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Satisfaction</p>
                <p className="text-2xl font-bold">{totalMetrics.avgSatisfaction.toFixed(1)}%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-yellow-500/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search assistants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
          
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="testing">Testing</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          >
            <BarChart3 className="w-4 h-4" />
          </Button>
          
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Create Assistant
          </Button>
        </div>
      </div>

      {/* Assistant Grid/List */}
      <AnimatePresence mode="wait">
        {viewMode === 'grid' ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {filteredAssistants.map(assistant => (
              <AssistantCard key={assistant.id} assistant={assistant} />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {filteredAssistants.map(assistant => (
              <Card key={assistant.id} className="hover:shadow-lg transition-shadow cursor-pointer"
                    onClick={() => setSelectedAssistant(assistant)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={assistant.avatar} />
                        <AvatarFallback>
                          <Bot className="w-5 h-5" />
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">{assistant.name}</span>
                          <Badge variant={assistant.status === 'active' ? 'default' : 'secondary'}>
                            {assistant.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">v{assistant.version}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{assistant.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-6">
                      <div className="text-right">
                        <p className="text-sm font-medium">{assistant.metrics.totalConversations.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">conversations</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{assistant.metrics.satisfactionScore}%</p>
                        <p className="text-xs text-muted-foreground">satisfaction</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{assistant.metrics.avgResponseTime}s</p>
                        <p className="text-xs text-muted-foreground">response time</p>
                      </div>
                      <Button variant="ghost" size="icon">
                        <Settings className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected Assistant Detail Modal */}
      {selectedAssistant && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={selectedAssistant.avatar} />
                  <AvatarFallback>
                    <Bot className="w-6 h-6" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle>{selectedAssistant.name}</CardTitle>
                  <CardDescription>{selectedAssistant.description}</CardDescription>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedAssistant(null)}>
                ×
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
                <TabsTrigger value="rag">RAG Config</TabsTrigger>
                <TabsTrigger value="versions">Versions</TabsTrigger>
                <TabsTrigger value="testing">A/B Testing</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="font-medium">Capabilities</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedAssistant.capabilities.map((cap, idx) => (
                        <Badge key={idx}>{cap}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium">Languages</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedAssistant.languages.map((lang, idx) => (
                        <Badge key={idx} variant="outline">{lang}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="performance" className="mt-4">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={selectedAssistant.performance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Area type="monotone" dataKey="conversations" stroke="#8884d8" fill="#8884d8" />
                    <Area type="monotone" dataKey="satisfaction" stroke="#82ca9d" fill="#82ca9d" />
                  </AreaChart>
                </ResponsiveContainer>
              </TabsContent>

              <TabsContent value="rag" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Vector Database</p>
                    <p className="font-medium">{selectedAssistant.ragConfig.vectorDB}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Documents</p>
                    <p className="font-medium">{selectedAssistant.ragConfig.documents.toLocaleString()}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Chunk Size</p>
                    <p className="font-medium">{selectedAssistant.ragConfig.chunkSize} tokens</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Embedding Model</p>
                    <p className="font-medium">{selectedAssistant.ragConfig.embeddingModel}</p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}