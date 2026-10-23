/**
 * Global Optimization Dashboard - Phase 4
 * 
 * Real-time performance monitoring, global infrastructure status,
 * and optimization recommendations for enterprise production deployment
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Activity, Globe, Zap, Database, Server, Cloud, Monitor,
  TrendingUp, AlertTriangle, CheckCircle, BarChart3, Cpu,
  Gauge, Network, Shield, Layers, MapPin, Clock, Settings
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface PerformanceMetrics {
  system: {
    uptime: number;
    memory: any;
    cpu: any;
    nodeVersion: string;
    platform: string;
  };
  application: {
    totalRequests: number;
    averageResponseTime: number;
    errorRate: string;
    throughput: number;
    activeConnections: number;
  };
  database: {
    connectionPoolSize: number;
    activeConnections: number;
    queryTime: number;
    slowQueries: number;
    cacheHitRate: string;
  };
  platforms: Record<string, {
    status: string;
    responseTime: number;
    users: number;
  }>;
  global: {
    regions: string[];
    globalLatency: number;
    cdnPerformance: number;
    edgeConnections: number;
  };
}

interface CacheStatus {
  redis: {
    status: string;
    memory: string;
    keys: number;
    hitRate: number;
    missRate: number;
    evictions: number;
  };
  application: {
    lmCache: any;
    apiCache: any;
  };
  cdn: {
    provider: string;
    regions: number;
    hitRate: number;
    bandwidth: string;
    requests: string;
  };
}

interface GlobalInfrastructure {
  regions: Array<{
    name: string;
    code: string;
    status: string;
    latency: number;
    users: number;
    load: number;
  }>;
  kubernetes: {
    clusters: number;
    nodes: number;
    pods: number;
    services: number;
    deployments: number;
    health: string;
  };
  loadBalancing: {
    algorithm: string;
    healthChecks: string;
    autoScaling: string;
    maxInstances: number;
    currentInstances: number;
  };
}

export default function GlobalOptimizationDashboard() {
  const [activeTab, setActiveTab] = useState('performance');
  const [refreshInterval, setRefreshInterval] = useState(30000); // 30 seconds

  // Fetch performance metrics
  const { data: performanceData, isLoading: isLoadingPerformance } = useQuery({
    queryKey: ['/api/global-optimization/performance/metrics'],
    refetchInterval: refreshInterval
  });

  // Fetch cache status
  const { data: cacheData, isLoading: isLoadingCache } = useQuery({
    queryKey: ['/api/global-optimization/cache/status'],
    refetchInterval: refreshInterval
  });

  // Fetch infrastructure status
  const { data: infrastructureData, isLoading: isLoadingInfrastructure } = useQuery({
    queryKey: ['/api/global-optimization/infrastructure/global'],
    refetchInterval: refreshInterval
  });

  // Fetch bundle optimization data
  const { data: bundleData, isLoading: isLoadingBundles } = useQuery({
    queryKey: ['/api/global-optimization/optimization/bundles']
  });

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'healthy':
      case 'excellent':
      case 'connected':
        return 'text-green-600';
      case 'warning':
        return 'text-yellow-600';
      case 'error':
      case 'critical':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusBadge = (status: string) => {
    const color = status === 'healthy' || status === 'excellent' ? 'bg-green-100 text-green-800' :
                  status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-800';
    
    return <Badge className={color}>{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Globe className="h-8 w-8 text-blue-600" />
              Global Optimization Dashboard
            </h1>
            <p className="text-gray-600 mt-2">
              Real-time performance monitoring and global infrastructure status
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => setRefreshInterval(refreshInterval === 5000 ? 30000 : 5000)}
            >
              <Clock className="h-4 w-4 mr-2" />
              {refreshInterval === 5000 ? 'Real-time' : 'Auto-refresh'}
            </Button>
            <Badge className="bg-green-100 text-green-800">
              <Activity className="h-3 w-3 mr-1" />
              System Healthy
            </Badge>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="performance" className="flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="cache" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Cache & Speed
            </TabsTrigger>
            <TabsTrigger value="infrastructure" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Infrastructure
            </TabsTrigger>
            <TabsTrigger value="optimization" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Optimization
            </TabsTrigger>
            <TabsTrigger value="monitoring" className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Monitoring
            </TabsTrigger>
          </TabsList>

          {/* Performance Tab */}
          <TabsContent value="performance" className="space-y-6">
            {isLoadingPerformance ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* System Metrics */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-blue-600" />
                      System Health
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Uptime</span>
                        <span className="font-medium">
                          {performanceData?.metrics ? formatUptime(performanceData.metrics.system.uptime) : '--'}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-2">
                        <span>Memory</span>
                        <span className="font-medium">
                          {performanceData?.metrics ? formatMemory(performanceData.metrics.system.memory.rss) : '--'}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Application Metrics */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Activity className="h-4 w-4 text-green-600" />
                      Application
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Avg Response</span>
                        <span className="font-medium text-green-600">
                          {performanceData?.metrics?.application.averageResponseTime}ms
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-2">
                        <span>Error Rate</span>
                        <span className="font-medium">
                          {performanceData?.metrics?.application.errorRate}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Database Metrics */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Database className="h-4 w-4 text-purple-600" />
                      Database
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Query Time</span>
                        <span className="font-medium">
                          {performanceData?.metrics?.database.queryTime}ms
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-2">
                        <span>Cache Hit</span>
                        <span className="font-medium text-green-600">
                          {(parseFloat(performanceData?.metrics?.database.cacheHitRate || '0') * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Global Metrics */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Globe className="h-4 w-4 text-blue-600" />
                      Global
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Regions</span>
                        <span className="font-medium">
                          {performanceData?.metrics?.global.regions.length || 0}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-2">
                        <span>Global Latency</span>
                        <span className="font-medium text-green-600">
                          {performanceData?.metrics?.global.globalLatency}ms
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Platform Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-blue-600" />
                  Platform Performance Status
                </CardTitle>
                <CardDescription>
                  Real-time status and performance metrics for all 5 platforms
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {performanceData?.metrics?.platforms && Object.entries(performanceData.metrics.platforms).map(([platform, data]: [string, any]) => (
                    <div key={platform} className="border rounded-lg p-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="font-medium capitalize">
                          {platform.replace(/([A-Z])/g, ' $1').trim()}
                        </h4>
                        {getStatusBadge(data.status)}
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Response Time</span>
                          <span className="font-medium">{data.responseTime}ms</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Active Users</span>
                          <span className="font-medium">{data.users.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cache Tab */}
          <TabsContent value="cache" className="space-y-6">
            {isLoadingCache ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Redis Cache */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5 text-red-600" />
                      Redis Cache
                    </CardTitle>
                    <CardDescription>
                      Primary caching layer performance
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span>Status</span>
                      {getStatusBadge(cacheData?.cache?.redis?.status || 'unknown')}
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Memory Usage</span>
                        <span className="font-medium">{cacheData?.cache?.redis?.memory}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Total Keys</span>
                        <span className="font-medium">{cacheData?.cache?.redis?.keys?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Hit Rate</span>
                        <span className="font-medium text-green-600">
                          {(cacheData?.cache?.redis?.hitRate * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* LM Cache */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-yellow-600" />
                      LM Cache
                    </CardTitle>
                    <CardDescription>
                      Language model response caching
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span>Status</span>
                      <Badge className="bg-green-100 text-green-800">
                        {cacheData?.cache?.application?.lmCache?.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Cache Size</span>
                        <span className="font-medium">{cacheData?.cache?.application?.lmCache?.size}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Entries</span>
                        <span className="font-medium">{cacheData?.cache?.application?.lmCache?.entries?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Avg Savings</span>
                        <span className="font-medium text-green-600">
                          {cacheData?.cache?.application?.lmCache?.avgSavingTime}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* CDN Performance */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Cloud className="h-5 w-5 text-blue-600" />
                      CDN Performance
                    </CardTitle>
                    <CardDescription>
                      Global content delivery network
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span>Provider</span>
                      <Badge>{cacheData?.cache?.cdn?.provider}</Badge>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Global Regions</span>
                        <span className="font-medium">{cacheData?.cache?.cdn?.regions}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Hit Rate</span>
                        <span className="font-medium text-green-600">
                          {(cacheData?.cache?.cdn?.hitRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Bandwidth</span>
                        <span className="font-medium">{cacheData?.cache?.cdn?.bandwidth}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Infrastructure Tab */}
          <TabsContent value="infrastructure" className="space-y-6">
            {isLoadingInfrastructure ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <>
                {/* Global Regions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-blue-600" />
                      Global Regions
                    </CardTitle>
                    <CardDescription>
                      Multi-region deployment status and performance
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {infrastructureData?.infrastructure?.regions?.map((region: any) => (
                        <div key={region.code} className="border rounded-lg p-4">
                          <div className="flex justify-between items-center mb-3">
                            <h4 className="font-medium">{region.name}</h4>
                            {getStatusBadge(region.status)}
                          </div>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span>Latency</span>
                              <span className="font-medium text-green-600">{region.latency}ms</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Active Users</span>
                              <span className="font-medium">{region.users.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Load</span>
                              <span className="font-medium">{region.load}%</span>
                            </div>
                            <Progress value={region.load} className="mt-2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Kubernetes Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5 text-purple-600" />
                        Kubernetes Cluster
                      </CardTitle>
                      <CardDescription>
                        Container orchestration status
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-600">
                            {infrastructureData?.infrastructure?.kubernetes?.clusters}
                          </div>
                          <div className="text-sm text-gray-600">Clusters</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">
                            {infrastructureData?.infrastructure?.kubernetes?.nodes}
                          </div>
                          <div className="text-sm text-gray-600">Nodes</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-purple-600">
                            {infrastructureData?.infrastructure?.kubernetes?.pods}
                          </div>
                          <div className="text-sm text-gray-600">Pods</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-orange-600">
                            {infrastructureData?.infrastructure?.kubernetes?.services}
                          </div>
                          <div className="text-sm text-gray-600">Services</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Network className="h-5 w-5 text-green-600" />
                        Load Balancing
                      </CardTitle>
                      <CardDescription>
                        Traffic distribution and scaling
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span>Algorithm</span>
                          <Badge>{infrastructureData?.infrastructure?.loadBalancing?.algorithm}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Health Checks</span>
                          <Badge className="bg-green-100 text-green-800">
                            {infrastructureData?.infrastructure?.loadBalancing?.healthChecks}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Auto Scaling</span>
                          <Badge className="bg-blue-100 text-blue-800">
                            {infrastructureData?.infrastructure?.loadBalancing?.autoScaling}
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Current Instances</span>
                            <span className="font-medium">
                              {infrastructureData?.infrastructure?.loadBalancing?.currentInstances}/
                              {infrastructureData?.infrastructure?.loadBalancing?.maxInstances}
                            </span>
                          </div>
                          <Progress 
                            value={(infrastructureData?.infrastructure?.loadBalancing?.currentInstances / infrastructureData?.infrastructure?.loadBalancing?.maxInstances) * 100} 
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          {/* Bundle Optimization Tab */}
          <TabsContent value="optimization" className="space-y-6">
            {isLoadingBundles ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Layers className="h-5 w-5 text-blue-600" />
                      Bundle Analysis
                    </CardTitle>
                    <CardDescription>
                      JavaScript bundle optimization and recommendations
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center p-4 bg-blue-50 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">
                          {bundleData?.bundles?.mainBundle?.size}
                        </div>
                        <div className="text-sm text-gray-600">Total Size</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {bundleData?.bundles?.mainBundle?.gzipped} gzipped
                        </div>
                      </div>
                      <div className="text-center p-4 bg-green-50 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">
                          {bundleData?.bundles?.mainBundle?.modules}
                        </div>
                        <div className="text-sm text-gray-600">Modules</div>
                      </div>
                      <div className="text-center p-4 bg-purple-50 rounded-lg">
                        <div className="text-2xl font-bold text-purple-600">
                          {bundleData?.bundles?.chunkAnalysis?.length}
                        </div>
                        <div className="text-sm text-gray-600">Chunks</div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-3">Chunk Analysis</h4>
                      <div className="space-y-2">
                        {bundleData?.bundles?.chunkAnalysis?.map((chunk: any, index: number) => (
                          <div key={index} className="flex justify-between items-center p-3 border rounded-lg">
                            <div className="flex items-center gap-3">
                              <div className="font-medium">{chunk.name}</div>
                              {chunk.critical && (
                                <Badge className="bg-orange-100 text-orange-800">Critical</Badge>
                              )}
                            </div>
                            <div className="text-sm font-medium">{chunk.size}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-3">Optimization Recommendations</h4>
                      <div className="space-y-2">
                        {bundleData?.bundles?.mainBundle?.recommendations?.map((rec: string, index: number) => (
                          <div key={index} className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg">
                            <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                            <span className="text-sm">{rec}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Monitoring Tab */}
          <TabsContent value="monitoring" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                  System Monitoring Overview
                </CardTitle>
                <CardDescription>
                  Comprehensive platform monitoring and alerting
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="text-center p-4 border rounded-lg">
                    <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
                    <div className="font-medium">All Systems</div>
                    <div className="text-sm text-gray-600">Operational</div>
                  </div>
                  <div className="text-center p-4 border rounded-lg">
                    <Shield className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                    <div className="font-medium">Security</div>
                    <div className="text-sm text-gray-600">Protected</div>
                  </div>
                  <div className="text-center p-4 border rounded-lg">
                    <TrendingUp className="h-8 w-8 text-green-600 mx-auto mb-2" />
                    <div className="font-medium">Performance</div>
                    <div className="text-sm text-gray-600">Excellent</div>
                  </div>
                  <div className="text-center p-4 border rounded-lg">
                    <Globe className="h-8 w-8 text-purple-600 mx-auto mb-2" />
                    <div className="font-medium">Global</div>
                    <div className="text-sm text-gray-600">3 Regions</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}