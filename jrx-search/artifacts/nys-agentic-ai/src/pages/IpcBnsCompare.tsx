import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import {
  useCompareIpcBns,
  getCompareIpcBnsQueryKey,
  useCompareOldNew,
  getCompareOldNewQueryKey,
  useCompareNewOld,
  getCompareNewOldQueryKey,
} from "@workspace/api-client-react";
import type {
  Statute,
  CompareOldNewFrom,
  CompareNewOldFrom,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Loader2, Scale, AlertCircle, ArrowLeftRight, Globe } from "lucide-react";
import { useJurisdiction, JURISDICTIONS } from "@/lib/jurisdiction";

type ModeKey = "IPC" | "CrPC" | "IEA" | "BNS" | "BNSS" | "BSA";

const REVERSE_OF: Record<ModeKey, ModeKey> = {
  IPC: "BNS",
  CrPC: "BNSS",
  IEA: "BSA",
  BNS: "IPC",
  BNSS: "CrPC",
  BSA: "IEA",
};

const MODES: Record<
  ModeKey,
  {
    inputLabel: string;
    inputBadge: string;
    resultBadge: string;
    title: string;
    blurb: string;
    placeholder: string;
    direction: "old-new" | "new-old";
  }
> = {
  IPC: {
    inputLabel: "IPC",
    inputBadge: "IPC (repealed)",
    resultBadge: "BNS (in force)",
    title: "IPC → BNS",
    blurb:
      "India replaced the Indian Penal Code, 1860 with the Bharatiya Nyaya Sanhita, 2023 (in force July 1, 2024). Enter an IPC section to see the corresponding BNS provision(s) side-by-side with what changed.",
    placeholder:
      "IPC section number — e.g. 302 (murder), 420 (cheating), 376, 498A...",
    direction: "old-new",
  },
  CrPC: {
    inputLabel: "CrPC",
    inputBadge: "CrPC 1973 (repealed)",
    resultBadge: "BNSS (in force)",
    title: "CrPC → BNSS",
    blurb:
      "The Code of Criminal Procedure, 1973 was replaced by the Bharatiya Nagarik Suraksha Sanhita, 2023 (in force July 1, 2024). Enter a CrPC section to find the corresponding BNSS provision(s) from the official NCRB mapping.",
    placeholder:
      "CrPC section number — e.g. 438 (anticipatory bail), 154 (FIR), 41A, 482...",
    direction: "old-new",
  },
  IEA: {
    inputLabel: "IEA",
    inputBadge: "Evidence Act 1872 (repealed)",
    resultBadge: "BSA (in force)",
    title: "Evidence Act → BSA",
    blurb:
      "The Indian Evidence Act, 1872 was replaced by the Bharatiya Sakshya Adhiniyam, 2023 (in force July 1, 2024). Enter an Evidence Act section to find the corresponding BSA provision(s) from the official NCRB mapping.",
    placeholder:
      "Evidence Act section number — e.g. 65B (electronic records), 27, 45, 114A...",
    direction: "old-new",
  },
  BNS: {
    inputLabel: "BNS",
    inputBadge: "BNS (in force)",
    resultBadge: "IPC (repealed)",
    title: "BNS → IPC",
    blurb:
      "Holding a Bharatiya Nyaya Sanhita, 2023 section? Enter it to see which repealed IPC provision(s) it replaced, side-by-side with the full IPC text from the corpus.",
    placeholder:
      "BNS section number — e.g. 103 (murder), 318 (cheating), 64, 85...",
    direction: "new-old",
  },
  BNSS: {
    inputLabel: "BNSS",
    inputBadge: "BNSS (in force)",
    resultBadge: "CrPC 1973 (repealed)",
    title: "BNSS → CrPC",
    blurb:
      "Holding a Bharatiya Nagarik Suraksha Sanhita, 2023 section? Enter it to see which repealed CrPC 1973 provision(s) it replaced, per the official NCRB mapping.",
    placeholder:
      "BNSS section number — e.g. 482 (anticipatory bail), 173 (FIR), 35, 528...",
    direction: "new-old",
  },
  BSA: {
    inputLabel: "BSA",
    inputBadge: "BSA (in force)",
    resultBadge: "Evidence Act 1872 (repealed)",
    title: "BSA → Evidence Act",
    blurb:
      "Holding a Bharatiya Sakshya Adhiniyam, 2023 section? Enter it to see which repealed Indian Evidence Act, 1872 provision(s) it replaced, per the official NCRB mapping.",
    placeholder:
      "BSA section number — e.g. 63 (electronic records), 23, 39, 119...",
    direction: "new-old",
  },
};

