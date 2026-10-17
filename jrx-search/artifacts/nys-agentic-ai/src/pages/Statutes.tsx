import { useEffect, useState } from "react";
import {
  useListStatutes,
  getListStatutesQueryKey,
  useSearchStatutes,
  getSearchStatutesQueryKey,
  useListStatuteActs,
  getListStatuteActsQueryKey,
} from "@workspace/api-client-react";
import type { Statute, StatuteAct } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, BookMarked, Loader2, ArrowRight, ArrowLeft, Landmark, ScrollText, Globe, Info } from "lucide-react";
import { Link } from "wouter";
import { useJurisdiction, isLive, isAllJurisdictions, JURISDICTIONS } from "@/lib/jurisdiction";

const IN_CODES: Array<{ value: string; label: string }> = [
  { value: "BNS", label: "BNS (Bharatiya Nyaya Sanhita, 2023)" },
  { value: "BNSS", label: "BNSS (Nagarik Suraksha Sanhita, 2023)" },
  { value: "BSA", label: "BSA (Sakshya Adhiniyam, 2023)" },
  { value: "IPC", label: "IPC (Indian Penal Code, 1860)" },
  { value: "CRPC", label: "CrPC (Code of Criminal Procedure, 1973)" },
  { value: "IEA", label: "IEA (Indian Evidence Act, 1872)" },
];

const US_CODES: Array<{ value: string; label: string }> = [
  { value: "USC", label: "US Code" },
];

function codesFor(jurisdiction: string): Array<{ value: string; label: string }> {
  const specific = jurisdiction === "US" ? US_CODES : IN_CODES;
  return [{ value: "all", label: "All codes" }, ...specific];
}

