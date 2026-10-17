import { useEffect, useState } from "react";
import { useVerifyCitation } from "@workspace/api-client-react";
import { extractErrorMessage } from "./CaselawSearch";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, ExternalLink, Globe, Landmark, Scale } from "lucide-react";
import { useJurisdiction, isReserved, JURISDICTIONS } from "@/lib/jurisdiction";

export default function CitationCheck() {
  const { jurisdiction: globalJurisdiction, setJurisdiction: setGlobalJurisdiction } = useJurisdiction();
  const [citation, setCitation] = useState("");
  const [jurisdiction, setJurisdiction] = useState<"ALL" | "IN" | "US">("ALL");

  useEffect(() => {
    if (globalJurisdiction === "IN" || globalJurisdiction === "US") {
      setJurisdiction(globalJurisdiction);
    } else {
      setJurisdiction("ALL");
    }
  }, [globalJurisdiction]);

  const verify = useVerifyCitation();

  const run = () => {
    if (citation.trim().length < 3) return;
    verify.mutate({ data: { citation: citation.trim(), jurisdiction } });
  };

  const result = verify.data;

  if (isReserved(globalJurisdiction)) {
    const info = JURISDICTIONS.find((j) => j.code === globalJurisdiction);
    return (
      <div className="space-y-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-serif font-bold text-foreground">Citation Check</h1>
        </div>
        <Card className="border-dashed">
          <CardContent className="p-12 text-center space-y-3">
            <Globe className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-2xl font-serif font-semibold">
              {info?.flag} {info?.label} — Coming soon
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Citation verification for {info?.label} is on our roadmap. India and the United States are live today — switch jurisdiction in the sidebar to verify citations now.
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
        <h1 className="text-4xl font-serif font-bold text-foreground">Citation Check</h1>
        <p className="text-muted-foreground text-lg">
          Verify a case name or citation against real legal databases — the Indian Supreme Court corpus and live US CourtListener — to catch hallucinated authorities.
        </p>
      </div>

      <Card className="bg-card shadow-sm border">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-7">
              <Input
                placeholder='e.g. "Kesavananda Bharati v. State of Kerala" or "384 U.S. 436"'
                className="h-10"
                value={citation}
                onChange={(e) => setCitation(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
              />
            </div>
            <div className="md:col-span-3">
              <Select value={jurisdiction} onValueChange={(v) => setJurisdiction(v as "ALL" | "IN" | "US")}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All jurisdictions</SelectItem>
                  <SelectItem value="IN">India</SelectItem>
                  <SelectItem value="US">United States</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Button className="w-full h-10" onClick={run} disabled={citation.trim().length < 3 || verify.isPending}>
                {verify.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {verify.isError && (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Verification failed</p>
            <p>{extractErrorMessage(verify.error)}</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          <Card
            className={
              result.status === "verified"
                ? "border-green-600/40 bg-green-50 dark:bg-green-950/20"
                : result.status === "uncertain"
                  ? "border-amber-600/40 bg-amber-50 dark:bg-amber-950/20"
                  : "border-destructive/40 bg-red-50 dark:bg-red-950/20"
            }
          >
            <CardContent className="p-6 flex items-start gap-3">
              {result.status === "verified" ? (
                <ShieldCheck className="w-6 h-6 text-green-600 mt-0.5" />
              ) : result.status === "uncertain" ? (
                <ShieldQuestion className="w-6 h-6 text-amber-600 mt-0.5" />
              ) : (
                <ShieldAlert className="w-6 h-6 text-destructive mt-0.5" />
              )}
              <div>
                <p className="font-semibold text-foreground capitalize">{result.status.replace("_", " ")}</p>
                {result.note && <p className="text-sm text-muted-foreground">{result.note}</p>}
              </div>
            </CardContent>
          </Card>

          {result.matches.map((doc, i) => (
            <Card key={doc.id ?? `m-${i}`} className="bg-card border shadow-sm">
              <CardContent className="p-6 space-y-1.5">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-serif font-semibold leading-snug">{doc.title}</h3>
                  <Badge variant="secondary" className="shrink-0">
                    {doc.source === "in-sc" ? "SC of India" : "CourtListener"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {doc.citation && <span className="font-medium text-foreground">{doc.citation}</span>}
                  {doc.court && <span>{doc.court}</span>}
                  {doc.decisionDate && <span>{doc.decisionDate}</span>}
                </div>
                {doc.url && (
                  <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    View opinion <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
