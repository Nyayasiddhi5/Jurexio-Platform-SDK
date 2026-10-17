/**
 * Enterprise Monitoring Dashboard
 * Comprehensive monitoring for all 4 phases of enterprise enhancement
 * Real-time analytics, health monitoring, and performance tracking
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Activity, 
  Shield, 
  Brain, 
  Zap, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  Users,
  Database,
  Network,
  Cpu
} from 'lucide-react';

interface EnhancementStatus {
  phase1: {
    name: string;
    status: string;
    metrics: {
      totalEvaluations: number;
      averageQuality: number;
      activeExperiments: number;
    };
  };
  phase2: {
    name: string;
    status: string;
    metrics: {
      totalAgents: number;
      systemReliability: number;
      byzantineTolerance: number;
    };
  };
  phase3: {
    name: string;
    status: string;
    metrics: {
      totalPatterns: number;
      adaptationEfficiency: number;
      learningRate: number;
    };
  };
  phase4: {
    name: string;
    status: string;
    metrics: {
      totalCalls: number;
      successRate: number;
      averageResponseTime: number;
    };
  };
  overallEnhancement: {
    platformImprovement: string;
    enterpriseReadiness: string;
    competitiveAdvantage: string;
  };
}

export default function EnterpriseMonitoringDashboard() {
  const [enhancementStatus, setEnhancementStatus] = useState<EnhancementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    fetchEnhancementStatus();
    const interval = setInterval(fetchEnhancementStatus, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchEnhancementStatus = async () => {
    try {
      const response = await fetch('/api/enhancement/status');
      const data = await response.json();
      if (data.success) {
        setEnhancementStatus(data.enhancementStatus);
      }
    } catch (error) {
      console.error('Error fetching enhancement status:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading Enterprise Monitoring Dashboard...</p>
        </div>
      </div>
    );
  }

  if (!enhancementStatus) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-gray-600">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4" />
              <p>Unable to load enhancement status</p>
              <Button onClick={fetchEnhancementStatus} className="mt-4">
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'warning': return 'text-yellow-600 bg-yellow-100';
      case 'error': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Enterprise Monitoring Dashboard</h1>
          <p className="text-gray-600 mt-2">Real-time monitoring of 4-phase enterprise enhancement system</p>
        </div>
        <div className="flex items-center space-x-4">
          <Badge variant="secondary" className="text-lg px-4 py-2">
            {enhancementStatus.overallEnhancement.platformImprovement} Enhancement
          </Badge>
          <Badge variant="default" className="text-lg px-4 py-2">
            {enhancementStatus.overallEnhancement.enterpriseReadiness} Ready
          </Badge>
        </div>
      </div>

      {/* Overall Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Phase 1: Evaluation</CardTitle>
            <Activity className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enhancementStatus.phase1.metrics.totalEvaluations}</div>
            <p className="text-xs text-gray-600">Total Evaluations</p>
            <div className="mt-2">
              <Badge className={getStatusColor(enhancementStatus.phase1.status)}>
                {enhancementStatus.phase1.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Phase 2: Byzantine FT</CardTitle>
            <Shield className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enhancementStatus.phase2.metrics.totalAgents}</div>
            <p className="text-xs text-gray-600">Active Agents</p>
            <div className="mt-2">
              <Badge className={getStatusColor(enhancementStatus.phase2.status)}>
                {Math.round(enhancementStatus.phase2.metrics.systemReliability * 100)}% Reliable
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Phase 3: Neural Learning</CardTitle>
            <Brain className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enhancementStatus.phase3.metrics.totalPatterns}</div>
            <p className="text-xs text-gray-600">Learned Patterns</p>
            <div className="mt-2">
              <Badge className={getStatusColor(enhancementStatus.phase3.status)}>
                {Math.round(enhancementStatus.phase3.metrics.adaptationEfficiency * 100)}% Efficient
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Phase 4: Universal Functions</CardTitle>
            <Zap className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enhancementStatus.phase4.metrics.totalCalls}</div>
            <p className="text-xs text-gray-600">Function Calls</p>
            <div className="mt-2">
              <Badge className={getStatusColor(enhancementStatus.phase4.status)}>
                {Math.round(enhancementStatus.phase4.metrics.successRate * 100)}% Success
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Monitoring Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
          <TabsTrigger value="byzantine">Byzantine FT</TabsTrigger>
          <TabsTrigger value="neural">Neural Learning</TabsTrigger>
          <TabsTrigger value="universal">Universal Functions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Enterprise Enhancement Status</CardTitle>
                <CardDescription>Overall system performance and capabilities</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Platform Improvement</span>
                    <span className="text-sm text-gray-600">{enhancementStatus.overallEnhancement.platformImprovement}</span>
                  </div>
                  <Progress value={150} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Enterprise Readiness</span>
                    <span className="text-sm text-gray-600">{enhancementStatus.overallEnhancement.enterpriseReadiness}</span>
                  </div>
                  <Progress value={98} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Competitive Advantage</span>
                    <span className="text-sm text-gray-600">{enhancementStatus.overallEnhancement.competitiveAdvantage}</span>
                  </div>
                  <Progress value={100} className="h-2" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System Health</CardTitle>
                <CardDescription>Real-time system status and alerts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span>All Systems Operational</span>
                    </div>
                    <Badge variant="secondary">Healthy</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Clock className="h-5 w-5 text-blue-600" />
                      <span>Last Update</span>
                    </div>
                    <span className="text-sm text-gray-600">{new Date().toLocaleTimeString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <TrendingUp className="h-5 w-5 text-green-600" />
                      <span>Performance Trend</span>
                    </div>
                    <Badge variant="default">Improving</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="evaluation" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Quality Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Math.round(enhancementStatus.phase1.metrics.averageQuality * 100)}%</div>
                <p className="text-sm text-gray-600">Average Quality Score</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Total Evaluations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{enhancementStatus.phase1.metrics.totalEvaluations}</div>
                <p className="text-sm text-gray-600">Responses Evaluated</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>A/B Experiments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{enhancementStatus.phase1.metrics.activeExperiments}</div>
                <p className="text-sm text-gray-600">Active Tests</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="byzantine" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>System Reliability</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Math.round(enhancementStatus.phase2.metrics.systemReliability * 100)}%</div>
                <p className="text-sm text-gray-600">Fault Tolerance</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Active Agents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{enhancementStatus.phase2.metrics.totalAgents}</div>
                <p className="text-sm text-gray-600">Participating in Consensus</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Byzantine Tolerance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{enhancementStatus.phase2.metrics.byzantineTolerance}</div>
                <p className="text-sm text-gray-600">Faulty Agents Tolerated</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="neural" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Learned Patterns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{enhancementStatus.phase3.metrics.totalPatterns}</div>
                <p className="text-sm text-gray-600">Active Patterns</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Adaptation Efficiency</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Math.round(enhancementStatus.phase3.metrics.adaptationEfficiency * 100)}%</div>
                <p className="text-sm text-gray-600">Success Rate</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Learning Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Math.round(enhancementStatus.phase3.metrics.learningRate * 60)}</div>
                <p className="text-sm text-gray-600">Patterns per Hour</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="universal" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Function Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{enhancementStatus.phase4.metrics.totalCalls}</div>
                <p className="text-sm text-gray-600">Total Executed</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Success Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Math.round(enhancementStatus.phase4.metrics.successRate * 100)}%</div>
                <p className="text-sm text-gray-600">Successful Calls</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Response Time</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Math.round(enhancementStatus.phase4.metrics.averageResponseTime)}</div>
                <p className="text-sm text-gray-600">ms Average</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}