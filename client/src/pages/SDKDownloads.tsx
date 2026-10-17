import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { NyvEmptyState } from "@/components/NyvEmptyState";
import { NyvErrorState } from "@/components/NyvErrorState";
import {
  Download,
  Package,
  Code,
  Scale,
  Server,
  Database,
  Globe,
  Shield,
  Zap,
  BookOpen,
  CheckCircle2,
  Cloud,
  PackageOpen,
} from "lucide-react";

// task-180 (B5): version comes from package.json via vite define, never hardcoded.
const NV_VERSION = __NV_VERSION__;

interface SDKBuild {
  id: string;
  name: string;
  version: string;
  description: string;
  agents?: number;
  providers?: number;
  categories?: number;
  statutes?: number;
  languages?: number;
  features?: string[];
  downloadUrl: string;
}

export default function SDKDownloads() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: buildsData, isLoading, isError, error, refetch } = useQuery<{ success: boolean; data: { builds: SDKBuild[] } }>({
    queryKey: ["/api/sdk-builds/list"],
  });

  const handleDownload = async (buildId: string, downloadUrl: string) => {
    setDownloading(buildId);
    try {
      window.open(downloadUrl, '_blank');
    } finally {
      setTimeout(() => setDownloading(null), 2000);
    }
  };

  const builds = buildsData?.data?.builds ?? [];
  const primary = builds[0];
  const secondary = builds[1] ?? builds[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent" data-testid="page-title">
            SDK Downloads
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Download production-ready SDK builds with complete source code, documentation, and deployment configurations
          </p>
          <div className="text-xs text-muted-foreground" data-testid="page-version">Console build {NV_VERSION}</div>
        </div>

        {isError ? (
          <NyvErrorState
            title="Could not load SDK build catalogue"
            error={error}
            onRetry={() => refetch()}
            variant="card"
          />
        ) : isLoading ? (
          <div className="grid md:grid-cols-2 gap-6">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : builds.length === 0 ? (
          <NyvEmptyState
            icon={PackageOpen}
            title="No SDK builds available yet"
            description="Once a build is published from the SDK pipeline it will appear here."
            variant="card"
          />
        ) : (
          <Tabs defaultValue="all" className="w-full">
            <TabsList className="grid w-full max-w-md mx-auto grid-cols-3" aria-label="Navigation tabs">
              <TabsTrigger value="all" data-testid="tab-all" aria-label="all tab">All SDKs</TabsTrigger>
              <TabsTrigger value="nyayavigya" data-testid="tab-nyayavigya" aria-label="nyayavigya tab">Jurexio Legal SDK</TabsTrigger>
              <TabsTrigger value="legal" data-testid="tab-legal" aria-label="legal tab">Legal SDK</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-6">
              <div className="grid md:grid-cols-2 gap-6">
                <JurexioSDKCard onDownload={handleDownload} downloading={downloading} build={primary} />
                <JurexioLegalSDKCard onDownload={handleDownload} downloading={downloading} build={secondary} />
              </div>
            </TabsContent>

            <TabsContent value="nyayavigya" className="mt-6">
              <JurexioSDKCard onDownload={handleDownload} downloading={downloading} build={primary} fullWidth />
            </TabsContent>

            <TabsContent value="legal" className="mt-6">
              <JurexioLegalSDKCard onDownload={handleDownload} downloading={downloading} build={secondary} fullWidth />
            </TabsContent>
          </Tabs>
        )}

        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200 ">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-blue-600 " />
              Deployment Options
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-4 gap-4">
              {[
                { name: "AWS", desc: "ECS, Lambda, EC2" },
                { name: "Google Cloud", desc: "Cloud Run, GKE" },
                { name: "Azure", desc: "Container Apps, AKS" },
                { name: "Docker", desc: "Self-hosted, K8s" }
              ].map((platform) => (
                <div key={platform.name} className="p-4 bg-white rounded-lg border border-slate-200 ">
                  <div className="font-semibold text-slate-900 ">{platform.name}</div>
                  <div className="text-sm text-muted-foreground">{platform.desc}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface SDKCardProps {
  onDownload: (id: string, url: string) => void;
  downloading: string | null;
  build?: SDKBuild;
  fullWidth?: boolean;
}

function JurexioSDKCard({ onDownload, downloading, build, fullWidth = false }: SDKCardProps) {
  if (!build) return null;
  const versionLabel = build.version.startsWith('v') ? build.version : `v${build.version}`;
  const isDownloading = downloading === build.id;

  return (
    <Card className={`relative overflow-hidden ${fullWidth ? 'max-w-2xl mx-auto' : ''}`} data-testid="card-nyayavigya-sdk">
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-bl-full" />
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Package className="h-6 w-6 text-blue-600 " />
              {build.name} {versionLabel}
            </CardTitle>
            <CardDescription className="mt-2">
              {build.description || 'Universal Enterprise AI Orchestration Platform'}
            </CardDescription>
          </div>
          <Badge variant="secondary" className="bg-blue-100 text-blue-700 " role="status">
            {versionLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-slate-50 rounded-lg border border-transparent ">
            <div className="text-2xl font-bold text-blue-600 ">{build.agents ?? '—'}</div>
            <div className="text-xs text-muted-foreground">AI Agents</div>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-transparent ">
            <div className="text-2xl font-bold text-purple-600 ">{build.providers ?? '—'}</div>
            <div className="text-xs text-muted-foreground">LLM Providers</div>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-transparent ">
            <div className="text-2xl font-bold text-green-600 ">{build.categories ?? '—'}</div>
            <div className="text-xs text-muted-foreground">Enterprise Services</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Included Features:</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              { icon: Globe, text: "Web Search API" },
              { icon: BookOpen, text: "Document Processing" },
              { icon: Code, text: "Code Quality Gateway" },
              { icon: Database, text: "Database Connectors" },
              { icon: Shield, text: "Enterprise Security" },
              { icon: Zap, text: "Real-time Analytics" }
            ].map((feature) => (
              <div key={feature.text} className="flex items-center gap-2 text-muted-foreground">
                <feature.icon className="h-4 w-4 text-blue-500 " />
                {feature.text}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Includes:</div>
          <div className="flex flex-wrap gap-2">
            {["Source Code", "Docker", "API Docs", "Deploy Scripts", "TypeScript"].map((item) => (
              <Badge key={item} variant="outline" className="text-xs" role="status">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {item}
              </Badge>
            ))}
          </div>
        </div>

        <Button
          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          onClick={() => onDownload(build.id, build.downloadUrl || `/api/sdk-builds/download/${build.id}`)}
          disabled={isDownloading}
          data-testid="button-download-nyayavigya"
        >
          <Download className="h-4 w-4 mr-2" />
          {isDownloading ? 'Preparing Download...' : `Download ${build.name} ${versionLabel}`}
        </Button>
      </CardContent>
    </Card>
  );
}

function JurexioLegalSDKCard({ onDownload, downloading, build, fullWidth = false }: SDKCardProps) {
  if (!build) return null;
  const versionLabel = build.version.startsWith('v') ? build.version : `v${build.version}`;
  const isDownloading = downloading === build.id;

  return (
    <Card className={`relative overflow-hidden ${fullWidth ? 'max-w-2xl mx-auto' : ''}`} data-testid="card-nyayavigya-legal-sdk">
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-bl-full" />
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Scale className="h-6 w-6 text-amber-600 " />
              {build.name} {versionLabel}
            </CardTitle>
            <CardDescription className="mt-2">
              {build.description || 'Specialized Legal AI Platform'}
            </CardDescription>
          </div>
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 " role="status">
            {versionLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-slate-50 rounded-lg border border-transparent ">
            <div className="text-2xl font-bold text-amber-600 ">{build.agents ?? '—'}</div>
            <div className="text-xs text-muted-foreground">Legal Agents</div>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-transparent ">
            <div className="text-2xl font-bold text-orange-600 ">{build.categories ?? '—'}</div>
            <div className="text-xs text-muted-foreground">Legal Categories</div>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-transparent ">
            <div className="text-2xl font-bold text-red-600 ">{build.statutes ?? '—'}</div>
            <div className="text-xs text-muted-foreground">Statutes</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Legal Coverage:</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              { icon: Scale, text: "IPC, BNS 2023" },
              { icon: BookOpen, text: "CrPC, BNSS 2023" },
              { icon: Shield, text: "Constitution" },
              { icon: Server, text: "Companies Act" },
              { icon: Globe, text: "22 Indian Languages" },
              { icon: Database, text: "Case Law Database" }
            ].map((feature) => (
              <div key={feature.text} className="flex items-center gap-2 text-muted-foreground">
                <feature.icon className="h-4 w-4 text-amber-500 " />
                {feature.text}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Includes:</div>
          <div className="flex flex-wrap gap-2">
            {["Source Code", "Docker", "Legal APIs", "Deploy Scripts", "TypeScript"].map((item) => (
              <Badge key={item} variant="outline" className="text-xs" role="status">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {item}
              </Badge>
            ))}
          </div>
        </div>

        <Button
          className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700"
          onClick={() => onDownload(build.id, build.downloadUrl || `/api/sdk-builds/download/${build.id}`)}
          disabled={isDownloading}
          data-testid="button-download-nyayavigya-legal"
        >
          <Download className="h-4 w-4 mr-2" />
          {isDownloading ? 'Preparing Download...' : `Download ${build.name} ${versionLabel}`}
        </Button>
      </CardContent>
    </Card>
  );
}
