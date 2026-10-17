import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  ScanText, FileSearch, Database, Upload, Scale, ChevronRight,
  CheckCircle, ArrowRight, Globe, Sparkles, Shield, BookOpen, GitCompareArrows,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { apiRequest } from '@/lib/queryClient';
import { nv } from '@/lib/jrx-api-paths';
import { JRX_REGISTRY_RUNTIME } from '@/lib/jrx-registry-stats';
import {
  nvAsArray, nvAsObject, nvHealthStatus, nvJurisdictionsFromStatutesSummary,
  NV_JURISDICTION_META,
} from '@/lib/jrx-console-data';
import { JrxPageShell } from '@/components/JrxPageShell';

const PIPELINE_STEPS = [
  { id: 'ingest', label: 'Ingest', desc: 'Upload PDFs, scans, or bulk batches', path: '/bulk-doc-upload', icon: Upload },
  { id: 'ocr', label: 'OCR & Extract', desc: 'Parse layout, tables, and entities via docs-pipeline', path: '/ocr-extraction', icon: ScanText },
  { id: 'intel', label: 'Document Intelligence', desc: 'Clause detection, party IDs, risk flags', path: '/intelligence/classify', icon: Sparkles },
  { id: 'statutes', label: 'Statute Linkage', desc: 'Map sections to jurisdiction corpus & citations', path: '/statutes-citations', icon: Scale },
  { id: 'summarize', label: 'Summarize', desc: 'Executive and detailed summaries', path: '/summarization', icon: FileSearch },
  { id: 'rag', label: 'Embed & RAG', desc: 'Vectorize into namespaces for retrieval', path: '/rag-knowledge-base', icon: Database },
  { id: 'compliance', label: 'Compliance Check', desc: 'DPDPA / jurisdiction guardrails on output', path: '/dpdpa-compliance', icon: Shield },
];

const QUICK_LINKS = [
  { path: '/legal-drafting', label: 'Legal Drafting', desc: 'HC-pattern drafts · mic · district/court', icon: FileSearch },
  { path: '/ocr-extraction', label: 'OCR & Extraction', desc: 'Parse documents via docs-pipeline', icon: ScanText },
  { path: '/summarization', label: 'Summarization', desc: 'Executive and detailed summaries', icon: FileSearch },
  { path: '/rag-knowledge-base', label: 'RAG Knowledge Base', desc: 'Browse namespaces and vectors', icon: Database },
  { path: '/nys-knowledge-plane', label: 'NYS Knowledge Plane', desc: 'Federated caselaw, statutes, archive & legal-work', icon: BookOpen },
  { path: '/bulk-doc-upload', label: 'Bulk convert', desc: 'Batch doc-ai jobs (nv5)', icon: Upload },
  { path: '/statutes-citations', label: 'Statutes & Citations', desc: 'Full jurisdiction statute browser', icon: BookOpen },
  { path: '/document-redline', label: 'Redline · Merge · Highlight', desc: 'Track-changes diff, clause merge, risk highlighting', icon: GitCompareArrows },
];

