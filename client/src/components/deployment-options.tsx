import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

interface DeploymentOptionsProps {
  projectId: number;
}

interface Deployment {
  id: number;
  projectId: number;
  platform: string;
  status: string;
  url: string | null;
  configuration: any;
  createdAt: string;
  deployedAt: string | null;
}

export function DeploymentOptions({ projectId }: DeploymentOptionsProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing deployments
  const { data: deployments, isLoading } = useQuery({
    queryKey: ['/api/projects', projectId, 'deployments'],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/deployments`);
      if (!response.ok) {
        throw new Error('Failed to fetch deployments');
      }
      const result = await response.json();
      return result.data as Deployment[];
    },
    enabled: !!projectId
  });

  // Deploy mutation
  const deployMutation = useMutation({
    mutationFn: async (platform: string) => {
      const response = await fetch('/api/deployments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId,
          platform,
          environment: 'production',
          configuration: {
            region: 'us-east-1',
            ssl: true,
            monitoring: true,
            backup: true
          }
        })
      });

      if (!response.ok) {
        throw new Error('Deployment failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Deployment Started",
        description: `Deployment to ${selectedPlatform} has been initiated.`
      });
      queryClient.invalidateQueries(['/api/projects', projectId, 'deployments']);
      setSelectedPlatform(null);
    },
    onError: (error) => {
      toast({
        title: "Deployment Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive"
      });
    }
  });

  const handleDeploy = (platform: string) => {
    setSelectedPlatform(platform);
    deployMutation.mutate(platform);
  };

  const deploymentOptions = [
    {
      platform: 'aws',
      name: 'Amazon Web Services',
      description: 'ECS, RDS, S3, CloudFront',
      icon: 'fab fa-aws',
      color: 'orange',
      features: ['Auto-scaling configured', 'CI/CD pipeline ready'],
      estimatedTime: '15 minutes'
    },
    {
      platform: 'gcp',
      name: 'Google Cloud Platform',
      description: 'Cloud Run, Cloud SQL, Cloud Storage',
      icon: 'fab fa-google',
      color: 'blue',
      features: ['Serverless ready', 'Global CDN enabled'],
      estimatedTime: '18 minutes'
    },
    {
      platform: 'azure',
      name: 'Microsoft Azure',
      description: 'App Service, Azure SQL, Blob Storage',
      icon: 'fab fa-microsoft',
      color: 'cyan',
      features: ['Enterprise security', 'Azure AD integration'],
      estimatedTime: '20 minutes'
    },
    {
      platform: 'custom',
      name: 'Custom Infrastructure',
      description: 'Docker, Kubernetes, Custom Config',
      icon: 'fas fa-server',
      color: 'gray',
      features: ['Full control', 'Custom configuration'],
      estimatedTime: '25 minutes'
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'deployed': return 'default';
      case 'deploying': return 'destructive';
      case 'failed': return 'destructive';
      case 'pending': return 'secondary';
      default: return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'deployed': return 'fas fa-check-circle';
      case 'deploying': return 'fas fa-spinner fa-spin';
      case 'failed': return 'fas fa-exclamation-circle';
      case 'pending': return 'fas fa-clock';
      default: return 'fas fa-question-circle';
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-surface-800 p-6 border-surface-700">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-700 rounded w-1/3 mb-6"></div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  const latestDeployment = deployments?.[0];
  const canDeploy = !deployMutation.isPending && (!latestDeployment || latestDeployment.status !== 'deploying');

  return (
    <Card className="bg-surface-800 p-6 border-surface-700">
      <h3 className="text-lg font-semibold mb-6 flex items-center">
        <i className="fas fa-rocket text-purple-400 mr-2"></i>
        Deployment Options
      </h3>
      
      <div className="space-y-4">
        {/* Current Deployment Status */}
        {latestDeployment && (
          <div className="mb-6 p-4 bg-surface-700 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Latest Deployment</span>
              <Badge variant={getStatusColor(latestDeployment.status)}>
                <i className={`${getStatusIcon(latestDeployment.status)} mr-1`}></i>
                {latestDeployment.status}
              </Badge>
            </div>
            <div className="text-xs text-gray-400">
              Platform: {latestDeployment.platform.toUpperCase()} • 
              {latestDeployment.deployedAt 
                ? ` Deployed ${new Date(latestDeployment.deployedAt).toLocaleString()}`
                : ` Created ${new Date(latestDeployment.createdAt).toLocaleString()}`
              }
            </div>
            {latestDeployment.url && (
              <div className="mt-2">
                <a
                  href={latestDeployment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  <i className="fas fa-external-link-alt mr-1"></i>
                  {latestDeployment.url}
                </a>
              </div>
            )}
            {latestDeployment.status === 'deploying' && (
              <div className="mt-3">
                <Progress value={65} className="h-2" />
                <div className="text-xs text-gray-400 mt-1">Deployment in progress...</div>
              </div>
            )}
          </div>
        )}

        {/* Deployment Options */}
        {deploymentOptions.map((option) => {
          const isCurrentPlatform = latestDeployment?.platform === option.platform;
          const isDeploying = deployMutation.isPending && selectedPlatform === option.platform;
          
          return (
            <div
              key={option.platform}
              className={`border rounded-lg p-4 transition-all ${
                isCurrentPlatform 
                  ? `border-${option.color}-500/50 bg-${option.color}-500/5`
                  : `border-${option.color}-500/30 bg-${option.color}-500/5 hover:border-${option.color}-500/50`
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 bg-${option.color}-500/20 rounded-lg flex items-center justify-center`}>
                    <i className={`${option.icon} text-${option.color}-400`}></i>
                  </div>
                  <div>
                    <h4 className="font-medium">{option.name}</h4>
                    <p className="text-xs text-gray-400">{option.description}</p>
                  </div>
                </div>
                <Button
                  onClick={() => handleDeploy(option.platform)}
                  disabled={!canDeploy || isCurrentPlatform}
                  className={`bg-${option.color}-500 hover:bg-${option.color}-600 transition-colors`}
                  size="sm"
                >
                  {isDeploying ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-2"></i>
                      Deploying...
                    </>
                  ) : isCurrentPlatform ? (
                    'Deployed'
                  ) : (
                    'Deploy'
                  )}
                </Button>
              </div>
              
              <div className="flex items-center justify-between text-xs">
                <div className="space-x-4">
                  {option.features.map((feature, index) => (
                    <span key={index} className={`text-${option.color}-300`}>
                      <i className="fas fa-check mr-1"></i>
                      {feature}
                    </span>
                  ))}
                </div>
                <span className="text-gray-400">~{option.estimatedTime}</span>
              </div>
            </div>
          );
        })}

        {/* Deployment Ready Status */}
        <div className="mt-6 p-4 bg-accent-500/10 border border-accent-500/20 rounded-lg">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-accent-400">Ready for Deployment</span>
          </div>
          <p className="text-xs text-gray-400">
            All tests passed. Infrastructure provisioned. {canDeploy ? 'Ready to deploy.' : 'Deployment in progress.'}
          </p>
        </div>
      </div>
    </Card>
  );
}
