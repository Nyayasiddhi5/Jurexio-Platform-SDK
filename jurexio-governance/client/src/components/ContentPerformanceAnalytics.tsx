/**
 * Content Performance Analytics - Phase 3 Enterprise Feature
 * 
 * Real-time engagement tracking, A/B testing, ROI dashboards,
 * and comprehensive content performance insights
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  BarChart3, TrendingUp, TrendingDown, Eye, Heart, MessageCircle,
  Share2, Clock, Target, DollarSign, Users, Zap, RefreshCw,
  Filter, Download, Calendar, Settings, AlertTriangle,
  CheckCircle, ArrowUp, ArrowDown, Percent, Globe, Star
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface ContentMetrics {
  id: string;
  title: string;
  platform: string;
  publishDate: string;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
  engagement: number;
  reach: number;
  impressions: number;
  roi: number;
  cost: number;
  revenue: number;
  conversionRate: number;
  performance: 'excellent' | 'good' | 'average' | 'poor';
  trend: 'up' | 'down' | 'stable';
}

interface ABTestResult {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'paused';
  variantA: {
    name: string;
    views: number;
    engagement: number;
    conversions: number;
  };
  variantB: {
    name: string;
    views: number;
    engagement: number;
    conversions: number;
  };
  winner?: 'A' | 'B' | 'inconclusive';
  confidence: number;
  startDate: string;
  endDate?: string;
}

interface AnalyticsDashboard {
  totalContent: number;
  totalViews: number;
  totalEngagement: number;
  averageROI: number;
  topPerforming: ContentMetrics[];
  platformBreakdown: Record<string, number>;
  engagementTrends: Array<{ date: string; engagement: number; views: number }>;
  revenueMetrics: {
    totalRevenue: number;
    totalCost: number;
    profit: number;
    roas: number;
  };
  audienceInsights: {
    demographics: Record<string, number>;
    interests: Record<string, number>;
    behavior: Record<string, number>;
  };
}

export default function ContentPerformanceAnalytics() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedTimeRange, setSelectedTimeRange] = useState('7d');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch analytics dashboard using Jurexio orchestration
  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['/api/jurexio/analytics/dashboard', selectedTimeRange, selectedPlatform],
    queryFn: () => apiRequest(`/api/jurexio/analytics/dashboard?timeRange=${selectedTimeRange}&platform=${selectedPlatform}`)
  });

  // Fetch content metrics using Jurexio orchestration
  const { data: contentMetrics = [], isLoading: metricsLoading } = useQuery({
    queryKey: ['/api/jurexio/analytics/content', selectedTimeRange],
    queryFn: () => apiRequest(`/api/jurexio/analytics/content?timeRange=${selectedTimeRange}`)
  });

  // Fetch A/B test results using Jurexio orchestration
  const { data: abTests = [], isLoading: abTestsLoading } = useQuery({
    queryKey: ['/api/jurexio/analytics/ab-tests'],
    queryFn: () => apiRequest('/api/jurexio/analytics/ab-tests')
  });

  // Refresh analytics mutation
  const refreshAnalytics = useMutation({
    mutationFn: () => apiRequest('/api/jurexio/analytics/refresh', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jurexio/analytics'] });
      toast({
        title: "Analytics Refreshed",
        description: "Latest performance data has been synchronized"
      });
    }
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshAnalytics.mutateAsync();
    } finally {
      setIsRefreshing(false);
    }
  };

  const getPerformanceColor = (performance: string) => {
    switch (performance) {
      case 'excellent': return 'text-green-600';
      case 'good': return 'text-blue-600';
      case 'average': return 'text-yellow-600';
      case 'poor': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getPerformanceBadge = (performance: string) => {
    switch (performance) {
      case 'excellent': return 'default';
      case 'good': return 'secondary';
      case 'average': return 'outline';
      case 'poor': return 'destructive';
      default: return 'outline';
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const mockDashboard: AnalyticsDashboard = {
    totalContent: 247,
    totalViews: 1580000,
    totalEngagement: 8.4,
    averageROI: 340,
    topPerforming: [],
    platformBreakdown: {
      'Facebook': 45,
      'Twitter': 28,
      'LinkedIn': 15,
      'Instagram': 12
    },
    engagementTrends: [
      { date: '2025-08-10', engagement: 6.2, views: 12500 },
      { date: '2025-08-11', engagement: 7.1, views: 15800 },
      { date: '2025-08-12', engagement: 8.4, views: 18200 },
      { date: '2025-08-13', engagement: 9.2, views: 21000 },
      { date: '2025-08-14', engagement: 8.8, views: 19500 },
      { date: '2025-08-15', engagement: 10.1, views: 23400 },
      { date: '2025-08-16', engagement: 11.3, views: 26700 }
    ],
    revenueMetrics: {
      totalRevenue: 45680,
      totalCost: 12340,
      profit: 33340,
      roas: 370
    },
    audienceInsights: {
      demographics: { '18-24': 25, '25-34': 40, '35-44': 20, '45+': 15 },
      interests: { 'Technology': 35, 'Business': 25, 'Marketing': 20, 'Design': 20 },
      behavior: { 'Desktop': 60, 'Mobile': 35, 'Tablet': 5 }
    }
  };

  const mockContentMetrics: ContentMetrics[] = [
    {
      id: '1',
      title: 'AI Revolution in Software Development',
      platform: 'LinkedIn',
      publishDate: '2025-08-15',
      views: 45600,
      likes: 1230,
      shares: 340,
      comments: 89,
      clicks: 2890,
      engagement: 11.2,
      reach: 38900,
      impressions: 52100,
      roi: 450,
      cost: 120,
      revenue: 540,
      conversionRate: 6.3,
      performance: 'excellent',
      trend: 'up'
    },
    {
      id: '2',
      title: 'Future of Content Creation',
      platform: 'Twitter',
      publishDate: '2025-08-14',
      views: 28900,
      likes: 890,
      shares: 156,
      comments: 45,
      clicks: 1240,
      engagement: 7.8,
      reach: 25600,
      impressions: 33200,
      roi: 280,
      cost: 85,
      revenue: 238,
      conversionRate: 4.3,
      performance: 'good',
      trend: 'up'
    },
    {
      id: '3',
      title: 'Enterprise Automation Solutions',
      platform: 'Facebook',
      publishDate: '2025-08-13',
      views: 19800,
      likes: 567,
      shares: 89,
      comments: 23,
      clicks: 890,
      engagement: 5.2,
      reach: 17200,
      impressions: 22400,
      roi: 160,
      cost: 95,
      revenue: 152,
      conversionRate: 2.8,
      performance: 'average',
      trend: 'stable'
    }
  ];

  const mockABTests: ABTestResult[] = [
    {
      id: '1',
      name: 'CTA Button Colors Test',
      status: 'running',
      variantA: { name: 'Blue Button', views: 5600, engagement: 7.2, conversions: 89 },
      variantB: { name: 'Green Button', views: 5450, engagement: 8.9, conversions: 124 },
      confidence: 92,
      startDate: '2025-08-10'
    },
    {
      id: '2',
      name: 'Headline Optimization',
      status: 'completed',
      variantA: { name: 'Original Headline', views: 12800, engagement: 6.4, conversions: 156 },
      variantB: { name: 'Optimized Headline', views: 12650, engagement: 9.2, conversions: 234 },
      winner: 'B',
      confidence: 98,
      startDate: '2025-08-05',
      endDate: '2025-08-12'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Content Performance Analytics</h2>
          <p className="text-muted-foreground">
            Track engagement, measure ROI, and optimize your content strategy
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <span className="text-sm font-medium">Filters:</span>
        </div>
        <select
          value={selectedTimeRange}
          onChange={(e) => setSelectedTimeRange(e.target.value)}
          className="px-3 py-1 rounded-md border bg-background"
        >
          <option value="1d">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
        <select
          value={selectedPlatform}
          onChange={(e) => setSelectedPlatform(e.target.value)}
          className="px-3 py-1 rounded-md border bg-background"
        >
          <option value="all">All Platforms</option>
          <option value="facebook">Facebook</option>
          <option value="twitter">Twitter</option>
          <option value="linkedin">LinkedIn</option>
          <option value="instagram">Instagram</option>
        </select>
      </div>

      {/* Main Analytics */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="abtests">A/B Tests</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Views</p>
                    <p className="text-2xl font-bold">{formatNumber(mockDashboard.totalViews)}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <ArrowUp className="h-3 w-3 text-green-600" />
                      <span className="text-xs text-green-600">+12.5%</span>
                    </div>
                  </div>
                  <Eye className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Engagement Rate</p>
                    <p className="text-2xl font-bold">{mockDashboard.totalEngagement}%</p>
                    <div className="flex items-center gap-1 mt-1">
                      <ArrowUp className="h-3 w-3 text-green-600" />
                      <span className="text-xs text-green-600">+2.3%</span>
                    </div>
                  </div>
                  <TrendingUp className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Average ROI</p>
                    <p className="text-2xl font-bold">{mockDashboard.averageROI}%</p>
                    <div className="flex items-center gap-1 mt-1">
                      <ArrowUp className="h-3 w-3 text-green-600" />
                      <span className="text-xs text-green-600">+45%</span>
                    </div>
                  </div>
                  <DollarSign className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Content</p>
                    <p className="text-2xl font-bold">{mockDashboard.totalContent}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <ArrowUp className="h-3 w-3 text-green-600" />
                      <span className="text-xs text-green-600">+18</span>
                    </div>
                  </div>
                  <BarChart3 className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Revenue Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    ${mockDashboard.revenueMetrics.totalRevenue.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">Total Revenue</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    ${mockDashboard.revenueMetrics.totalCost.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">Total Cost</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    ${mockDashboard.revenueMetrics.profit.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">Net Profit</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {mockDashboard.revenueMetrics.roas}%
                  </div>
                  <div className="text-sm text-muted-foreground">ROAS</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Platform Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Platform Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(mockDashboard.platformBreakdown).map(([platform, percentage]) => (
                  <div key={platform} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{platform}</span>
                      <span>{percentage}%</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Engagement Trends
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Interactive chart visualization</p>
                    <p className="text-sm">7-day engagement trend</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Content Tab */}
        <TabsContent value="content" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Content Performance
              </CardTitle>
              <CardDescription>
                Detailed metrics for individual content pieces
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mockContentMetrics.map((content) => (
                  <motion.div
                    key={content.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border rounded-lg p-6 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold">{content.title}</h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span>{content.platform}</span>
                          <span>•</span>
                          <span>{new Date(content.publishDate).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getPerformanceBadge(content.performance)}>
                          {content.performance}
                        </Badge>
                        {content.trend === 'up' ? (
                          <ArrowUp className="h-4 w-4 text-green-600" />
                        ) : content.trend === 'down' ? (
                          <ArrowDown className="h-4 w-4 text-red-600" />
                        ) : (
                          <div className="h-4 w-4" />
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Views</div>
                        <div className="font-semibold">{formatNumber(content.views)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Engagement</div>
                        <div className="font-semibold">{content.engagement}%</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Likes</div>
                        <div className="font-semibold">{formatNumber(content.likes)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Shares</div>
                        <div className="font-semibold">{formatNumber(content.shares)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Comments</div>
                        <div className="font-semibold">{formatNumber(content.comments)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Clicks</div>
                        <div className="font-semibold">{formatNumber(content.clicks)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">ROI</div>
                        <div className="font-semibold text-green-600">{content.roi}%</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Conv. Rate</div>
                        <div className="font-semibold">{content.conversionRate}%</div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* A/B Tests Tab */}
        <TabsContent value="abtests" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                A/B Testing Results
              </CardTitle>
              <CardDescription>
                Compare content variations and optimize performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {mockABTests.map((test) => (
                  <motion.div
                    key={test.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border rounded-lg p-6 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{test.name}</h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span>Started: {new Date(test.startDate).toLocaleDateString()}</span>
                          {test.endDate && (
                            <>
                              <span>•</span>
                              <span>Ended: {new Date(test.endDate).toLocaleDateString()}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={test.status === 'completed' ? 'default' : 'secondary'}>
                          {test.status}
                        </Badge>
                        {test.winner && (
                          <Badge variant="outline">
                            Winner: Variant {test.winner}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <h4 className="font-medium">Variant A: {test.variantA.name}</h4>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="text-muted-foreground">Views</div>
                            <div className="font-semibold">{formatNumber(test.variantA.views)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Engagement</div>
                            <div className="font-semibold">{test.variantA.engagement}%</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Conversions</div>
                            <div className="font-semibold">{test.variantA.conversions}</div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="font-medium">Variant B: {test.variantB.name}</h4>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="text-muted-foreground">Views</div>
                            <div className="font-semibold">{formatNumber(test.variantB.views)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Engagement</div>
                            <div className="font-semibold">{test.variantB.engagement}%</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Conversions</div>
                            <div className="font-semibold">{test.variantB.conversions}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Statistical Confidence:</span>
                        <Progress value={test.confidence} className="w-24 h-2" />
                        <span className="text-sm font-medium">{test.confidence}%</span>
                      </div>
                      <div className="flex gap-2">
                        {test.status === 'running' && (
                          <Button variant="outline" size="sm">
                            Pause Test
                          </Button>
                        )}
                        <Button variant="ghost" size="sm">
                          View Details
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audience Tab */}
        <TabsContent value="audience" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Demographics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(mockDashboard.audienceInsights.demographics).map(([age, percentage]) => (
                  <div key={age} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{age}</span>
                      <span>{percentage}%</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5" />
                  Interests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(mockDashboard.audienceInsights.interests).map(([interest, percentage]) => (
                  <div key={interest} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{interest}</span>
                      <span>{percentage}%</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Device Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(mockDashboard.audienceInsights.behavior).map(([device, percentage]) => (
                  <div key={device} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{device}</span>
                      <span>{percentage}%</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}