export default function DocumentAiHub() {
  const [, navigate] = useLocation();
  const [jurisdiction, setJurisdiction] = useState('IN');

  const { data: healthRaw } = useQuery({
    queryKey: [nv('health')],
    queryFn: () => apiRequest(nv('health')),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: nysCoverageRaw } = useQuery({
    queryKey: [nv('knowledge/statutes/embedding/coverage')],
    queryFn: () => apiRequest(nv('knowledge/statutes/embedding/coverage')),
    staleTime: 60000,
    retry: false,
  });

  const { data: localStatutesSummaryRaw } = useQuery({
    queryKey: [nv('statutes/_summary')],
    queryFn: () => apiRequest(nv('statutes/_summary')),
    staleTime: 60000,
    retry: false,
  });

  const { data: ragRaw } = useQuery({
    queryKey: [nv('rag/collections')],
    queryFn: () => apiRequest(nv('rag/collections')),
    staleTime: 60000,
    retry: false,
  });

  const health = nvAsObject(healthRaw);
  const systemStatus = nvHealthStatus(healthRaw);
  const nysCov = nvAsObject(nysCoverageRaw);
  const jurisdictions = useMemo(
    () => nvJurisdictionsFromStatutesSummary(localStatutesSummaryRaw),
    [localStatutesSummaryRaw],
  );
  const statuteTotal = Number(
    nysCov.total
      ?? nvAsObject(localStatutesSummaryRaw).total
      ?? jurisdictions.reduce((s, j) => s + j.statutes, 0),
  );
  const statuteEmbedPct = nysCov.coveragePct != null ? Number(nysCov.coveragePct) : null;
  const ragCollections = nvAsArray(ragRaw).length || nvAsArray(nvAsObject(ragRaw).collections).length;

  const activeJ = jurisdictions.find(j => j.code === jurisdiction)
    ?? NV_JURISDICTION_META.find(j => j.code === jurisdiction)!;

  return (
    <JrxPageShell
      testId="page-document-ai-hub"
      title="Document AI Hub"
      description="End-to-end document intelligence — ingest, extract, statute linkage, summarize, embed, and compliance."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-emerald text-white hover:bg-emerald">{systemStatus}</Badge>
          <Badge variant="outline" className="border-gold text-gold">
            SDK v{JRX_REGISTRY_RUNTIME.registryVersion}
          </Badge>
          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <Globe className="h-4 w-4" />
            {jurisdictions.filter(j => j.active).length} jurisdictions · {statuteTotal.toLocaleString()} statute sections
            {statuteEmbedPct != null ? ` · NYS embed ${statuteEmbedPct}%` : ''}
          </span>
        </div>
      }
      className="./jrx-light-scope"
    >
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Statute Sections', value: statuteTotal.toLocaleString(), sub: statuteEmbedPct != null ? `NYS Knowledge Plane · embed ${statuteEmbedPct}%` : 'Knowledge Plane + local overlay' },
          { label: 'Jurisdictions', value: jurisdictions.filter(j => j.statutes > 0).length || 6, sub: 'IN·UK·EU·US·SG·GCC' },
          { label: 'RAG Namespaces', value: ragCollections || '—', sub: 'Tenant vector collections' },
          { label: 'Platform', value: health.registryVersion ?? JRX_REGISTRY_RUNTIME.registryVersion, sub: `${health.totalAgents ?? JRX_REGISTRY_RUNTIME.totalAgents} agents` },
        ].map(k => (
          <Card key={k.label} className="border-l-[3px] border-l-gold">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-2xl font-bold text-royal-blue">{k.value}</p>
              <p className="text-[10px] text-muted-foreground">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Jurisdiction E2E flow */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-royal-blue">
            <Scale className="h-4 w-4 text-gold" />
            Jurisdiction End-to-End Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={jurisdiction} onValueChange={setJurisdiction}>
            <TabsList className="flex flex-wrap h-auto gap-1">
              {NV_JURISDICTION_META.map(j => {
                const stats = jurisdictions.find(x => x.code === j.code);
                return (
                  <TabsTrigger key={j.code} value={j.code} data-testid={`doc-ai-tab-${j.code}`}>
                    {j.flag} {j.code}
                    <span className="ml-1 text-xs opacity-70">({stats?.statutes ?? 0})</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {NV_JURISDICTION_META.map(j => (
              <TabsContent key={j.code} value={j.code} className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
                  <div>
                    <p className="font-semibold text-royal-blue">{j.flag} {j.name} ({j.code})</p>
                    <p className="text-xs text-muted-foreground">
                      {(jurisdictions.find(x => x.code === j.code)?.statutes ?? 0).toLocaleString()} indexed statute sections
                      · pipeline routes through jurisdiction-aware LRM + statute linker
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/statutes-citations`)}
                    className="border-royal-blue text-royal-blue"
                  >
                    Browse {j.code} statutes <ChevronRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
                  {PIPELINE_STEPS.map((step, idx) => (
                    <div key={step.id} className="relative">
                      {idx < PIPELINE_STEPS.length - 1 && (
                        <ArrowRight className="absolute -right-3 top-8 z-10 hidden h-4 w-4 text-gold md:block" />
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(step.path)}
                        className="h-full w-full rounded-xl border border-border bg-card p-3 text-left transition-shadow hover:shadow-md"
                        data-testid={`pipeline-${j.code}-${step.id}`}
                      >
                        <step.icon className="mb-2 h-4 w-4 text-royal-blue" />
                        <p className="text-xs font-bold text-royal-blue">{step.label}</p>
                        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{step.desc}</p>
                        <div className="mt-2 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3 text-emerald" />
                          <span className="text-[10px] text-emerald">Live</span>
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Quick links */}
      <div>
        <h2 className="mb-3 font-heading text-sm font-bold text-royal-blue">
          Document AI Modules — {activeJ.flag} {activeJ.name}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map(({ path, label, desc, icon: Icon }) => (
            <Card key={path} className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-royal-blue">
                  <Icon className="h-4 w-4 text-gold" />
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">{desc}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(path)}
                  data-testid={`hub-link-${path.slice(1)}`}
                  className="border-royal-blue text-royal-blue"
                >
                  Open
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </JrxPageShell>
  );
}
