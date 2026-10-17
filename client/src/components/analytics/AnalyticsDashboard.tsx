import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Users, Rocket, Target, Activity, Zap } from "lucide-react";

interface AnalyticsMetrics {
  totalUsers: number;
  signupsToday: number;
  onboardingCompletionRate: number;
  avgTimeToFirstStudio: number;
  totalStudioLaunches: number;
  totalArtifacts: number;
  activeUsers24h: number;
  conversionFunnel: {
    signups: number;
    onboardingStarted: number;
    onboardingCompleted: number;
    firstStudioLaunched: number;
    firstArtifactGenerated: number;
  };
}

export function AnalyticsDashboard() {
  const { data, isLoading } = useQuery<{ success: boolean; metrics: AnalyticsMetrics }>({
    queryKey: ['/api/tracking/metrics'],
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-4 w-4 bg-muted animate-pulse rounded-full" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted animate-pulse rounded" />
              <div className="h-3 w-32 bg-muted animate-pulse rounded mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!data?.success || !data.metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analytics Unavailable</CardTitle>
          <CardDescription>Unable to load analytics data.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const metrics = data.metrics;
  const funnel = metrics.conversionFunnel;

  const funnelSteps = [
    { label: 'Signups', count: funnel.signups, icon: Users },
    { label: 'Onboarding Started', count: funnel.onboardingStarted, icon: Activity },
    { label: 'Onboarding Complete', count: funnel.onboardingCompleted, icon: Target },
    { label: 'First Studio', count: funnel.firstStudioLaunched, icon: Rocket },
    { label: 'First Artifact', count: funnel.firstArtifactGenerated, icon: Zap },
  ];

  const calculateFunnelProgress = (step: number) => {
    if (funnel.signups === 0) return 0;
    const stepCounts = [
      funnel.signups,
      funnel.onboardingStarted,
      funnel.onboardingCompleted,
      funnel.firstStudioLaunched,
      funnel.firstArtifactGenerated,
    ];
    return (stepCounts[step] / funnel.signups) * 100;
  };

  return (
    <div className="space-y-6" data-testid="analytics-dashboard">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="metric-total-users">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalUsers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {metrics.signupsToday} signups today
            </p>
          </CardContent>
        </Card>

        <Card data-testid="metric-active-users">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users (24h)</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.activeUsers24h.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {metrics.totalUsers > 0 
                ? Math.round((metrics.activeUsers24h / metrics.totalUsers) * 100)
                : 0}% engagement
            </p>
          </CardContent>
        </Card>

        <Card data-testid="metric-onboarding-rate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Onboarding Rate</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.onboardingCompletionRate}%</div>
            <p className="text-xs text-muted-foreground">Completion rate</p>
          </CardContent>
        </Card>

        <Card data-testid="metric-time-to-first-studio">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Time to First Studio</CardTitle>
            <Rocket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.avgTimeToFirstStudio}h</div>
            <p className="text-xs text-muted-foreground">Average time</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="engagement-metrics">
        <CardHeader>
          <CardTitle>Engagement Metrics</CardTitle>
          <CardDescription>Studio launches and artifact generation</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Studio Launches</span>
              <span className="text-2xl font-bold">{metrics.totalStudioLaunches.toLocaleString()}</span>
            </div>
            <Progress 
              value={metrics.totalUsers > 0 ? (metrics.totalStudioLaunches / metrics.totalUsers) * 10 : 0} 
              className="h-2" 
            />
            <p className="text-xs text-muted-foreground">
              {metrics.totalUsers > 0 
                ? (metrics.totalStudioLaunches / metrics.totalUsers).toFixed(1)
                : '0'} launches per user
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Artifacts Generated</span>
              <span className="text-2xl font-bold">{metrics.totalArtifacts.toLocaleString()}</span>
            </div>
            <Progress 
              value={metrics.totalStudioLaunches > 0 
                ? (metrics.totalArtifacts / metrics.totalStudioLaunches) * 100 
                : 0
              } 
              className="h-2" 
            />
            <p className="text-xs text-muted-foreground">
              {metrics.totalStudioLaunches > 0 
                ? (metrics.totalArtifacts / metrics.totalStudioLaunches).toFixed(1)
                : '0'} artifacts per launch
            </p>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="conversion-funnel">
        <CardHeader>
          <CardTitle>Conversion Funnel</CardTitle>
          <CardDescription>User journey from signup to first artifact</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {funnelSteps.map((step, index) => {
            const Icon = step.icon;
            const progress = calculateFunnelProgress(index);
            const dropoff = index > 0 
              ? Math.round(((funnelSteps[index-1].count - step.count) / funnelSteps[index-1].count) * 100)
              : 0;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{step.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{step.count.toLocaleString()}</span>
                    <Badge variant="outline" className="text-xs">
                      {Math.round(progress)}%
                    </Badge>
                  </div>
                </div>
                <Progress value={progress} className="h-2" data-testid={`funnel-step-${index}`} />
                {index > 0 && dropoff > 0 && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {dropoff}% drop-off from previous step
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
