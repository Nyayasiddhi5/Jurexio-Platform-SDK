import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface DeploymentPanelProps {
  projectId: number;
  className?: string;
}

interface DeploymentConfig {
  platform: 'aws' | 'gcp' | 'azure' | 'vercel' | 'netlify';
  environment: 'development' | 'staging' | 'production';
  autoScale: boolean;
  monitoring: boolean;
  ssl: boolean;
}

export function DeploymentPanel({ projectId, className = "" }: DeploymentPanelProps) {
  const [config, setConfig] = useState<DeploymentConfig>({
    platform: 'aws',
    environment: 'staging',
    autoScale: true,
    monitoring: true,
    ssl: true
  });
  const { toast } = useToast();

  // Get existing deployments
  const { data: deployments, refetch } = useQuery({
    queryKey: ['deployments', projectId],
    queryFn: () => apiRequest(`/api/projects/${projectId}/deployments`)
  });

  // Get deployment recommendations
  const { data: recommendations } = useQuery({
    queryKey: ['deployment-recommendations', projectId],
    queryFn: () => apiRequest(`/api/deployments/recommendations?projectId=${projectId}`)
  });

  // Deploy mutation
  const deployMutation = useMutation({
    mutationFn: async (deployConfig: DeploymentConfig) => {
      return apiRequest(`/api/projects/${projectId}/deploy`, {
        method: 'POST',
        body: JSON.stringify({
          platform: deployConfig.platform,
          config: deployConfig
        })
      });
    },
    onSuccess: (deployment) => {
      toast({
        title: "Deployment Started",
        description: `Deployment to ${config.platform} has been initiated.`,
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Deployment Failed",
        description: error instanceof Error ? error.message : "Failed to start deployment",
        variant: "destructive"
      });
    }
  });

  const getPlatformIcon = (platform: string) => {
    const icons = {
      aws: 'fab fa-aws',
      gcp: 'fab fa-google',
      azure: 'fab fa-microsoft',
      vercel: 'fas fa-bolt',
      netlify: 'fas fa-globe'
    };
    return icons[platform as keyof typeof icons] || 'fas fa-server';
  };

  const getPlatformColor = (platform: string) => {
    const colors = {
      aws: 'bg-orange-500',
      gcp: 'bg-blue-500',
      azure: 'bg-cyan-500',
      vercel: 'bg-black',
      netlify: 'bg-teal-500'
    };
    return colors[platform as keyof typeof colors] || 'bg-gray-500';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'deployed': return 'bg-green-600';
      case 'deploying': return 'bg-blue-600';
      case 'failed': return 'bg-red-600';
      default: return 'bg-gray-600';
    }
  };

  const handleDeploy = () => {
    deployMutation.mutate(config);
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Deployment Configuration */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-white flex items-center">
            <i className="fas fa-rocket text-purple-400 mr-2"></i>
            Deployment Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Platform Selection */}
          <div className="space-y-3">
            <Label className="text-white">Deployment Platform</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {['aws', 'gcp', 'vercel'].map((platform) => (
                <div
                  key={platform}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    config.platform === platform
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-600 hover:border-gray-500'
                  }`}
                  onClick={() => setConfig({ ...config, platform: platform as any })}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={`w-10 h-10 ${getPlatformColor(platform)} rounded-lg flex items-center justify-center`}>
                        <i className={`${getPlatformIcon(platform)} text-white`}></i>
                      </div>
                      <div>
                        <h4 className="font-medium text-white capitalize">{platform}</h4>
                        <p className="text-xs text-gray-400">
                          {platform === 'aws' && 'ECS, RDS, S3, CloudFront'}
                          {platform === 'gcp' && 'Cloud Run, Cloud SQL, Storage'}
                          {platform === 'vercel' && 'Serverless, Edge Functions'}
                        </p>
                      </div>
                    </div>
                    {recommendations?.platforms?.find((p: any) => p.platform === platform) && (
                      <Badge className="bg-green-600 text-white text-xs">
                        Recommended
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Environment Selection */}
          <div className="space-y-3">
            <Label className="text-white">Environment</Label>
            <Select value={config.environment} onValueChange={(value: any) => setConfig({ ...config, environment: value })}>
              <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="development">Development</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Configuration Options */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-white">Auto Scaling</Label>
                <p className="text-xs text-gray-400">Automatically scale based on demand</p>
              </div>
              <Switch
                checked={config.autoScale}
                onCheckedChange={(checked) => setConfig({ ...config, autoScale: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-white">Monitoring & Alerting</Label>
                <p className="text-xs text-gray-400">Enable comprehensive monitoring</p>
              </div>
              <Switch
                checked={config.monitoring}
                onCheckedChange={(checked) => setConfig({ ...config, monitoring: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-white">SSL Certificate</Label>
                <p className="text-xs text-gray-400">Enable HTTPS with SSL certificate</p>
              </div>
              <Switch
                checked={config.ssl}
                onCheckedChange={(checked) => setConfig({ ...config, ssl: checked })}
              />
            </div>
          </div>

          {/* Deploy Button */}
          <Button
            onClick={handleDeploy}
            disabled={deployMutation.isPending}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
          >
            {deployMutation.isPending ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Deploying...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <i className="fas fa-rocket"></i>
                <span>Deploy to {config.platform.toUpperCase()}</span>
              </div>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Active Deployments */}
      {deployments && deployments.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white flex items-center">
              <i className="fas fa-list text-blue-400 mr-2"></i>
              Active Deployments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {deployments.map((deployment: any) => (
                <div key={deployment.id} className="p-4 bg-gray-700/50 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 ${getPlatformColor(deployment.platform)} rounded-lg flex items-center justify-center`}>
                        <i className={`${getPlatformIcon(deployment.platform)} text-white text-sm`}></i>
                      </div>
                      <div>
                        <h4 className="font-medium text-white capitalize">{deployment.platform}</h4>
                        <p className="text-xs text-gray-400">
                          {new Date(deployment.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge className={`${getStatusColor(deployment.status)} text-white`}>
                      {deployment.status}
                    </Badge>
                  </div>

                  {deployment.status === 'deploying' && (
                    <div className="mb-3">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">Deployment Progress</span>
                        <span className="text-blue-400">65%</span>
                      </div>
                      <Progress value={65} className="h-2" />
                    </div>
                  )}

                  {deployment.url && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <i className="fas fa-external-link-alt text-green-400 text-sm"></i>
                        <a
                          href={deployment.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:text-green-300 text-sm"
                        >
                          {deployment.url}
                        </a>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-400 hover:text-white"
                      >
                        <i className="fas fa-copy"></i>
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deployment Status */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-white flex items-center">
            <i className="fas fa-info-circle text-cyan-400 mr-2"></i>
            Deployment Ready
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="flex items-center space-x-2 mb-2">
              <div className="status-indicator bg-green-500"></div>
              <span className="text-sm font-medium text-green-400">Ready for Deployment</span>
            </div>
            <p className="text-xs text-gray-300">
              All tests passed. Infrastructure configuration validated. Awaiting deployment confirmation.
            </p>
            <div className="mt-3 flex items-center space-x-4 text-xs text-gray-400">
              <div className="flex items-center space-x-1">
                <i className="fas fa-check text-green-400"></i>
                <span>Build successful</span>
              </div>
              <div className="flex items-center space-x-1">
                <i className="fas fa-check text-green-400"></i>
                <span>Tests passed</span>
              </div>
              <div className="flex items-center space-x-1">
                <i className="fas fa-check text-green-400"></i>
                <span>Security scan clean</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
