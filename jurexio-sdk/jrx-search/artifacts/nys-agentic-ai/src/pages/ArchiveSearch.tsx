import { useState } from "react";
import { useLocation } from "wouter";
import {
  useAthenaSearch,
  useGetAthenaStatus,
  getGetAthenaStatusQueryKey,
  getAthenaDocument,
  createChatConversation,
  attachArchiveDocument,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Archive,
  FileText,
  Loader2,
  ExternalLink,
  ScrollText,
  PlayCircle,
} from "lucide-react";
import { PdfViewerDialog, usePdfViewer } from "@/components/PdfViewerDialog";
import { useJurisdiction, JURISDICTIONS } from "@/lib/jurisdiction";

type ArchiveScope = "sc" | "hc" | "all";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function archiveErrorMessage(err: unknown): string {
  const e = err as {
    error?: string;
    message?: string;
    status?: number;
    data?: { error?: string; errorDetail?: { code?: string; message?: string } };
  } | null;
  const code =
    e?.data?.errorDetail?.code ||
    (typeof e?.error === "string" && e.error.includes("AUTH") ? "AUTH_REQUIRED" : undefined);
  const msg =
    e?.data?.errorDetail?.message ||
    e?.data?.error ||
    e?.error ||
    e?.message ||
    "";
  if (code === "AUTH_REQUIRED" || /auth/i.test(msg) || e?.status === 401) {
    return "Your session expired or you are not signed in. Refresh the page and sign in again to search the archive.";
  }
  if (e?.status === 504 || /timed out/i.test(msg)) {
    return "Archive search timed out. Narrow with a year filter or search Supreme Court only.";
  }
  if (e?.status === 413 || /scan budget/i.test(msg)) {
    return msg || "Query scanned too much data. Add a year filter or use Supreme Court only.";
  }
  return msg || "Archive search failed. Narrow your query with a year or court filter and try again.";
}

/**
 * "Summarize" — creates a Legal Chat conversation, attaches the archived
 * judgment (server-side fetch + text extraction with OCR fallback), and opens
 * the chat ready for a summary. "Use as reference" — opens New Run with the
 * judgment preloaded as a grounding reference document.
 */
function ArchiveDocActions({ s3Path, title }: { s3Path: string; title?: string }) {
  const [, setLocation] = useLocation();
  const [summarizing, setSummarizing] = useState(false);
  const { toast } = useToast();

  const summarize = async () => {
    setSummarizing(true);
    try {
      const conv = await createChatConversation({
        title: title ? `Summary: ${title.slice(0, 120)}` : "Judgment summary",
      });
      await attachArchiveDocument(conv.id, { s3Path, title });
      setLocation(`/chat?c=${conv.id}`);
    } catch (err) {
      const msg =
        (err as { error?: string } | null)?.error ??
        "Failed to fetch and extract this judgment. It may be a scanned file that exceeds the extraction limits.";
      toast({ title: "Could not attach judgment", description: msg, variant: "destructive" });
      setSummarizing(false);
    }
  };

  const useAsReference = () => {
    const params = new URLSearchParams({ refPath: s3Path });
    if (title) params.set("refTitle", title.slice(0, 200));
    setLocation(`/new-run?${params.toString()}`);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={summarize}
        disabled={summarizing}
        data-testid="button-summarize-doc"
      >
        {summarizing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <ScrollText className="w-3.5 h-3.5" />
        )}
        {summarizing ? "Extracting…" : "Summarize"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={useAsReference}
        data-testid="button-use-reference"
      >
        <PlayCircle className="w-3.5 h-3.5" />
        Use as reference
      </Button>
    </>
  );
}

function PdfActions({ s3Path, title }: { s3Path: string; title?: string }) {
  const viewer = usePdfViewer(async () => {
    try {
      const doc = await getAthenaDocument({ s3Path });
      return doc.url;
    } catch {
      return null;
    }
  });

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={viewer.openViewer}
        data-testid="button-view-pdf"
      >
        <FileText className="w-3.5 h-3.5" />
        View PDF
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={viewer.openInNewTab}
        disabled={viewer.tabLoading}
        data-testid="button-open-pdf"
      >
        {viewer.tabLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <ExternalLink className="w-3.5 h-3.5" />
        )}
        New tab
      </Button>

      <PdfViewerDialog viewer={viewer} title={title} />
    </div>
  );
}

