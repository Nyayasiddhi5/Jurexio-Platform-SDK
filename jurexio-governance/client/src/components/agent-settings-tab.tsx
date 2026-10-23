import { Link } from 'wouter';
import type { FC } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Settings, 
  Target, 
  Brain, 
  Network, 
  Activity, 
  ArrowRight,
  Zap,
  BarChart3
} from 'lucide-react';

interface AgentSettingsTabProps {
  className?: string;
}

const AgentSettingsTab: FC<AgentSettingsTabProps> = ({ className }) => {
  const features = [
    {
      icon: Target,
      title: 'Interactive AI Agent Capability Radar Chart',
      description: 'Comprehensive visualization of agent capabilities across multiple dimensions',
      color: 'text-blue-600'
    },
    {
      icon: Brain,
      title: 'Personalized Agent Recommendation Engine with Machine Learning',
      description: 'AI-powered agent selection based on task analysis and historical performance',
      color: 'text-purple-600'
    },
    {
      icon: Network,
      title: 'Contextual Agent Handoff Visualization',
      description: 'Visual representation of agent collaboration patterns and handoff efficiency',
      color: 'text-green-600'
    },
    {
      icon: Activity,
      title: 'Real-time Agent Performance Heatmap',
      description: 'Live monitoring of agent performance, status, and workload distribution',
      color: 'text-red-600'
    },
    {
      icon: Settings,
      title: 'Conversational Agent Configuration Wizard',
      description: 'Interactive wizard for optimizing agent configuration and performance tuning',
      color: 'text-orange-600'
    }
  ];

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          Advanced Agent Orchestration Settings
        </h2>
        <p className="text-gray-600 max-w-2xl mx-auto">
          Configure and monitor your AI agent ecosystem with advanced analytics, 
          machine learning recommendations, and real-time performance insights.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {features.map((feature, index) => (
          <Card key={index} className="hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-lg bg-gray-50 ${feature.color}`}>
                  <feature.icon className="w-5 h-5" />
                </div>
                <CardTitle className="text-sm font-semibold leading-tight">
                  {feature.title}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <CardDescription className="text-sm text-gray-600">
                {feature.description}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-6 border">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Enhanced Jurexio Orchestration Platform
            </h3>
            <p className="text-gray-600 mb-4">
              Access all advanced agent orchestration features including ML-powered recommendations,
              real-time performance monitoring, and comprehensive capability analytics.
            </p>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <BarChart3 className="w-4 h-4" />
                <span>57 Specialized Agents</span>
              </div>
              <div className="flex items-center gap-1">
                <Zap className="w-4 h-4" />
                <span>14 LLM Providers</span>
              </div>
              <div className="flex items-center gap-1">
                <Target className="w-4 h-4" />
                <span>70% Cost Reduction</span>
              </div>
            </div>
          </div>
          <div className="ml-6">
            <Link to="/agent-orchestration-settings">
              <Button size="lg" className="flex items-center gap-2">
                Open Settings
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-blue-600 mb-1">57</div>
          <div className="text-sm text-gray-600">Specialized Agents</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-green-600 mb-1">94.2%</div>
          <div className="text-sm text-gray-600">Average Performance</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-purple-600 mb-1">70%</div>
          <div className="text-sm text-gray-600">Cost Optimization</div>
        </Card>
      </div>
    </div>
  );
};

export default AgentSettingsTab;