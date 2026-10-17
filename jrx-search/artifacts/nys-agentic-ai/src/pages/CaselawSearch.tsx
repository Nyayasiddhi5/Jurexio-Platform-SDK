import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useSearchCaselaw,
  getSearchCaselawQueryKey,
  useGetCaselawStats,
  useGetSimilarCases,
  getGetSimilarCasesQueryKey,
  getCaselawDocumentPdfUrl,
} from "@workspace/api-client-react";
import type { SearchCaselawParams } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Search, Scale, AlertCircle, ExternalLink, FileText, Loader2, Landmark, Globe, Sparkles, PlayCircle } from "lucide-react";
import { PdfViewerDialog, usePdfViewer } from "@/components/PdfViewerDialog";
import { useJurisdiction, isReserved, JURISDICTIONS } from "@/lib/jurisdiction";


export function extractErrorMessage(error: unknown): string {
  const fallback = "The data source is unavailable. Try again shortly.";
  const scrub =
    /password|authentication failed|InvalidClientToken|AccessDenied|ExpiredToken|secret|credential|AKIA[0-9A-Z]{16}|28P01/i;
  if (error instanceof ApiError) {
    const data = error.data as { error?: unknown } | null;
    if (data && typeof data.error === "string" && data.error.trim() !== "") {
      return scrub.test(data.error) ? fallback : data.error;
    }
  }
  if (error instanceof Error && error.message.trim() !== "") {
    return scrub.test(error.message) ? fallback : error.message;
  }
  return fallback;
}

function JudgmentPdfLink({ docId, title }: { docId: number; title?: string }) {
  const [unavailable, setUnavailable] = useState<string | null>(null);

  // Presigned SC URLs expire in 5 minutes — refetch a fresh link on every open.
  const viewer = usePdfViewer(async () => {
    try {
      const res = await getCaselawDocumentPdfUrl(docId);
      return res.url;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setUnavailable("PDF not available for this judgment");
      }
      return null;
    }
  });

  if (unavailable) {
    return <span className="text-sm text-muted-foreground">{unavailable}</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={viewer.openViewer}
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        data-testid="button-view-judgment-pdf"
      >
        <FileText className="w-3.5 h-3.5" /> View judgment PDF
      </button>
      <PdfViewerDialog viewer={viewer} title={title} />
    </>
  );
}

function SimilarCases({ docId }: { docId: number }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useGetSimilarCases(docId, undefined, {
    query: { enabled: open, queryKey: getGetSimilarCasesQueryKey(docId) },
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <Sparkles className="w-3.5 h-3.5" /> Find similar cases
      </button>
    );
  }

  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" /> Similar cases
        {data && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {data.method === "vector" ? "semantic (pgvector)" : "full-text"}
          </Badge>
        )}
      </p>
      {isLoading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Finding similar judgments...
        </p>
      )}
      {isError && <p className="text-sm text-destructive">Could not load similar cases.</p>}
      {data?.results.map((d, i) => (
        <div key={d.id ?? `s-${i}`} className="text-sm">
          <span className="font-medium">{d.title}</span>
          <span className="text-muted-foreground">
            {d.citation ? ` — ${d.citation}` : ""}{d.decisionDate ? ` · ${d.decisionDate}` : ""}
          </span>
        </div>
      ))}
      {data && data.results.length === 0 && (
        <p className="text-sm text-muted-foreground">No similar cases found.</p>
      )}
    </div>
  );
}

type CaselawQueryParams = SearchCaselawParams & { yearFrom?: number; yearTo?: number };