const OLD_MODES: ModeKey[] = ["IPC", "CrPC", "IEA"];
const NEW_MODES: ModeKey[] = ["BNS", "BNSS", "BSA"];

function ProvisionCard({
  s,
  tone,
  badge,
}: {
  s: Statute;
  tone: "old" | "new";
  badge: string;
}) {
  return (
    <Card className={tone === "old" ? "border-muted" : "border-green-600/40"}>
      <CardContent className="p-6 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif font-semibold leading-snug">
            {s.code} § {s.section} — {s.heading}
          </h3>
          <Badge variant={tone === "old" ? "secondary" : "default"} className="shrink-0">
            {badge}
          </Badge>
        </div>
        {s.chapter && <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.chapter}</p>}
        <p className="text-sm text-muted-foreground whitespace-pre-line">{s.text}</p>
      </CardContent>
    </Card>
  );
}

export default function IpcBnsCompare() {
  const { jurisdiction, setJurisdiction } = useJurisdiction();
  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const preset = urlParams.get("section") ?? "";
  const presetFromRaw = urlParams.get("from") ?? "";
  const presetFrom: ModeKey =
    presetFromRaw in MODES ? (presetFromRaw as ModeKey) : "IPC";
  const [mode, setMode] = useState<ModeKey>(presetFrom);
  const [input, setInput] = useState(preset);
  const [section, setSection] = useState<string | null>(preset || null);

  useEffect(() => {
    if (preset) {
      setInput(preset);
      setSection(preset);
      setMode(presetFrom);
    }
  }, [preset, presetFrom]);

  const m = MODES[mode];
  const isReverse = m.direction === "new-old";
  const ipcParams = { section: section ?? "" };
  const ipcQuery = useCompareIpcBns(ipcParams, {
    query: {
      enabled: section !== null && mode === "IPC",
      queryKey: getCompareIpcBnsQueryKey(ipcParams),
    },
  });
  const oldNewParams = {
    from: mode as CompareOldNewFrom,
    section: section ?? "",
  };
  const oldNewQuery = useCompareOldNew(oldNewParams, {
    query: {
      enabled: section !== null && (mode === "CrPC" || mode === "IEA"),
      queryKey: getCompareOldNewQueryKey(oldNewParams),
    },
  });
  const newOldParams = {
    from: mode as CompareNewOldFrom,
    section: section ?? "",
  };
  const newOldQuery = useCompareNewOld(newOldParams, {
    query: {
      enabled: section !== null && isReverse,
      queryKey: getCompareNewOldQueryKey(newOldParams),
    },
  });

  const active =
    mode === "IPC" ? ipcQuery : isReverse ? newOldQuery : oldNewQuery;
  const { isLoading, isError, error } = active;

  if (jurisdiction !== "IN") {
    const info = JURISDICTIONS.find((j) => j.code === jurisdiction);
    return (
      <div className="space-y-8">
        <h1 className="text-4xl font-serif font-bold text-foreground">Old ↔ New Law Comparator</h1>
        <Card className="border-dashed">
          <CardContent className="p-12 text-center space-y-3">
            <Globe className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-2xl font-serif font-semibold" data-testid="text-compare-india-only">
              {info?.flag} {info?.label} — India-specific tool
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              The IPC↔BNS / CrPC↔BNSS / IEA↔BSA comparator maps India's repealed criminal codes to the 2023 replacements. Switch to India in the sidebar to use it.
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
    if (input.trim().length > 0) setSection(input.trim());
  };

  const switchMode = (next: ModeKey) => {
    setMode(next);
    setSection(null);
    setInput("");
  };

  const ipcData = mode === "IPC" ? ipcQuery.data : undefined;
  const oldNewData =
    mode === "CrPC" || mode === "IEA" ? oldNewQuery.data : undefined;
  const newOldData = isReverse ? newOldQuery.data : undefined;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-serif font-bold text-foreground">
          {isReverse ? "New → Old Code Comparator" : "Old → New Code Comparator"}
        </h1>
        <p className="text-muted-foreground text-lg">{m.blurb}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(isReverse ? NEW_MODES : OLD_MODES).map((k) => (
          <Button
            key={k}
            variant={mode === k ? "default" : "outline"}
            size="sm"
            onClick={() => switchMode(k)}
          >
            {MODES[k].title}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => switchMode(REVERSE_OF[mode])}
          data-testid="button-swap-direction"
        >
          <ArrowLeftRight className="w-4 h-4" />
          {isReverse ? "Look up old → new instead" : "Have a new-code section? Look up its old equivalent"}
        </Button>
      </div>

      <Card className="bg-card shadow-sm border">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-9">
              <Input
                placeholder={m.placeholder}
                className="h-10"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
              />
            </div>
            <div className="md:col-span-3">
              <Button className="w-full h-10 gap-2" onClick={run} disabled={input.trim().length === 0}>
                <Scale className="w-4 h-4" /> Compare
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && section && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Looking up {m.inputLabel} § {section}...
        </div>
      )}

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Not found</p>
              <p className="text-sm text-muted-foreground">
                {(error as { message?: string } | null)?.message ?? `${m.inputLabel} § ${section} is not in the corpus yet.`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {ipcData && ipcData.found && ipcData.ipc && (
        <div className="space-y-6">
          {ipcData.changeNotes && (
            <Card className="border-amber-600/40 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="p-5 text-sm">
                <span className="font-semibold">What changed: </span>{ipcData.changeNotes}
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
            <ProvisionCard s={ipcData.ipc} tone="old" badge={MODES.IPC.inputBadge} />
            <div className="hidden lg:flex items-center justify-center h-full">
              <ArrowRight className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="space-y-4">
              {ipcData.bnsMatches.map((s) => (
                <ProvisionCard key={s.id} s={s} tone="new" badge={MODES.IPC.resultBadge} />
              ))}
              {ipcData.bnsMatches.length === 0 && (
                <Card className="border-dashed">
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    Mapped BNS section(s) {ipcData.ipc.mappedSections.join(", ")} are not yet in the seeded corpus.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {oldNewData && oldNewData.found && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_2fr] gap-4 items-start">
            <Card className="border-muted">
              <CardContent className="p-6 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-serif font-semibold leading-snug">
                    {oldNewData.oldCode} § {oldNewData.oldSection}
                  </h3>
                  <Badge variant="secondary" className="shrink-0">{m.inputBadge}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Maps to {oldNewData.matches.length} {oldNewData.newCode} provision{oldNewData.matches.length === 1 ? "" : "s"} per the official NCRB Sankalan mapping table. The repealed text is not in the corpus; the in-force provision(s) appear on the right.
                </p>
              </CardContent>
            </Card>
            <div className="hidden lg:flex items-center justify-center h-full">
              <ArrowRight className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="space-y-4">
              {oldNewData.matches.map((s) => (
                <div key={s.id} className="space-y-2">
                  {s.changeNotes && (
                    <Card className="border-amber-600/40 bg-amber-50 dark:bg-amber-950/20">
                      <CardContent className="p-4 text-sm">
                        <span className="font-semibold">What changed: </span>{s.changeNotes}
                      </CardContent>
                    </Card>
                  )}
                  <ProvisionCard s={s} tone="new" badge={m.resultBadge} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {newOldData && newOldData.found && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
            <div className="space-y-4">
              {newOldData.statute ? (
                <ProvisionCard s={newOldData.statute} tone="new" badge={m.inputBadge} />
              ) : (
                <Card className="border-muted">
                  <CardContent className="p-6 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-serif font-semibold leading-snug">
                        {newOldData.newCode} § {newOldData.newSection}
                      </h3>
                      <Badge className="shrink-0">{m.inputBadge}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      The {newOldData.newCode} text for this section is not yet in the seeded corpus, but the official mapping identifies its old-code equivalent(s) on the right.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
            <div className="hidden lg:flex items-center justify-center h-full">
              <ArrowRight className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="space-y-4">
              {newOldData.matches.map((s) => (
                <div key={s.id} className="space-y-2">
                  {s.changeNotes && (
                    <Card className="border-amber-600/40 bg-amber-50 dark:bg-amber-950/20">
                      <CardContent className="p-4 text-sm">
                        <span className="font-semibold">What changed: </span>{s.changeNotes}
                      </CardContent>
                    </Card>
                  )}
                  <ProvisionCard s={s} tone="old" badge={m.resultBadge} />
                </div>
              ))}
              {newOldData.matches.length === 0 && newOldData.oldSections.length > 0 && (
                <Card className="border-muted">
                  <CardContent className="p-6 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-serif font-semibold leading-snug">
                        {newOldData.oldCode} § {newOldData.oldSections.join(", § ")}
                      </h3>
                      <Badge variant="secondary" className="shrink-0">{m.resultBadge}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Replaced by {newOldData.newCode} § {newOldData.newSection} per the official NCRB Sankalan mapping table. The repealed text is not in the corpus.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
