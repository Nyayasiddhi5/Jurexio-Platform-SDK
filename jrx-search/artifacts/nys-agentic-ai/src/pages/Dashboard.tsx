import { useGetDashboardSummary, getGetDashboardSummaryQueryKey, useGetUsageAnalytics, useGetCaselawStats, getGetCaselawStatsQueryKey, useGetCitationAnalytics, useGetLitigationAnalytics, useListTemplates, type JurisdictionFilter } from "@workspace/api-client-react";
import { useJurisdiction, isAllJurisdictions, JURISDICTIONS, jurisdictionQueryParam } from "@/lib/jurisdiction";
import { ReservedJurisdictionNotice } from "@/components/ReservedJurisdictionNotice";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PlayCircle, FileText, CheckCircle2, Clock, AlertCircle, AlertTriangle, Database, Scale, BookOpen } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";

const SCOPE_LABELS: Record<string, string> = {
  all: "Full corpus",
  sc: "Supreme Court",
  hc: "High Courts",
};

const STALE_AFTER_MS = 30 * 60 * 1000;

function EmbeddingProgressSection() {
  const { jurisdiction } = useJurisdiction();
  const enabled = jurisdiction === "IN" || jurisdiction === "ALL";
  const { data: stats } = useGetCaselawStats({
    query: {
      enabled,
      queryKey: getGetCaselawStatsQueryKey(),
      refetchInterval: enabled ? 60_000 : false,
    },
  });
  if (!enabled) return null;
  const progress = stats?.embedding;
  if (!stats || !progress || progress.length === 0) return null;

  const sourceCount = (prefix: string) =>
    stats.sources
      .filter((s) => s.source.startsWith(prefix))
      .reduce((sum, s) => sum + s.documentCount, 0);
  const denominators: Record<string, number> = {
    all: stats.totalDocuments,
    sc: sourceCount("in-sc"),
    hc: sourceCount("in-hc"),
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-serif font-bold border-b pb-2 flex items-center gap-2">
        <Database className="w-5 h-5 text-primary" />
        India semantic search readiness
        <span className="text-sm font-sans font-normal text-muted-foreground">
          embedding backfill · counsel corpus 1950–2026
        </span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {progress.map((p) => {
          const denominator = denominators[p.scope] ?? 0;
          const embedded = p.totalEmbedded ?? p.embeddedInRun;
          const pct =
            denominator > 0
              ? Math.min((embedded / denominator) * 100, 100)
              : null;
          const complete = pct !== null && denominator - embedded <= 0;
          const updatedAtMs = Date.parse(p.updatedAt);
          const isStale =
            !complete &&
            Number.isFinite(updatedAtMs) &&
            Date.now() - updatedAtMs > STALE_AFTER_MS;

          return (
            <Card key={p.scope} className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between gap-2">
                  <span>
                    🇮🇳 India · {SCOPE_LABELS[p.scope] ?? p.scope}
                  </span>
                  {complete ? (
                    <span className="flex items-center gap-1 text-emerald-600 normal-case tracking-normal text-xs font-semibold">
                      <CheckCircle2 className="w-4 h-4" /> Complete
                    </span>
                  ) : isStale ? (
                    <span className="flex items-center gap-1 text-amber-600 normal-case tracking-normal text-xs font-semibold">
                      <AlertTriangle className="w-4 h-4" /> Stalled
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-primary normal-case tracking-normal text-xs font-semibold">
                      <Clock className="w-4 h-4" /> In progress
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-bold font-serif">
                    {pct !== null ? `${pct >= 100 ? 100 : pct.toFixed(pct < 10 ? 2 : 1)}%` : "—"}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {embedded.toLocaleString()}
                    {denominator > 0 ? ` / ${denominator.toLocaleString()}` : ""}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${complete ? "bg-emerald-500" : isStale ? "bg-amber-500" : "bg-primary/70"}`}
                    style={{ width: `${Math.max(pct ?? 0, 1)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  India semantic readiness — last checkpoint{" "}
                  {Number.isFinite(updatedAtMs)
                    ? formatDistanceToNow(new Date(updatedAtMs), { addSuffix: true })
                    : "unknown"}
                  {isStale && " — no recent progress; the backfill may have stopped"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

type StatuteCoveragePayload = {
  total: number;
  embedded: number;
  unembedded: number;
  coveragePct: number;
  slo?: { targetCoveragePct: number; overallStatus: string };
};

function KnowledgeCorpusSection() {
  const { jurisdiction } = useJurisdiction();
  const jParam =
    jurisdiction === "ALL" ? undefined : (jurisdiction as "IN" | "US");
  const { data: templates } = useListTemplates(
    jParam ? { jurisdiction: jParam } : undefined,
    { query: { queryKey: ["dashboard-templates", jParam ?? "ALL"] } },
  );
  const { data: coverage } = useQuery({
    queryKey: ["statute-embedding-coverage"],
    queryFn: async (): Promise<StatuteCoveragePayload> => {
      const res = await fetch("/api/statutes/embedding/coverage", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`coverage ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const { data: acts } = useQuery({
    queryKey: ["statute-acts", jParam ?? "ALL"],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (jParam) qs.set("jurisdiction", jParam);
      const res = await fetch(`/api/statutes/acts?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`acts ${res.status}`);
      return res.json() as Promise<{
        total?: number;
        totalSections?: number;
        results?: unknown[];
      }>;
    },
    refetchInterval: 120_000,
  });

  const templateCount = templates?.length ?? 0;
  const filingReady =
    templates?.filter((t) =>
      (t.tags ?? []).some((tag) => /filing-ready|multi-party/i.test(tag)),
    ).length ?? 0;
  const covPct = coverage?.coveragePct;
  const covOk =
    coverage?.slo?.overallStatus === "ok" ||
    (typeof covPct === "number" && covPct >= 99);

  return (
    <div className="space-y-4" data-testid="knowledge-corpus-section">
      <h2 className="text-2xl font-serif font-bold border-b pb-2 flex items-center gap-2">
        <Scale className="w-5 h-5 text-primary" />
        Knowledge corpus
        <span className="text-sm font-sans font-normal text-muted-foreground">
          statutes · templates · filing instruments (no model routing)
        </span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> Statute sections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-serif">
              {coverage?.total != null ? coverage.total.toLocaleString() : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {coverage
                ? `${coverage.embedded.toLocaleString()} embedded · ${coverage.unembedded.toLocaleString()} pending`
                : "Loading coverage…"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Statute search readiness
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-serif">
              {covPct != null ? `${covPct.toFixed(1)}%` : "—"}
            </div>
            <p className={`text-xs mt-1 ${covOk ? "text-emerald-700" : "text-amber-700"}`}>
              {coverage?.slo?.overallStatus
                ? `SLO ${coverage.slo.overallStatus}`
                : "hybrid FTS + vector"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Templates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-serif">{templateCount || "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {filingReady > 0
                ? `${filingReady} filing-ready / multi-party`
                : jParam
                  ? `Filtered · ${jParam}`
                  : "All jurisdictions"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Acts catalog
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-serif">
              {acts?.total != null ? acts.total.toLocaleString() : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {acts?.totalSections != null
                ? `${acts.totalSections.toLocaleString()} sections in catalog`
                : "Browse under Statutes · search stays hybrid"}
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/statutes">
          <Button variant="outline" size="sm">
            Open statutes
          </Button>
        </Link>
        <Link href="/templates">
          <Button variant="outline" size="sm">
            Open templates
          </Button>
        </Link>
      </div>
    </div>
  );
}

function UsageAnalyticsSection() {
  const { jurisdiction } = useJurisdiction();
  const jParam = jurisdiction === "ALL" ? "ALL" : jurisdiction;
  const jurisdictionInfo = JURISDICTIONS.find((j) => j.code === jurisdiction);
  const { data: usage } = useGetUsageAnalytics(
    { days: 30, jurisdiction: jParam as "ALL" | "IN" | "US" },
    { query: { queryKey: ["usage-analytics", jParam] } },
  );
  if (!usage || usage.totals.totalRequests === 0) return null;

  const maxDay = Math.max(...usage.byDay.map((d) => d.count), 1);
  const maxFeature = Math.max(...usage.byFeature.map((f) => f.count), 1);
  const maxJurisdiction = Math.max(...usage.byJurisdiction.map((j) => j.count), 1);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-serif font-bold border-b pb-2">
        Platform usage{" "}
        <span className="text-sm font-sans font-normal text-muted-foreground">
          last {usage.windowDays} days · {jurisdictionInfo?.label ?? jurisdiction} · feature & latency only
        </span>
      </h2>
      {Array.isArray(usage.byJurisdiction) && usage.byJurisdiction.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="usage-by-jurisdiction">
          {usage.byJurisdiction.map((row: { jurisdiction: string; count: number }) => (
            <Badge key={row.jurisdiction} variant="outline" className="text-xs">
              {row.jurisdiction}: {row.count}
            </Badge>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-serif">{usage.totals.totalRequests}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Avg Latency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-serif">
              {usage.totals.avgLatencyMs != null ? `${usage.totals.avgLatencyMs} ms` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">p95 Latency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-serif">
              {usage.totals.p95LatencyMs != null ? `${usage.totals.p95LatencyMs} ms` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-serif">{usage.totals.errorCount}</div>
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {usage.scoresOverTime.length > 0 && (
          <div>
            <h3 className="text-lg font-serif font-bold mb-3">Evaluation Score Trend</h3>
            <div className="bg-card border rounded-md p-4 flex items-end gap-1 h-36">
              {usage.scoresOverTime.map((s) => (
                <div
                  key={s.day}
                  className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
                  title={`${s.day}: avg score ${s.avgScore ?? "—"} (${s.runCount} run${s.runCount === 1 ? "" : "s"})`}
                >
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {s.avgScore ?? ""}
                  </span>
                  <div
                    className="w-full bg-emerald-500/70 rounded-sm"
                    style={{ height: `${Math.max(s.avgScore ?? 0, 4)}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <h3 className="text-lg font-serif font-bold mb-3">Requests by Day</h3>
          <div className="bg-card border rounded-md p-4 flex items-end gap-1 h-36">
            {usage.byDay.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${d.day}: ${d.count} requests`}>
                <div
                  className="w-full bg-primary/70 rounded-sm"
                  style={{ height: `${Math.max((d.count / maxDay) * 100, 4)}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-lg font-serif font-bold mb-3">Top Features</h3>
          <div className="space-y-2">
            {usage.byFeature.slice(0, 6).map((f) => (
              <div key={f.feature} className="flex items-center gap-3">
                <span className="w-32 text-sm font-medium truncate">{f.feature}</span>
                <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70"
                    style={{ width: `${(f.count / maxFeature) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-muted-foreground w-10 text-right">{f.count}</span>
              </div>
            ))}
          </div>
        </div>
        {usage.byJurisdiction.length > 0 && (
          <div>
            <h3 className="text-lg font-serif font-bold mb-3">Requests by Jurisdiction</h3>
            <div className="space-y-2">
              {usage.byJurisdiction.map((j) => (
                <div key={j.jurisdiction} className="flex items-center gap-3">
                  <span className="w-32 text-sm font-medium truncate">{j.jurisdiction}</span>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/70"
                      style={{ width: `${(j.count / maxJurisdiction) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-10 text-right">{j.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OpenDataAnalyticsSection() {
  const { data: citations } = useGetCitationAnalytics();
  const { data: litigation } = useGetLitigationAnalytics();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-serif font-bold border-b pb-2">Open Data analytics (scaffold)</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Citation treatment</CardTitle>
            <CardDescription>Read-only aggregates from grounded authorities on completed runs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {citations && citations.totalAuthorityRefs > 0 ? (
              <>
                <p>
                  <span className="font-semibold">{citations.runsWithAuthorities}</span> runs with authorities ·{" "}
                  <span className="font-semibold">{citations.totalAuthorityRefs}</span> authority refs
                </p>
                {citations.bySource.length > 0 && (
                  <ul className="space-y-1 text-muted-foreground">
                    {citations.bySource.slice(0, 5).map((s) => (
                      <li key={s.source}>
                        {s.source}: {s.count}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{citations?.note ?? "Loading citation aggregates…"}</p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Litigation analytics</CardTitle>
            <CardDescription>Run counts by work type and jurisdiction (DB aggregates).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {litigation && litigation.totalRuns > 0 ? (
              <>
                <p>
                  <span className="font-semibold">{litigation.totalRuns}</span> runs
                  {litigation.avgScore != null ? ` · avg score ${litigation.avgScore}%` : ""}
                </p>
                {litigation.byWorkType.length > 0 && (
                  <ul className="space-y-1 text-muted-foreground">
                    {litigation.byWorkType.slice(0, 5).map((w) => (
                      <li key={w.workType} className="capitalize">
                        {w.workType}: {w.count}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{litigation?.note ?? "Loading litigation aggregates…"}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { jurisdiction } = useJurisdiction();
  const jParam = jurisdictionQueryParam(jurisdiction);
  const { data: summary, isLoading, isError } = useGetDashboardSummary(
    { jurisdiction: jParam },
    { query: { queryKey: getGetDashboardSummaryQueryKey({ jurisdiction: jParam }) } },
  );

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-8 bg-muted w-1/4 rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-muted rounded"></div>)}
        </div>
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-muted-foreground">
        <AlertCircle className="w-12 h-12 mb-4 text-destructive" />
        <h2 className="text-xl font-serif text-foreground mb-2">Unable to load dashboard</h2>
        <p>Could not fetch the dashboard summary. Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-serif font-bold text-foreground mb-2">Knowledge Workbench</h1>
          <p className="text-muted-foreground">
            Corpus health, Instant Search (statutes/caselaw), and evaluation runs. Partner typeahead via NYV SDK 5.0.7.
          </p>
          {isAllJurisdictions(jurisdiction) && (
            <p className="text-sm text-muted-foreground mt-1">Combined view across India and the United States.</p>
          )}
        </div>
        <Link href="/run/new">
          <Button size="lg" className="gap-2 font-medium">
            <PlayCircle className="w-5 h-5" />
            Start New Run
          </Button>
        </Link>
      </div>

      <ReservedJurisdictionNotice surface="analytics" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/statutes" className="block">
          <Card className="shadow-sm hover:shadow-md transition-shadow h-full border-t-4 border-t-[#C7B15B]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <Scale className="w-4 h-4 text-primary" /> Instant · Statutes
              </CardTitle>
              <CardDescription>Section / act search (hybrid FTS + vector)</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/caselaw" className="block">
          <Card className="shadow-sm hover:shadow-md transition-shadow h-full border-t-4 border-t-[#C7B15B]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" /> Instant · Caselaw
              </CardTitle>
              <CardDescription>Judgment search — SC + HC FTS, 1950–2026 · hybrid optional</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <a
          href="https://console.nyayasiddhi.online/console/legal-intelligence-feed"
          className="block"
          target="_blank"
          rel="noreferrer"
        >
          <Card className="shadow-sm hover:shadow-md transition-shadow h-full border-t-4 border-t-[#152448]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif flex items-center gap-2">
                Live Legal Feed
              </CardTitle>
              <CardDescription>Daily RSS digest · fused into Auto-RAG · NYV Console</CardDescription>
            </CardHeader>
          </Card>
        </a>
      </div>

      <KnowledgeCorpusSection />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-t-4 border-t-primary shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold font-serif">{summary.totalRuns}</div>
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-primary shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tasks Available</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold font-serif">{summary.totalTasks}</div>
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-primary shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Practice Areas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold font-serif">{summary.totalCategories}</div>
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-primary shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Avg Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold font-serif">
              {summary.avgScore ? `${Math.round(summary.avgScore)}%` : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {isAllJurisdictions(jurisdiction) && summary.byJurisdiction && summary.byJurisdiction.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {summary.byJurisdiction.map((row) => (
            <Card key={row.jurisdiction} className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Runs · {row.jurisdiction}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold font-serif">{row.count}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="col-span-2 space-y-6">
          <h2 className="text-2xl font-serif font-bold border-b pb-2">Recent Runs</h2>
          {summary.recentRuns.length === 0 ? (
            <div className="p-12 text-center bg-card border rounded-lg text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No runs have been performed yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {summary.recentRuns.map(run => (
                <Card key={run.id} className="transition-shadow hover:shadow-md">
                  <div className="flex p-5 gap-4 items-start">
                    <div className="mt-1">
                      {run.status === "completed" ? (
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                      ) : run.status === "failed" ? (
                        <AlertCircle className="w-5 h-5 text-destructive" />
                      ) : (
                        <Clock className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <Link href={`/run/${run.id}`} className="font-semibold text-lg hover:underline truncate">
                          {run.title}
                        </Link>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(run.createdAt), "MMM d, yyyy")}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="bg-muted px-2 py-0.5 rounded font-medium text-foreground">{run.categoryName}</span>
                        <span className="capitalize">{run.workType}</span>
                        {run.jurisdiction && (
                          <span className="bg-muted px-2 py-0.5 rounded font-medium text-foreground">{run.jurisdiction}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-serif font-bold border-b pb-2 mb-4">Work Types</h2>
            <div className="space-y-3">
              {summary.byWorkType.map(wt => (
                <div key={wt.workType} className="flex justify-between items-center bg-card border px-4 py-3 rounded-md">
                  <span className="capitalize font-medium">{wt.workType}</span>
                  <span className="text-muted-foreground font-mono bg-muted px-2 py-1 rounded text-sm">{wt.count}</span>
                </div>
              ))}
              {summary.byWorkType.length === 0 && <p className="text-muted-foreground text-sm">No data available.</p>}
            </div>
          </div>
          <div>
            <h2 className="text-xl font-serif font-bold border-b pb-2 mb-4">Top Practice Areas</h2>
            <div className="space-y-3">
              {summary.topCategories.map(c => (
                <div key={c.category} className="flex justify-between items-center bg-card border px-4 py-3 rounded-md">
                  <span className="font-medium truncate mr-4">{c.categoryName}</span>
                  <span className="text-muted-foreground font-mono bg-muted px-2 py-1 rounded text-sm">{c.count}</span>
                </div>
              ))}
              {summary.topCategories.length === 0 && <p className="text-muted-foreground text-sm">No data available.</p>}
            </div>
          </div>
        </div>
      </div>

      <EmbeddingProgressSection />

      <OpenDataAnalyticsSection />

      <UsageAnalyticsSection />
    </div>
  );
}
