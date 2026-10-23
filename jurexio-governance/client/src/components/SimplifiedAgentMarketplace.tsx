/**
 * Simplified Agent Marketplace
 * Inspired by Claude Code Subagents Collection
 * Features domain-specific agents with .md-style definitions
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Search, Rocket, Users, Code, Gamepad2, Coins, Presentation, Brain, Zap } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface SimplifiedAgent {
  name: string;
  role: string;
  description: string;
  expertise: string[];
  instructions: string;
  tools: string[];
  examples: string[];
  category: 'development' | 'crypto' | 'gaming' | 'design' | 'business' | 'research' | 'testing' | 'devops';
}

interface AgentMarketplaceStats {
  totalAgents: number;
  categories: number;
  agentsByCategory: Array<{
    category: string;
    count: number;
    agents: Array<{ name: string; role: string }>;
  }>;
}

const categoryIcons: Record<string, any> = {
  development: Code,
  crypto: Coins,
  gaming: Gamepad2,
  design: Presentation,
  business: Users,
  research: Brain,
  testing: Zap,
  devops: Rocket
};

const categoryColors: Record<string, string> = {
  development: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  crypto: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  gaming: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  design: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
  business: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  research: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
  testing: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  devops: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
};

export default function SimplifiedAgentMarketplace() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedAgent, setSelectedAgent] = useState<SimplifiedAgent | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [contextInput, setContextInput] = useState('');
  const [executionResult, setExecutionResult] = useState<any>(null);
  
  const queryClient = useQueryClient();

  // Fetch all agents
  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['/api/simplified-agents/agents'],
    staleTime: 5 * 60 * 1000 // 5 minutes
  });

  // Fetch marketplace stats
  const { data: statsData } = useQuery({
    queryKey: ['/api/simplified-agents/marketplace/stats'],
    staleTime: 10 * 60 * 1000 // 10 minutes
  });

  // Search agents
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['/api/simplified-agents/agents/search', searchQuery],
    enabled: searchQuery.length > 0,
    staleTime: 2 * 60 * 1000 // 2 minutes
  });

  // Execute agent task
  const executeTaskMutation = useMutation({
    mutationFn: async ({ agentName, task, context }: { agentName: string; task: string; context?: string }) => {
      return apiRequest(`/api/simplified-agents/agents/${agentName}/execute`, {
        method: 'POST',
        body: JSON.stringify({ task, context }),
        headers: { 'Content-Type': 'application/json' }
      });
    },
    onSuccess: (data: any) => {
      setExecutionResult(data);
    }
  });

  // Get recommendation
  const getRecommendationMutation = useMutation({
    mutationFn: async (taskDescription: string) => {
      return apiRequest('/api/simplified-agents/agents/recommend', {
        method: 'POST',
        body: JSON.stringify({ taskDescription }),
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const allAgents = (agentsData as any)?.data?.allAgents || [];
  const agentsByCategory = (agentsData as any)?.data?.agentsByCategory || {};
  const stats = (statsData as any)?.data as AgentMarketplaceStats;

  // Filter agents based on search and category
  const filteredAgents = searchQuery 
    ? ((searchResults as any)?.data?.agents || [])
    : selectedCategory === 'all' 
    ? allAgents 
    : agentsByCategory[selectedCategory] || [];

  const handleExecuteTask = () => {
    if (!selectedAgent || !taskInput.trim()) return;
    
    executeTaskMutation.mutate({
      agentName: selectedAgent.name,
      task: taskInput,
      context: contextInput
    });
  };

  const handleGetRecommendation = () => {
    if (!taskInput.trim()) return;
    
    getRecommendationMutation.mutate(taskInput);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
          Simplified Agent Marketplace
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Discover and use specialized AI agents inspired by the Claude subagents collection.
          Easy .md-style definitions for community contribution.
        </p>
        
        {/* Marketplace Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{stats.totalAgents}</div>
                <div className="text-sm text-gray-600">Total Agents</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{stats.categories}</div>
                <div className="text-sm text-gray-600">Categories</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-purple-600">∞</div>
                <div className="text-sm text-gray-600">Possibilities</div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search agents by name, role, or expertise..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="development">Development</SelectItem>
            <SelectItem value="crypto">Crypto & DeFi</SelectItem>
            <SelectItem value="gaming">Gaming</SelectItem>
            <SelectItem value="business">Business</SelectItem>
            <SelectItem value="research">Research</SelectItem>
            <SelectItem value="testing">Testing</SelectItem>
            <SelectItem value="devops">DevOps</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleGetRecommendation} disabled={!taskInput.trim()}>
          Get Recommendation
        </Button>
      </div>

      {/* Quick Task Input for Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Agent Recommendation</CardTitle>
          <CardDescription>
            Describe your task and get agent recommendations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="e.g., 'Build a DeFi trading bot' or 'Optimize React performance'"
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              className="flex-1"
            />
            <Button 
              onClick={handleGetRecommendation} 
              disabled={!taskInput.trim() || getRecommendationMutation.isPending}
            >
              {getRecommendationMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Recommend
            </Button>
          </div>
          
          {/* Recommendation Results */}
          {getRecommendationMutation.data && (
            <div className="mt-4 space-y-2">
              <h4 className="font-semibold">Recommended Agents:</h4>
              {((getRecommendationMutation.data as any).data.recommendations || []).map((rec: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <span className="font-medium">{rec.name}</span>
                    <span className="text-sm text-gray-600 ml-2">({rec.role})</span>
                    <div className="text-xs text-gray-500">Score: {rec.relevanceScore}</div>
                  </div>
                  <Button size="sm" onClick={() => {
                    const agent = allAgents.find((a: SimplifiedAgent) => a.name === rec.name);
                    if (agent) setSelectedAgent(agent);
                  }}>
                    Select
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agents Grid */}
      <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
        <TabsList className="grid w-full grid-cols-4 md:grid-cols-8">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="development">Dev</TabsTrigger>
          <TabsTrigger value="crypto">Crypto</TabsTrigger>
          <TabsTrigger value="gaming">Gaming</TabsTrigger>
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
          <TabsTrigger value="testing">Testing</TabsTrigger>
          <TabsTrigger value="devops">DevOps</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedCategory} className="mt-6">
          {agentsLoading || searchLoading ? (
            <div className="flex justify-center items-center h-32">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAgents.map((agent: SimplifiedAgent) => {
                const IconComponent = categoryIcons[agent.category];
                return (
                  <Card key={agent.name} className="hover:shadow-lg transition-shadow cursor-pointer">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <IconComponent className="h-5 w-5 text-blue-600" />
                          <CardTitle className="text-lg">{agent.role}</CardTitle>
                        </div>
                        <Badge className={categoryColors[agent.category]}>
                          {agent.category}
                        </Badge>
                      </div>
                      <CardDescription className="text-sm">
                        {agent.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-semibold text-sm mb-1">Expertise:</h4>
                          <div className="flex flex-wrap gap-1">
                            {agent.expertise.slice(0, 3).map((skill, index) => (
                              <Badge key={index} variant="outline" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                            {agent.expertise.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{agent.expertise.length - 3} more
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        <div>
                          <h4 className="font-semibold text-sm mb-1">Tools:</h4>
                          <div className="text-xs text-gray-600">
                            {agent.tools.slice(0, 2).join(', ')}
                            {agent.tools.length > 2 && ` +${agent.tools.length - 2} more`}
                          </div>
                        </div>

                        <Dialog>
                          <DialogTrigger asChild>
                            <Button 
                              className="w-full" 
                              onClick={() => setSelectedAgent(agent)}
                            >
                              Use Agent
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <IconComponent className="h-5 w-5" />
                                {agent.role}
                              </DialogTitle>
                              <DialogDescription>
                                {agent.description}
                              </DialogDescription>
                            </DialogHeader>
                            
                            <div className="space-y-4">
                              {/* Agent Details */}
                              <Tabs defaultValue="details">
                                <TabsList>
                                  <TabsTrigger value="details">Details</TabsTrigger>
                                  <TabsTrigger value="examples">Examples</TabsTrigger>
                                  <TabsTrigger value="execute">Execute Task</TabsTrigger>
                                </TabsList>
                                
                                <TabsContent value="details" className="space-y-4">
                                  <div>
                                    <h4 className="font-semibold mb-2">Instructions:</h4>
                                    <p className="text-sm text-gray-600 bg-gray-50 dark:bg-gray-800 p-3 rounded">
                                      {agent.instructions}
                                    </p>
                                  </div>
                                  
                                  <div>
                                    <h4 className="font-semibold mb-2">Expertise Areas:</h4>
                                    <div className="flex flex-wrap gap-2">
                                      {agent.expertise.map((skill, index) => (
                                        <Badge key={index} variant="outline">
                                          {skill}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                  
                                  <div>
                                    <h4 className="font-semibold mb-2">Available Tools:</h4>
                                    <div className="flex flex-wrap gap-2">
                                      {agent.tools.map((tool, index) => (
                                        <Badge key={index} variant="secondary">
                                          {tool}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                </TabsContent>
                                
                                <TabsContent value="examples" className="space-y-2">
                                  <h4 className="font-semibold">Example Tasks:</h4>
                                  {agent.examples.map((example, index) => (
                                    <div key={index} className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded border-l-4 border-blue-500">
                                      <p className="text-sm">{example}</p>
                                      <Button 
                                        size="sm" 
                                        variant="outline" 
                                        className="mt-2"
                                        onClick={() => setTaskInput(example)}
                                      >
                                        Use This Example
                                      </Button>
                                    </div>
                                  ))}
                                </TabsContent>
                                
                                <TabsContent value="execute" className="space-y-4">
                                  <div>
                                    <label className="text-sm font-medium">Task Description:</label>
                                    <Textarea
                                      placeholder="Describe your task in detail..."
                                      value={taskInput}
                                      onChange={(e) => setTaskInput(e.target.value)}
                                      className="mt-1"
                                      rows={3}
                                    />
                                  </div>
                                  
                                  <div>
                                    <label className="text-sm font-medium">Additional Context (Optional):</label>
                                    <Textarea
                                      placeholder="Provide any additional context or requirements..."
                                      value={contextInput}
                                      onChange={(e) => setContextInput(e.target.value)}
                                      className="mt-1"
                                      rows={2}
                                    />
                                  </div>
                                  
                                  <Button 
                                    onClick={handleExecuteTask}
                                    disabled={!taskInput.trim() || executeTaskMutation.isPending}
                                    className="w-full"
                                  >
                                    {executeTaskMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Execute Task with {agent.role}
                                  </Button>
                                  
                                  {/* Execution Result */}
                                  {executionResult && (
                                    <Alert>
                                      <AlertDescription>
                                        <div className="space-y-2">
                                          <h4 className="font-semibold">Result from {executionResult.data.agentRole}:</h4>
                                          <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
                                            {executionResult.data.result}
                                          </div>
                                          <div className="text-xs text-gray-500">
                                            Provider: {executionResult.data.provider} | 
                                            Duration: {executionResult.data.duration}ms
                                            {executionResult.data.cost && ` | Cost: $${executionResult.data.cost}`}
                                          </div>
                                        </div>
                                      </AlertDescription>
                                    </Alert>
                                  )}
                                </TabsContent>
                              </Tabs>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}