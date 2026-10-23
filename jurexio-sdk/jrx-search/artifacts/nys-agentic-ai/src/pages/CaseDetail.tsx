import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Copy, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { CaseDocumentsPanel } from "@/components/CaseDocumentsPanel";
import { CaseTimeline } from "@/components/CaseTimeline";
import { CaseFieldSections, fieldDisplayValue } from "@/components/CaseFieldSections";
import { CorpusSourceBadge } from "@/components/CorpusSourceBadge";
import { getCnr } from "@/lib/cnrApi";
import type { CnrResolveData } from "@/lib/cnrTypes";
import { extractErrorMessage } from "@/pages/CaselawSearch";
import { useToast } from "@/hooks/use-toast";

function CaseDetailContent({ data }: { data: CnrResolveData }) {
  const { toast } = useToast();
  const fields = data.fields ?? {};
  const timeline = data.caseCreate?.timeline ?? [];

  const copyCnr = () => {
    void navigator.clipboard.writeText(data.cnr);
    toast({ title: "CNR copied" });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <CorpusSourceBadge
            badge={data.ui.badge}
            source={data.source}
            claimEcourts={data.claimEcourts}
          />
          <h1 className="text-2xl font-serif tracking-tight">
            {fieldDisplayValue(fields.caseTitle) ??
              fieldDisplayValue(data.caseCreate?.header.caseTitle) ??
              "Case detail"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{data.cnr}</span>
            {data.lookupType === "diary" && data.diaryNumber && (
              <Badge variant="secondary">Diary {data.diaryNumber}</Badge>
            )}
            {fieldDisplayValue(fields.caseStatus) && (
              <Badge>{fieldDisplayValue(fields.caseStatus)}</Badge>
            )}
            {data.meta?.tier && (
              <Badge variant="outline" className="font-normal">
                tier {data.meta.tier}
              </Badge>
            )}
          </div>
          {data.meta?.latencyMs != null && (
            <p className="text-xs text-muted-foreground">
              Resolved in {data.meta.latencyMs}ms · NYV 56-field envelope (caseCreate)
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyCnr}>
            <Copy className="w-3.5 h-3.5 mr-1" /> Copy CNR
          </Button>
          <Link href="/case-lookup">
            <Button type="button" variant="outline" size="sm">
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> New lookup
            </Button>
          </Link>
        </div>
      </div>

      {data.sourcesTried.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Sources tried</summary>
          <p className="mt-1 font-mono">{data.sourcesTried.join(" → ")}</p>
        </details>
      )}

      <CaseFieldSections data={data} />
      <CaseTimeline entries={timeline} />
      <CaseDocumentsPanel cnr={data.cnr} initialDocuments={data.documents} />

      {data.meta?.attribution && (
        <p className="text-xs text-muted-foreground">{data.meta.attribution}</p>
      )}

      <div className="flex gap-2">
        <Link href="/patra-mitra">
          <Button type="button" variant="secondary" size="sm">
            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open in Patra Mitra
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function CaseDetail() {
  const params = useParams<{ cnr: string }>();
  const cnrParam = params.cnr ? decodeURIComponent(params.cnr) : "";
  const [data, setData] = useState<CnrResolveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cnrParam) {
      setLoading(false);
      setError("Missing CNR in URL");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCnr(cnrParam)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cnrParam]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-64 w-full" />
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading full case file (56-field resolve)…
        </p>
      </div>
    );
  }

  if (error || !data || data.status !== "found") {
    return (
      <div className="space-y-4">
        <Link href="/case-lookup">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to lookup
          </Button>
        </Link>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error ?? "Case not found in judgment corpus."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <CaseDetailContent data={data} />;
}
