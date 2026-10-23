import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Search, AlertCircle, FolderSearch, RefreshCw } from "lucide-react";
import { CnrCandidatePicker } from "@/components/CnrCandidatePicker";
import { CorpusSourceBadge } from "@/components/CorpusSourceBadge";
import {
  CnrApiError,
  CNR_DEEP_SEARCH_TIMEOUT_MS,
  fetchEcourtsLiveStatus,
  isRetryableCnrError,
  normalizeCnrInput,
  resolveCnrLive,
  resolveCnrWithRetry,
} from "@/lib/cnrApi";
import type { CnrCandidate, CnrResolveData } from "@/lib/cnrTypes";
import {
  DASHBOARD_CNR_PROFILE,
  DASHBOARD_DEEP_OPTIONS,
  DASHBOARD_LOOKUP_OPTIONS,
} from "@/lib/cnrTypes";
import { extractErrorMessage } from "@/pages/CaselawSearch";

type LookupMode = "cnr" | "diary";
type CourtType = "sc" | "hc" | "dc";

export default function CaseLookup() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<LookupMode>("cnr");
  const [courtType, setCourtType] = useState<CourtType>("hc");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [slowHint, setSlowHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [notFound, setNotFound] = useState<CnrResolveData | null>(null);
  const [candidates, setCandidates] = useState<CnrCandidate[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [liveConfigured, setLiveConfigured] = useState<boolean | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [deepSearching, setDeepSearching] = useState(false);
  const [fastNotFound, setFastNotFound] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef<number>(0);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSlowHint(false);
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    fetchEcourtsLiveStatus()
      .then((s) => setLiveConfigured(s.configured))
      .catch(() => setLiveConfigured(false));
  }, []);

  const startElapsed = () => {
    startedRef.current = Date.now();
    setElapsedMs(0);
    setSlowHint(false);
    timerRef.current = setInterval(() => {
      const ms = Date.now() - startedRef.current;
      setElapsedMs(ms);
      if (ms >= 8000) setSlowHint(true);
    }, 200);
  };

  const runSearch = async (override?: {
    cnr?: string;
    diary?: string;
    live?: boolean;
    deep?: boolean;
  }) => {
    setError(null);
    setRetryable(false);
    setNotFound(null);
    setCandidates([]);
    setFastNotFound(false);
    const isDeep = override?.deep === true;
    setDeepSearching(isDeep);
    setLoading(true);
    if (override?.live) setLiveLoading(true);
    startElapsed();

    const raw = (override?.cnr ?? override?.diary ?? input).trim();
    if (!raw) {
      setError(mode === "cnr" ? "Enter a CNR number" : "Enter a diary number");
      setLoading(false);
      clearTimers();
      return;
    }

    if (mode === "diary" && !override?.cnr && !courtType) {
      setError("Select a court tier for diary lookup");
      setLoading(false);
      clearTimers();
      return;
    }

    try {
      const resolveInput =
        override?.cnr
          ? {
              cnr: normalizeCnrInput(override.cnr),
              options: { ...(isDeep ? DASHBOARD_DEEP_OPTIONS : DASHBOARD_LOOKUP_OPTIONS), courtType },
            }
          : mode === "cnr"
            ? {
                cnr: normalizeCnrInput(raw),
                options: { ...(isDeep ? DASHBOARD_DEEP_OPTIONS : DASHBOARD_LOOKUP_OPTIONS), courtType },
              }
            : {
                diaryNumber: raw,
                options: { ...(isDeep ? DASHBOARD_DEEP_OPTIONS : DASHBOARD_LOOKUP_OPTIONS), courtType },
              };

      const data = override?.live
        ? await resolveCnrLive(resolveInput)
        : await resolveCnrWithRetry(resolveInput, {
            timeoutMs: isDeep ? CNR_DEEP_SEARCH_TIMEOUT_MS : undefined,
          });

      if (data.status === "found" && data.cnr) {
        setLocation(`/case/${encodeURIComponent(data.cnr)}`);
        return;
      }
      if (data.status === "suggested" && data.candidates.length > 0) {
        setCandidates(data.candidates);
        setPickerOpen(true);
        return;
      }
      if (data.status === "not_found" || data.status === "invalid") {
        if (data.status === "not_found" && !isDeep && !override?.live) {
          setFastNotFound(true);
        }
        setNotFound(data);
        if (data.status === "invalid") {
          setError(data.ui.subtitle || "Invalid lookup input");
        }
        return;
      }
      setError("Unexpected lookup result");
    } catch (err) {
      if (err instanceof CnrApiError && err.data?.status === "invalid") {
        setError(err.data.ui.subtitle || err.message);
      } else {
        setError(extractErrorMessage(err));
        setRetryable(isRetryableCnrError(err));
      }
    } finally {
      setLoading(false);
      setLiveLoading(false);
      setDeepSearching(false);
      clearTimers();
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif tracking-tight flex items-center gap-2">
          <FolderSearch className="w-8 h-8 text-primary" />
          Case Lookup
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          Search by CNR or diary number across Supreme Court, High Court, and District Court judgment
          corpus. Fast RDS lookup first; opt-in deep search ({DASHBOARD_CNR_PROFILE} profile) checks
          archive parquet and FTS when a case is not in the hot index.
        </p>
        <div className="mt-3">
          <CorpusSourceBadge badge="Judgment corpus" claimEcourts={false} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-serif">Search</CardTitle>
          <CardDescription>CNR or diary number · SC / HC / DC</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Lookup mode</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as LookupMode)}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="cnr" id="mode-cnr" />
                  <Label htmlFor="mode-cnr" className="font-normal cursor-pointer">
                    CNR
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="diary" id="mode-diary" />
                  <Label htmlFor="mode-diary" className="font-normal cursor-pointer">
                    Diary number
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="court-type">Court tier</Label>
                <Select value={courtType} onValueChange={(v) => setCourtType(v as CourtType)}>
                  <SelectTrigger id="court-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sc">Supreme Court (SC)</SelectItem>
                    <SelectItem value="hc">High Court (HC)</SelectItem>
                    <SelectItem value="dc">District Court (DC)</SelectItem>
                  </SelectContent>
                </Select>
                {mode === "diary" && (
                  <p className="text-xs text-muted-foreground">Required for diary lookup</p>
                )}
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="lookup-input">
                  {mode === "cnr" ? "CNR number" : "Diary number"}
                </Label>
                <Input
                  id="lookup-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    mode === "cnr"
                      ? "e.g. TSWL000000742024"
                      : "e.g. 2023 INSC 1081 or 12345/2024"
                  }
                  className="font-mono uppercase"
                  autoComplete="off"
                  data-testid="case-lookup-input"
                />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="gap-2">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Look up case
                </>
              )}
            </Button>
          </form>

          {loading && (
            <div className="mt-6 space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {deepSearching
                  ? "Deep corpus search (archive + FTS)…"
                  : liveLoading
                    ? "Checking live eCourts…"
                    : "Searching judgment corpus…"}{" "}
                {(elapsedMs / 1000).toFixed(1)}s
              </p>
              {(slowHint || deepSearching) && (
                <p className="text-amber-700 dark:text-amber-400">
                  {deepSearching
                    ? "Scanning archive index — may take up to 45s"
                    : "Checking archive index…"}
                </p>
              )}
            </div>
          )}

          {retryable && error && !loading && (
            <Alert variant="default" className="mt-6 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Lookup temporarily busy</AlertTitle>
              <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3 mt-2">
                <span>{error} — RDS may be under load. Retries use 2s / 4s / 8s backoff.</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void runSearch()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {error && !retryable && !loading && (
            <Alert variant="destructive" className="mt-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Lookup failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {notFound?.status === "not_found" && !loading && (
            <div className="mt-6 rounded-lg border border-dashed p-8 text-center space-y-3">
              <p className="font-medium">Not in fast judgment index</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {fastNotFound
                  ? "The hot RDS index did not contain this CNR. Many matters exist only in archive parquet or FTS — run Deep corpus search before treating this as a true miss."
                  : notFound.ui.subtitle ||
                    "No matching case in the disposed judgment index for this CNR or diary number."}
              </p>
              <CorpusSourceBadge badge={notFound.ui.badge} source={notFound.source} />
              {fastNotFound && mode === "cnr" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || deepSearching}
                  title={`Deep search uses ${DASHBOARD_CNR_PROFILE} profile — archive parquet + FTS (~7–45s)`}
                  onClick={() => void runSearch({ deep: true })}
                >
                  {deepSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-1" /> Deep corpus search…
                    </>
                  ) : (
                    "Deep corpus search (archive + FTS)"
                  )}
                </Button>
              )}
              {liveConfigured === false && (
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Live eCourts is not configured on this worker (NYV_ECOURTS_API_KEY absent).
                  Corpus lookup remains available.
                </p>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={!liveConfigured || loading || liveLoading || mode === "diary"}
                title={
                  mode === "diary"
                    ? "Live lookup requires CNR"
                    : liveConfigured
                      ? "Query NIC eCourts API (60–120s)"
                      : "NYV_ECOURTS_API_KEY not set on worker"
                }
                onClick={() => void runSearch({ live: true })}
              >
                {liveLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" /> Checking live eCourts…
                  </>
                ) : (
                  "Check live eCourts"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CnrCandidatePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        candidates={candidates}
        onSelect={(cnr) => void runSearch({ cnr })}
      />
    </div>
  );
}