export default function ArchiveSearch() {
  const [q, setQ] = useState("");
  const [year, setYear] = useState("");
  const [court, setCourt] = useState("");
  const [archive, setArchive] = useState<ArchiveScope>("sc");
  const { jurisdiction, setJurisdiction } = useJurisdiction();
  const isIndia = jurisdiction === "IN";

  const status = useGetAthenaStatus({
    query: { enabled: isIndia, queryKey: getGetAthenaStatusQueryKey() },
  });
  const search = useAthenaSearch();

  if (!isIndia) {
    const info = JURISDICTIONS.find((j) => j.code === jurisdiction);
    return (
      <div className="space-y-8">
        <h1 className="text-4xl font-serif font-bold text-foreground">Archive Search</h1>
        <Card className="border-dashed">
          <CardContent className="p-12 text-center space-y-3">
            <Archive className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-2xl font-serif font-semibold" data-testid="text-archive-coming-soon">
              {info?.flag} {info?.label} — Coming soon
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              The judgment PDF archive currently covers Indian Supreme Court and High Court documents.
              Coverage for {info?.label} is on our roadmap — switch to India in the sidebar to search the archive today.
            </p>
            <div className="flex justify-center pt-2">
              <Button onClick={() => setJurisdiction("IN")} variant="outline">Switch to India</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const run = () => {
    if (q.trim().length < 2) return;
    const yearNum = Number(year);
    search.mutate({
      data: {
        q: q.trim(),
        archive,
        ...(year && Number.isInteger(yearNum) ? { year: yearNum } : {}),
        ...(court.trim() ? { court: court.trim() } : {}),
        limit: 25,
      },
    });
  };

  const result = search.data;
  const configured = status.data?.configured ?? true;
  const statusAuthFailed =
    status.isError && /auth|401|sign in/i.test(archiveErrorMessage(status.error));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-serif font-bold text-foreground">Archive Search</h1>
        <p className="text-muted-foreground text-lg">
          Search judgment PDF archives (Athena over the S3 document lake) by{" "}
          <span className="text-foreground font-medium">title and description metadata</span>
          — not full judgment text. For semantic / doctrine search use{" "}
          <a href="/caselaw" className="underline underline-offset-2">Caselaw Instant Search</a>.
        </p>
      </div>

      {statusAuthFailed && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 text-sm">
            <p className="font-semibold text-foreground">Sign in required</p>
            <p className="text-muted-foreground mt-1">{archiveErrorMessage(status.error)}</p>
          </CardContent>
        </Card>
      )}

      {!status.isLoading && !configured && (
        <Card className="border-amber-600/40 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-6 flex items-start gap-3">
            <Archive className="w-5 h-5 text-amber-600 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Archive search is not configured in this environment.</p>
              <p>It is available in production, where the Athena document tables are set up.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card shadow-sm border">
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Archive scope">
            {(
              [
                { id: "sc" as const, label: "Supreme Court" },
                { id: "hc" as const, label: "High Courts" },
                { id: "all" as const, label: "All (slower)" },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={archive === opt.id ? "default" : "outline"}
                onClick={() => setArchive(opt.id)}
                data-testid={`button-archive-scope-${opt.id}`}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          {archive === "all" && (
            <p className="text-xs text-muted-foreground">
              Searching SC + HC scans more data. Prefer a year filter to keep cost and latency down.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5">
              <Input
                placeholder='Party / title, e.g. "anticipatory bail" or a party name'
                className="h-10"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                data-testid="input-archive-query"
              />
            </div>
            <div className="md:col-span-2">
              <Input
                placeholder="Year"
                className="h-10"
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && run()}
                data-testid="input-archive-year"
              />
            </div>
            <div className="md:col-span-3">
              <Input
                placeholder="Court"
                className="h-10"
                value={court}
                onChange={(e) => setCourt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                data-testid="input-archive-court"
              />
            </div>
            <div className="md:col-span-2">
              <Button
                className="w-full h-10"
                onClick={run}
                disabled={q.trim().length < 2 || search.isPending || !configured || statusAuthFailed}
                data-testid="button-archive-search"
              >
                {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {search.isPending && (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center text-muted-foreground text-sm">
            <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
            Scanning {archive === "sc" ? "Supreme Court" : archive === "hc" ? "High Court" : "SC + HC"}{" "}
            metadata — this can take up to 45 seconds…
          </CardContent>
        </Card>
      )}

      {search.isError && (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-muted-foreground">
            {archiveErrorMessage(search.error)}
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {result.results.length} result{result.results.length === 1 ? "" : "s"}
            </span>
            <Badge variant="secondary">scanned {formatBytes(result.bytesScanned)}</Badge>
            <Badge variant="secondary">~${result.estimatedCostUsd.toFixed(4)} query cost</Badge>
            <Badge variant="outline">
              {archive === "sc" ? "SC" : archive === "hc" ? "HC" : "SC+HC"}
            </Badge>
          </div>

          {result.results.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="p-10 text-center text-muted-foreground text-sm space-y-2">
                <p className="font-medium text-foreground">No documents matched title or description</p>
                <p>
                  Archive search only matches <strong>title</strong> and <strong>description</strong>{" "}
                  fields in Athena metadata — not the full PDF body. Try a party name, shorten the query,
                  add/remove the year, or switch scope. For legal-concept search use Caselaw Instant Search.
                </p>
              </CardContent>
            </Card>
          )}

          {result.results.map((row, i) => (
            <Card key={`${row.s3_path ?? i}`} className="bg-card border shadow-sm" data-testid={`card-archive-result-${i}`}>
              <CardContent className="p-6 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-serif font-semibold leading-snug">
                        {row.title ?? "Untitled judgment"}
                      </h3>
                      {row.archive && (
                        <Badge variant="secondary">{String(row.archive).toUpperCase()}</Badge>
                      )}
                    </div>
                  </div>
                  {row.s3_path && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <PdfActions s3Path={row.s3_path} title={row.title ?? undefined} />
                      <ArchiveDocActions s3Path={row.s3_path} title={row.title ?? undefined} />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {row.citation && <span className="font-medium text-foreground">{row.citation}</span>}
                  {row.court && <span>{row.court}</span>}
                  {row.decision_date && <span>{row.decision_date}</span>}
                  {row.year && <span>{row.year}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