function StatuteCard({ s }: { s: Statute }) {
  return (
    <Card className="bg-card border shadow-sm">
      <CardContent className="p-6 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-serif font-semibold leading-snug">
            {s.code} § {s.section} — {s.heading}
          </h3>
          <div className="flex gap-2 shrink-0">
            <Badge variant="secondary">{s.code}</Badge>
            <Badge variant="outline">{s.jurisdiction}</Badge>
          </div>
        </div>
        {(s.actName || s.chapter) && (
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {s.actName ?? ""}
            {s.actName && s.chapter ? " · " : ""}
            {s.chapter ?? ""}
            {s.uscTitle ? ` · Title ${s.uscTitle}` : ""}
            {s.ministry ? ` · Ministry of ${s.ministry}` : ""}
          </p>
        )}
        <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-5">{s.text}</p>
        {(s.code === "BNS" || s.code === "BNSS" || s.code === "BSA") && (
          <p className="text-sm">
            <Link
              href={`/statutes/compare?from=${s.code}&section=${encodeURIComponent(s.section)}`}
              className="inline-flex items-center gap-1 text-primary hover:underline"
              data-testid={`link-old-equivalent-${s.id}`}
            >
              See old equivalent <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </p>
        )}
        {s.mappedCode && s.mappedSections.length > 0 && (
          <p className="text-sm">
            <span className="text-muted-foreground">Maps to:</span>{" "}
            <span className="font-medium">{s.mappedCode} § {s.mappedSections.join(", § ")}</span>
            {s.code === "IPC" && (
              <Link href={`/statutes/compare?section=${encodeURIComponent(s.section)}`} className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
                Compare <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
            {(s.mappedCode === "CrPC" || s.mappedCode === "IEA") && s.mappedSections[0] && (
              <Link href={`/statutes/compare?from=${s.mappedCode}&section=${encodeURIComponent(s.mappedSections[0])}`} className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
                Compare <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </p>
        )}
        {s.changeNotes && (
          <p className="text-sm text-amber-700 dark:text-amber-400 line-clamp-3">{s.changeNotes}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ActCard({ a, onOpen }: { a: StatuteAct; onOpen: (code: string) => void }) {
  return (
    <Card
      className="bg-card border shadow-sm hover:border-primary/50 cursor-pointer transition-colors"
      onClick={() => onOpen(a.code)}
      data-testid={`card-act-${a.code}`}
    >
      <CardContent className="p-5 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif font-semibold leading-snug">{a.actName}</h3>
          <Badge variant="outline" className="shrink-0">{a.jurisdiction}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {a.actYear ? `Act ${a.actNo ? `No. ${a.actNo} of ` : "of "}${a.actYear}` : a.code}
          {a.ministry ? ` · Ministry of ${a.ministry}` : ""}
        </p>
        <div className="flex items-center gap-2 pt-1">
          {a.practiceArea && <Badge variant="secondary">{a.practiceArea}</Badge>}
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <ScrollText className="w-3.5 h-3.5" /> {a.sectionCount} provision{a.sectionCount === 1 ? "" : "s"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Statutes() {
  const [code, setCode] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [q, setQ] = useState<string | null>(null);
  const { jurisdiction, setJurisdiction } = useJurisdiction();
  const live = isLive(jurisdiction);
  const CODES = codesFor(jurisdiction);
  const [actQuery, setActQuery] = useState("");
  const [practiceArea, setPracticeArea] = useState<string>("all");

  // Reset any code selection that doesn't belong to the active jurisdiction.
  useEffect(() => {
    if (code !== "all" && code !== null && !CODES.some((c) => c.value === code)) setCode("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jurisdiction]);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlQ = params.get("q");
    if (urlQ && urlQ.trim().length >= 2) {
      setInput(urlQ.trim());
      setQ(urlQ.trim());
    }
    const urlCode = params.get("code");
    if (urlCode) setCode(urlCode.toUpperCase());
  }, []);

  // Statutes API: IN|US exact, or omit for union. Never send ALL (Zod rejects).
  const jurisdictionParam =
    live && !isAllJurisdictions(jurisdiction)
      ? (jurisdiction as "IN" | "US")
      : undefined;

  // Act-level browse (true per-act counts, aggregated server-side)
  const actsParams = {
    ...(practiceArea !== "all" ? { practiceArea } : {}),
    ...(actQuery.trim() ? { q: actQuery.trim() } : {}),
    ...(jurisdictionParam ? { jurisdiction: jurisdictionParam } : {}),
  };
  const acts = useListStatuteActs(actsParams, {
    query: { queryKey: getListStatuteActsQueryKey(actsParams) },
  });

  const browsing = q === null && (code === null || code === "all");

  const listParams = {
    ...(code && code !== "all" ? { code } : {}),
    ...(jurisdictionParam ? { jurisdiction: jurisdictionParam } : {}),
    limit: 600,
  };
  const list = useListStatutes(listParams, {
    query: { enabled: live && q === null && !browsing, queryKey: getListStatutesQueryKey(listParams) },
  });

  const searchParams = {
    q: q ?? "",
    ...(code && code !== "all" ? { code } : {}),
    ...(jurisdictionParam ? { jurisdiction: jurisdictionParam } : {}),
    limit: 50,
  };
  const search = useSearchStatutes(searchParams, {
    query: { enabled: live && q !== null, queryKey: getSearchStatutesQueryKey(searchParams) },
  });

  const active = q !== null ? search : list;
  const data = active.data;
  const selectedAct = code ? acts.data?.results.find((a) => a.code === code) : undefined;

  if (!live) {
    const info = JURISDICTIONS.find((j) => j.code === jurisdiction);
    return (
      <div className="space-y-8">
        <h1 className="text-4xl font-serif font-bold text-foreground">Statutes</h1>
        <Card className="border-dashed">
          <CardContent className="p-12 text-center space-y-3">
            <Globe className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-2xl font-serif font-semibold" data-testid="text-statutes-coming-soon">
              {info?.flag} {info?.label} — Coming soon
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              The statutes corpus for {info?.label} is on our roadmap. Indian and US statutes are live today — switch jurisdiction in the sidebar.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={() => setJurisdiction("IN")} variant="outline">Switch to India</Button>
              <Button onClick={() => setJurisdiction("US")} variant="outline">Switch to United States</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-serif font-bold text-foreground">Instant · Statutes</h1>
        <p className="text-muted-foreground text-lg">
          Corpus Instant Search for statutes — Constitution, BNS/BNSS/BSA, IPC/CrPC/IEA, India Code, and key US Code.
          Partners use NYV SDK <code className="text-sm">instantSearch.statutes</code> against the same plane.
        </p>
        {acts.data && (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <Landmark className="w-4 h-4" />
            {acts.data.total} acts · {acts.data.totalSections.toLocaleString()} provisions in the corpus
          </p>
        )}
      </div>

      <Card className="bg-card shadow-sm border">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-10 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Full-text search across all provisions — e.g. murder, oppression and mismanagement, anticipatory bail..."
                className="pl-9 h-10"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setQ(input.trim().length >= 2 ? input.trim() : null)}
                data-testid="input-statute-search"
              />
            </div>
            <div className="md:col-span-2">
              <Button
                className="w-full h-10"
                onClick={() => setQ(input.trim().length >= 2 ? input.trim() : null)}
                data-testid="button-statute-search"
              >
                Search
              </Button>
            </div>
          </div>
          {(q !== null || code !== null) && (
            <button
              className="mt-3 text-sm text-primary hover:underline inline-flex items-center gap-1"
              onClick={() => { setQ(null); setInput(""); setCode(null); }}
              data-testid="button-clear-search"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to all acts
            </button>
          )}
        </CardContent>
      </Card>

      {browsing && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-7 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter acts by name — e.g. Companies, Contract, Arbitration..."
                className="pl-9 h-10"
                value={actQuery}
                onChange={(e) => setActQuery(e.target.value)}
                data-testid="input-act-filter"
              />
            </div>
            <div className="md:col-span-5">
              <Select value={practiceArea} onValueChange={setPracticeArea}>
                <SelectTrigger className="h-10" data-testid="select-practice-area"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All practice areas</SelectItem>
                  {(acts.data?.practiceAreas ?? []).map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {acts.isLoading && (
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading acts...
            </div>
          )}
          {acts.data && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {acts.data.results.map((a) => (
                <ActCard key={a.code} a={a} onOpen={(c) => { setCode(c); setQ(null); setInput(""); }} />
              ))}
              {acts.data.results.length === 0 && (
                <Card className="lg:col-span-2"><CardContent className="p-8 text-center text-muted-foreground">No acts matched that filter.</CardContent></Card>
              )}
            </div>
          )}
        </div>
      )}

      {!browsing && (
        <>
          {selectedAct && q === null && (
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-serif font-semibold">{selectedAct.actName}</h2>
              <p className="text-sm text-muted-foreground">
                {selectedAct.actYear ? `Act ${selectedAct.actNo ? `No. ${selectedAct.actNo} of ` : "of "}${selectedAct.actYear}` : selectedAct.code}
                {selectedAct.ministry ? ` · Ministry of ${selectedAct.ministry}` : ""}
                {selectedAct.practiceArea ? ` · ${selectedAct.practiceArea}` : ""}
                {selectedAct.enactmentDate ? ` · In force from ${selectedAct.enactmentDate}` : ""}
              </p>
            </div>
          )}

          {active.isLoading && (
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading statutes...
            </div>
          )}

          {data && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2" data-testid="text-provision-count">
                <BookMarked className="w-4 h-4" /> {data.total.toLocaleString()} provision{data.total === 1 ? "" : "s"}
                {data.results.length < data.total && (
                  <span>· showing first {data.results.length}</span>
                )}
              </p>
              {q !== null && (search.data?.embeddingCoverage?.unembedded ?? 0) > 0 && (
                <div
                  className="flex items-start gap-2.5 rounded-md border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
                  data-testid="banner-embedding-coverage"
                >
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Meaning-based search currently covers{" "}
                    <span className="font-semibold">{search.data!.embeddingCoverage.coveragePct}%</span> of the corpus.
                    Some semantic matches may be missing while the remaining{" "}
                    {search.data!.embeddingCoverage.unembedded.toLocaleString()} provisions are being indexed.
                  </span>
                </div>
              )}
              {data.results.map((s) => (
                <StatuteCard key={s.id} s={s} />
              ))}
              {data.results.length === 0 && (
                <Card><CardContent className="p-8 text-center text-muted-foreground">No provisions matched. Try broader terms.</CardContent></Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
