import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import AnimatedCard from "@/components/ui/animated-card";
import { useWebSocket } from "@/hooks/use-websocket";
import { api } from "@/lib/api";
import { 
  CheckCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  Terminal,
  Activity,
  Globe,
  Shield,
  Database,
  Server,
  Zap
} from "lucide-react";

interface DeploymentPanelProps {
  deployment: any;
  projectId: number;
}

export default function DeploymentPanel({ deployment, projectId }: DeploymentPanelProps) {
  const [deploymentStatus, setDeploymentStatus] = useState<any>(null);

  const { data: status, refetch } = useQuery({
    queryKey: ['/api/deployments', deployment.id, 'status'],
    queryFn: () => api.getDeploymentStatus(deployment.id),
    refetchInterval: deployment.status === 'deploying' ? 2000 : false
  });

  useWebSocket('demo_user', (data) => {
    if (data.type === 'deployment_update' && data.projectId === projectId) {
      setDeploymentStatus(data.deployment);
      refetch();
    }
  });

  const currentStatus = deploymentStatus || status;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'deployed':
        return <CheckCircle className="h-5 w-5 text-emerald-400" />;
      case 'deploying':
      case 'building':
        return <Clock className="h-5 w-5 text-blue-400 animate-spin" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-red-400" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'deployed':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'deploying':
      case 'building':
        return 'bg-blue-500/20 text-blue-400';
      case 'failed':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const deploymentSteps = [
    { id: 'code', name: 'Code Build', icon: Terminal, completed: true },
    { id: 'tests', name: 'Tests', icon: CheckCircle, completed: true },
    { id: 'infrastructure', name: 'Infrastructure Setup', icon: Server, completed: currentStatus?.progress >= 50 },
    { id: 'deployment', name: 'Deployment', icon: Zap, completed: currentStatus?.progress >= 90 },
    { id: 'dns', name: 'DNS Configuration', icon: Globe, completed: currentStatus?.status === 'deployed' }
  ];

  return (
    <AnimatedCard className="p-6 bg-card border border-border">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center">
              {getStatusIcon(deployment.status)}
              <span className="ml-2">Deployment Status</span>
            </CardTitle>
            <CardDescription>
              {deployment.platform.charAt(0).toUpperCase() + deployment.platform.slice(1)} deployment
            </CardDescription>
          </div>
          <Badge 
            variant="secondary" 
            className={getStatusColor(deployment.status)}
          >
            {deployment.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Overview */}
        {currentStatus && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Overall Progress</span>
              <span className="text-white font-medium">{currentStatus.progress}%</span>
            </div>
            <div className="relative">
              <Progress value={currentStatus.progress} className="h-3 deploy-progress" />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Current: {currentStatus.currentStep}</span>
              {deployment.status === 'deployed' && currentStatus.url && (
                <span>Ready to view</span>
              )}
            </div>
          </div>
        )}

        {/* Deployment Steps */}
        <div className="space-y-3">
          <h4 className="font-medium text-white">Deployment Pipeline</h4>
          <div className="space-y-2">
            {deploymentSteps.map((step) => {
              const Icon = step.icon;
              return (
                <div 
                  key={step.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    step.completed 
                      ? 'bg-emerald-500/10 border-emerald-500/20' 
                      : 'bg-muted/30 border-border'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon className={`h-4 w-4 ${
                      step.completed ? 'text-emerald-400' : 'text-muted-foreground'
                    }`} />
                    <span className={
                      step.completed ? 'text-white' : 'text-muted-foreground'
                    }>
                      {step.name}
                    </span>
                  </div>
                  {step.completed && (
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Deployment Info */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
          <div>
            <p className="text-xs text-muted-foreground">Platform</p>
            <p className="text-sm font-medium text-white capitalize">{deployment.platform}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Started</p>
            <p className="text-sm font-medium text-white">
              {new Date(deployment.createdAt!).toLocaleTimeString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Environment</p>
            <p className="text-sm font-medium text-white">Production</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Region</p>
            <p className="text-sm font-medium text-white">us-east-1</p>
          </div>
        </div>

        {/* Live URL */}
        {deployment.url && deployment.status === 'deployed' && (
          <div className="space-y-3">
            <h4 className="font-medium text-white flex items-center">
              <Globe className="mr-2 h-4 w-4 text-emerald-400" />
              Live Application
            </h4>
            <div className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <div>
                <p className="text-sm font-medium text-white">Your app is live!</p>
                <p className="text-xs text-emerald-300">{deployment.url}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(deployment.url, '_blank')}
                className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              >
                <ExternalLink className="mr-2 h-3 w-3" />
                Visit
              </Button>
            </div>
          </div>
        )}

        {/* Deployment Logs */}
        <div className="space-y-3">
          <h4 className="font-medium text-white flex items-center">
            <Terminal className="mr-2 h-4 w-4 text-primary" />
            Deployment Logs
          </h4>
          <div className="bg-slate-900 rounded-lg p-4 border border-border">
            <ScrollArea className="h-32">
              <div className="space-y-1 font-mono text-xs">
                {currentStatus?.logs?.map((log: string, index: number) => (
                  <div key={index} className="flex items-start space-x-2">
                    <span className="text-muted-foreground">[{new Date().toLocaleTimeString()}]</span>
                    <span className="text-white">{log}</span>
                  </div>
                )) || [
                  <div key="1" className="flex items-start space-x-2">
                    <span className="text-muted-foreground">[14:32:15]</span>
                    <span className="text-green-400">✓ Build completed successfully</span>
                  </div>,
                  <div key="2" className="flex items-start space-x-2">
                    <span className="text-muted-foreground">[14:32:22]</span>
                    <span className="text-green-400">✓ Tests passed (98% coverage)</span>
                  </div>,
                  <div key="3" className="flex items-start space-x-2">
                    <span className="text-muted-foreground">[14:32:45]</span>
                    <span className="text-blue-400">→ Setting up infrastructure...</span>
                  </div>
                ]}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* DevOps Features */}
        <div className="space-y-3">
          <h4 className="font-medium text-white">Automated Features</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded text-xs">
              <Shield className="h-3 w-3 text-emerald-400" />
              <span className="text-white">SSL Certificate</span>
            </div>
            <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded text-xs">
              <Activity className="h-3 w-3 text-blue-400" />
              <span className="text-white">Health Monitoring</span>
            </div>
            <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded text-xs">
              <Database className="h-3 w-3 text-purple-400" />
              <span className="text-white">Auto Backup</span>
            </div>
            <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded text-xs">
              <Server className="h-3 w-3 text-orange-400" />
              <span className="text-white">Auto Scaling</span>
            </div>
          </div>
        </div>
      </CardContent>
    </AnimatedCard>
  );
}
