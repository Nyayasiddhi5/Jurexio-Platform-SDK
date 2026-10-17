/**
 * Enterprise Analytics Dashboard - Advanced Business Intelligence
 * 
 * Real-time analytics with AI-powered insights for enterprise decision making
 * Comprehensive metrics across all platforms with predictive analytics
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart, LineChart, PieChart, TrendingUp, TrendingDown,
  Users, DollarSign, Activity, Target, Brain, Zap,
  Calendar, Filter, Download, Share2, AlertCircle,
  CheckCircle, Clock, Globe, Smartphone, Monitor
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface AnalyticsMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  changePercent: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string;
    borderColor?: string;
    fill?: boolean;
  }>;
}

interface PlatformPerformance {
  platform: string;
  users: number;
  revenue: number;
  engagement: number;
  satisfaction: number;
  growth: number;
}

export default function EnterpriseAnalyticsDashboard() {
  const [selectedTimeRange, setSelectedTimeRange] = useState('7d');
  const [isLoading, setIsLoading] = useState(false);
  const [metrics, setMetrics] = useState<AnalyticsMetric[]>([]);
  const [platformData, setPlatformData] = useState<PlatformPerformance[]>([]);

  // Sample enterprise metrics
  const enterpriseMetrics: AnalyticsMetric[] = [
    {
      id: 'total-revenue',
      name: 'Total Revenue',
      value: 2_847_293,
      previousValue: 2_634_182,
      unit: 'USD',
      trend: 'up',
      changePercent: 8.1,
      icon: DollarSign,
      color: 'text-green-600'
    },
    {
      id: 'active-users',
      name: 'Active Users',
      value: 45_623,
      previousValue: 42_891,
      unit: 'users',
      trend: 'up',
      changePercent: 6.4,
      icon: Users,
      color: 'text-blue-600'
    },
    {
      id: 'engagement-rate',
      name: 'Engagement Rate',
      value: 87.3,
      previousValue: 84.7,
      unit: '%',
      trend: 'up',
      changePercent: 3.1,
      icon: Activity,
      color: 'text-purple-600'
    },
    {
      id: 'ai-efficiency',
      name: 'AI Efficiency',
      value: 94.8,
      previousValue: 91.2,
      unit: '%',
      trend: 'up',
      changePercent: 3.9,
      icon: Brain,
      color: 'text-orange-600'
    },
    {
      id: 'cost-savings',
      name: 'Cost Savings',
      value: 1_234_567,
      previousValue: 1_156_890,
      unit: 'USD',
      trend: 'up',
      changePercent: 6.7,
      icon: Target,
      color: 'text-teal-600'
    },
    {
      id: 'response-time',
      name: 'Avg Response Time',
      value: 340,
      previousValue: 420,
      unit: 'ms',
      trend: 'down',
      changePercent: -19.0,
      icon: Zap,
      color: 'text-yellow-600'
    }
  ];

  const platformPerformance: PlatformPerformance[] = [
    {
      platform: 'Code Studio',
      users: 18500,
      revenue: 1_240_000,
      engagement: 92.5,
      satisfaction: 4.8,
      growth: 12.3
    },
    {
      platform: 'AI Assistant Builder',
      users: 12800,
      revenue: 856_000,
      engagement: 89.2,
      satisfaction: 4.9,
      growth: 18.7
    },
    {
      platform: 'Content Studio',
      users: 9200,
      revenue: 485_000,
      engagement: 85.6,
      satisfaction: 4.6,
      growth: 8.9
    },
    {
      platform: 'Game Builder',
      users: 3400,
      revenue: 178_000,
      engagement: 78.3,
      satisfaction: 4.4,
      growth: 15.2
    },
    {
      platform: 'Business Studio',
      users: 1700,
      revenue: 88_000,
      engagement: 91.8,
      satisfaction: 4.7,
      growth: 22.1
    }
  ];

  const revenueChartData: ChartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
    datasets: [{
      label: 'Revenue',
      data: [1800000, 1950000, 2100000, 2250000, 2400000, 2650000, 2847293],
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      fill: true
    }]
  };

  const userGrowthData: ChartData = {
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    datasets: [{
      label: 'New Users',
      data: [2340, 2890, 3120, 3650],
      backgroundColor: '#10b981'
    }]
  };

  useEffect(() => {
    setMetrics(enterpriseMetrics);
    setPlatformData(platformPerformance);
  }, [selectedTimeRange]);

  const formatNumber = (num: number, unit: string) => {
    if (unit === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0
      }).format(num);
    }
    
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const getTrendIcon = (trend: string, changePercent: number) => {
    if (trend === 'up') {
      return <TrendingUp className="w-4 h-4 text-green-600" />;
    } else if (trend === 'down') {
      return <TrendingDown className="w-4 h-4 text-red-600" />;
    }
    return <div className="w-4 h-4" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Enterprise Analytics</h1>
            <p className="text-gray-600">Real-time insights and performance metrics</p>
          </div>

          <div className="flex items-center space-x-4">
            {/* Time Range Selector */}
            <div className="flex space-x-2">
              {['24h', '7d', '30d', '90d'].map(range => (
                <Button
                  key={range}
                  variant={selectedTimeRange === range ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedTimeRange(range)}
                >
                  {range}
                </Button>
              ))}
            </div>

            {/* Export Options */}
            <div className="flex space-x-2">
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-1" />
                Export
              </Button>
              <Button variant="outline" size="sm">
                <Share2 className="w-4 h-4 mr-1" />
                Share
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {metrics.map((metric, index) => {
            const IconComponent = metric.icon;
            return (
              <motion.div
                key={metric.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="hover:shadow-lg transition-all duration-300">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <IconComponent className={`w-5 h-5 ${metric.color}`} />
                      {getTrendIcon(metric.trend, metric.changePercent)}
                    </div>
                    <div className="space-y-1">
                      <div className="text-2xl font-bold">
                        {formatNumber(metric.value, metric.unit)}
                        {metric.unit === '%' || metric.unit === 'ms' ? ` ${metric.unit}` : ''}
                      </div>
                      <div className="text-sm text-gray-600">{metric.name}</div>
                      <div className={`text-xs font-medium ${
                        metric.changePercent > 0 ? 'text-green-600' : 
                        metric.changePercent < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {metric.changePercent > 0 ? '+' : ''}{metric.changePercent.toFixed(1)}% vs last period
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Charts and Analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue Trend</CardTitle>
              <CardDescription>Monthly revenue growth over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 flex items-center justify-center bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg">
                <div className="text-center">
                  <LineChart className="w-16 h-16 mx-auto text-blue-600 mb-4" />
                  <p className="text-gray-600">Revenue trending upward</p>
                  <div className="text-2xl font-bold text-green-600 mt-2">+8.1%</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* User Growth */}
          <Card>
            <CardHeader>
              <CardTitle>User Growth</CardTitle>
              <CardDescription>New user acquisitions by week</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 flex items-center justify-center bg-gradient-to-r from-green-50 to-blue-50 rounded-lg">
                <div className="text-center">
                  <BarChart className="w-16 h-16 mx-auto text-green-600 mb-4" />
                  <p className="text-gray-600">Consistent user growth</p>
                  <div className="text-2xl font-bold text-green-600 mt-2">+6.4%</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Platform Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Platform Performance Comparison</CardTitle>
            <CardDescription>Detailed metrics across all Jurexio DevStudio platforms</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Platform</th>
                    <th className="text-right p-2">Active Users</th>
                    <th className="text-right p-2">Revenue</th>
                    <th className="text-right p-2">Engagement</th>
                    <th className="text-right p-2">Satisfaction</th>
                    <th className="text-right p-2">Growth</th>
                  </tr>
                </thead>
                <tbody>
                  {platformData.map((platform, index) => (
                    <motion.tr
                      key={platform.platform}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="border-b hover:bg-gray-50"
                    >
                      <td className="p-2 font-medium">{platform.platform}</td>
                      <td className="p-2 text-right">{platform.users.toLocaleString()}</td>
                      <td className="p-2 text-right">
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 0
                        }).format(platform.revenue)}
                      </td>
                      <td className="p-2 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <Progress value={platform.engagement} className="w-16 h-2" />
                          <span>{platform.engagement}%</span>
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <Badge variant="secondary">{platform.satisfaction}/5.0</Badge>
                      </td>
                      <td className="p-2 text-right">
                        <div className={`font-medium ${
                          platform.growth > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          +{platform.growth}%
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* AI Insights */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Brain className="w-5 h-5 text-purple-600" />
                <span>AI-Powered Insights</span>
              </CardTitle>
              <CardDescription>Automated analysis and recommendations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  type: 'opportunity',
                  title: 'Revenue Opportunity',
                  description: 'AI Assistant Builder showing 18.7% growth - consider increasing marketing spend',
                  impact: 'High',
                  action: 'Review budget allocation'
                },
                {
                  type: 'warning',
                  title: 'Engagement Alert',
                  description: 'Game Builder engagement below average - users dropping off at tutorial step 3',
                  impact: 'Medium',
                  action: 'Optimize onboarding'
                },
                {
                  type: 'success',
                  title: 'Performance Win',
                  description: 'Response time improved by 19% - AI orchestration optimization successful',
                  impact: 'High',
                  action: 'Document best practices'
                }
              ].map((insight, index) => (
                <div key={index} className="p-3 border rounded-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        {insight.type === 'opportunity' && <TrendingUp className="w-4 h-4 text-green-600" />}
                        {insight.type === 'warning' && <AlertCircle className="w-4 h-4 text-yellow-600" />}
                        {insight.type === 'success' && <CheckCircle className="w-4 h-4 text-green-600" />}
                        <span className="font-medium text-sm">{insight.title}</span>
                      </div>
                      <p className="text-xs text-gray-600 mb-2">{insight.description}</p>
                      <div className="text-xs text-blue-600 font-medium">{insight.action}</div>
                    </div>
                    <Badge 
                      variant={insight.impact === 'High' ? 'default' : 'secondary'} 
                      className="text-xs"
                    >
                      {insight.impact}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Device & Channel Analytics</CardTitle>
              <CardDescription>User distribution across devices and channels</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { channel: 'Desktop Web', users: 28450, percentage: 62.3, icon: Monitor },
                { channel: 'Mobile Web', users: 12870, percentage: 28.2, icon: Smartphone },
                { channel: 'Mobile App', users: 3180, percentage: 7.0, icon: Smartphone },
                { channel: 'Tablet', users: 1123, percentage: 2.5, icon: Monitor }
              ].map((channel, index) => {
                const IconComponent = channel.icon;
                return (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <IconComponent className="w-5 h-5 text-gray-600" />
                      <span className="font-medium">{channel.channel}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <Progress value={channel.percentage} className="w-20 h-2" />
                      <span className="text-sm font-medium">{channel.percentage}%</span>
                      <span className="text-sm text-gray-500">{channel.users.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}