export default function CaselawSearch() {
  const [, setLocation] = useLocation();
  const { jurisdiction: globalJurisdiction, setJurisdiction: setGlobalJurisdiction } = useJurisdiction();
  const [searchJur, setSearchJur] = useState<"IN" | "US">(
    globalJurisdiction === "US" ? "US" : "IN",
  );
  /** FTS default for India — HC embedding coverage is partial; FTS on metadata is more reliable for recent rows. */
  const [searchMode, setSearchMode] = useState<"hybrid" | "fts">("fts");
  const [input, setInput] = useState("");
  const [year, setYear] = useState<string>("all");
  const [courtTier, setCourtTier] = useState<"all" | "sc" | "hc">("all");
  const [query, setQuery] = useState<CaselawQueryParams | null>(null);

  useEffect(() => {
    if (globalJurisdiction === "IN" || globalJurisdiction === "US") {
      setSearchJur(globalJurisdiction);
    }
  }, [globalJurisdiction]);

  const setJurisdiction = (j: "IN" | "US") => {
    setSearchJur(j);
    setGlobalJurisdiction(j);
  };

  const { data: stats } = useGetCaselawStats();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlQ = params.get("q");
    if (urlQ && urlQ.trim().length >= 2) {
      const trimmed = urlQ.trim();
      setInput(trimmed);
      setQuery({ jurisdiction: searchJur, q: trimmed, limit: 25 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading, isError, error } = useSearchCaselaw(
    query ?? { jurisdiction: "IN", q: "" },
    {
      query: {
        enabled: query !== null,
        queryKey: getSearchCaselawQueryKey(query ?? { jurisdiction: "IN", q: "" }),
      },
    },
  );

  const runSearch = () => {
    if (input.trim().length < 2) return;
    const currentYear = new Date().getFullYear();
    const params: CaselawQueryParams = {
      jurisdiction: searchJur,
      q: input.trim(),
      limit: 25,
      ...(searchJur === "IN" ? { mode: searchMode } : {}),
      ...(searchJur === "IN" && courtTier !== "all" ? { courtType: courtTier } : {}),
    };
    if (searchJur === "IN") {
      if (year === "recent") {
        params.yearFrom = Math.max(2020, currentYear - 3);
        params.yearTo = currentYear;
      } else if (year !== "all") {
        params.year = Number(year);
      }
    }
    setQuery(params);
  };

  const inScStat = stats?.sources.find((s) => s.source === "in-sc");
  const inHcStat = stats?.sources.find((s) => s.source === "in-hc");
  const inStat = inScStat;
  const corpusTotal = stats?.totalDocuments;
  const minYear = inScStat?.minYear ?? 1950;
  const maxYear = inScStat?.maxYear ?? new Date().getFullYear();

  if (isReserved(globalJurisdiction)) {
    const info = JURISDICTIONS.find((j) => j.code === globalJurisdiction);
    return (
      <div className="space-y-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-serif font-bold text-foreground">Caselaw Search</h1>
        </div>
        <Card className="border-dashed">
          <CardContent className="p-12 text-center space-y-3">
            <Globe className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-2xl font-serif font-semibold">
              {info?.flag} {info?.label} — Coming soon
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Caselaw coverage for {info?.label} is on our roadmap. India and the United States are live today — switch jurisdiction in the sidebar to search real judgments now.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={() => setGlobalJurisdiction("IN")} variant="outline" className="gap-2">
                <Landmark className="w-4 h-4" /> Switch to India
              </Button>
              <Button onClick={() => setGlobalJurisdiction("US")} variant="outline" className="gap-2">
                <Scale className="w-4 h-4" /> Switch to United States
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-serif font-bold text-foreground">Instant · Caselaw</h1>
        <p className="text-muted-foreground text-lg">
          Instant Search over Indian judgments <strong>1950–{maxYear}</strong>
          {corpusTotal ? ` (~${corpusTotal.toLocaleString()} rows in RDS)` : ""}
          — Supreme Court{inScStat ? ` (${inScStat.documentCount.toLocaleString()} SC)` : ""}
          {inHcStat ? ` + High Courts (${inHcStat.documentCount.toLocaleString()} HC)` : ""}
          , plus live US opinions via CourtListener.
          Prefer <strong>FTS</strong> for recent HC rows and snappy typeahead; hybrid adds semantic RRF where embeddings exist.
          Live web search for breaking news is on NYV Console / orchestrate. Partners: NYV SDK <code className="text-sm">instantSearch.caselaw</code>.
        </p>
      </div>

      <Card className="bg-card shadow-sm border">
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={searchJur === "IN" ? "default" : "outline"}
              onClick={() => setJurisdiction("IN")}
              className="gap-2"
            >
              <Landmark className="w-4 h-4" /> India (SC + HC)
            </Button>
            <Button
              variant={searchJur === "US" ? "default" : "outline"}
              onClick={() => setJurisdiction("US")}
              className="gap-2"
            >
              <Scale className="w-4 h-4" /> United States (live)
            </Button>
          </div>
          {searchJur === "IN" && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={courtTier === "all" ? "secondary" : "outline"}
                onClick={() => setCourtTier("all")}
              >
                All courts
              </Button>
              <Button
                size="sm"
                variant={courtTier === "sc" ? "secondary" : "outline"}
                onClick={() => setCourtTier("sc")}
              >
                Supreme Court
              </Button>
              <Button
                size="sm"
                variant={courtTier === "hc" ? "secondary" : "outline"}
                onClick={() => setCourtTier("hc")}
              >
                High Courts (FTS)
              </Button>
            </div>
          )}
          {searchJur === "IN" && (
            <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="hybrid-mode" className="text-sm font-medium">
                  Hybrid search (keyword + semantic)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Power users: FTS + pgvector RRF where embeddings exist. Turn off for keyword-only FTS (recommended for recent HC).
                </p>
              </div>
              <Switch
                id="hybrid-mode"
                checked={searchMode === "hybrid"}
                onCheckedChange={(on) => setSearchMode(on ? "hybrid" : "fts")}
                data-testid="switch-caselaw-hybrid-mode"
              />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-8 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchJur === "IN" ? "e.g. anticipatory bail, Article 21, electoral bonds..." : "e.g. adverse possession New York, Miranda rights..."}
                className="pl-9 h-10"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
              />
            </div>
            {searchJur === "IN" && (
              <div className="md:col-span-2">
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Year" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All years ({minYear}–{maxYear})</SelectItem>
                    <SelectItem value="recent">Recent ({Math.max(2020, maxYear - 3)}–{maxYear})</SelectItem>
                    {Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i).map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="md:col-span-2">
              <Button className="w-full h-10" onClick={runSearch} disabled={input.trim().length < 2}>
                Search
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && query && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Searching real legal databases...
        </div>
      )}

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-foreground">
                {error instanceof ApiError && error.status === 502
                  ? "Live source unavailable"
                  : "Search failed"}
              </p>
              <p className="text-sm text-muted-foreground">{extractErrorMessage(error)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
            <span>
              {data.total.toLocaleString()}{data.totalCapped ? "+" : ""} matching document{data.total === 1 ? "" : "s"} — showing top {data.results.length}
            </span>
            {data.method && (
              <Badge variant="outline" className="text-[10px]">
                {data.method === "hybrid_rrf" ? "hybrid (FTS + semantic)" : "keyword (FTS only)"}
              </Badge>
            )}
          </p>
          {data.results.map((doc, i) => (
            <Card key={doc.id ?? `us-${i}`} className="bg-card border shadow-sm">
              <CardContent className="p-6 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-serif font-semibold text-lg leading-snug">{doc.title}</h3>
                  <Badge variant="secondary" className="shrink-0">
                    {doc.source === "in-sc"
                      ? "SC of India"
                      : doc.source === "in-hc"
                        ? "High Court"
                        : "CourtListener"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {doc.citation && <span className="font-medium text-foreground">{doc.citation}</span>}
                  {doc.court && <span>{doc.court}</span>}
                  {doc.decisionDate && <span>{doc.decisionDate}</span>}
                  {doc.disposalNature && <span>{doc.disposalNature}</span>}
                  {doc.authorJudge && <span>Author: {doc.authorJudge}</span>}
                </div>
                {doc.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3">{doc.description}</p>
                )}
                <div className="flex items-center gap-4">
                  {doc.url && (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      View opinion <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {!doc.url && doc.pdfLink && doc.id != null && (
                    <JudgmentPdfLink docId={doc.id} title={doc.title} />
                  )}
                  {doc.s3Path && (
                    <button
                      type="button"
                      onClick={() => {
                        const params = new URLSearchParams({ refPath: doc.s3Path! });
                        params.set("refTitle", doc.title.slice(0, 200));
                        setLocation(`/new-run?${params.toString()}`);
                      }}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      data-testid="button-caselaw-use-reference"
                    >
                      Use as run reference <PlayCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {doc.source === "in-sc" && doc.id != null && <SimilarCases docId={doc.id} />}
              </CardContent>
            </Card>
          ))}
          {data.results.length === 0 && (
            data.total === 0 && data.message ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center space-y-2">
                  <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground/50" />
                  <p className="font-medium text-foreground">No results available</p>
                  <p className="text-sm text-muted-foreground max-w-xl mx-auto">{data.message}</p>
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="p-8 text-center text-muted-foreground">No matching judgments found. Try broader terms.</CardContent></Card>
            )
          )}
        </div>
      )}
    </div>
  );
}
