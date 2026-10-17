import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Landmark, Scale } from "lucide-react";
import { useJurisdiction, isReserved, JURISDICTIONS } from "@/lib/jurisdiction";

export type ReservedNoticeSurface = "new-run" | "runs" | "analytics";

const COPY: Record<
  ReservedNoticeSurface,
  (label: string) => { title: string; body: string }
> = {
  "new-run": (label) => ({
    title: `${label} — Coming soon`,
    body: `Caselaw and statute grounding for ${label} is on our roadmap. This run will proceed without verified authorities attached. Switch to India or the United States in the sidebar for grounded runs today.`,
  }),
  runs: (label) => ({
    title: `${label} — Coming soon`,
    body: `Run history is global, but new runs under ${label} will not attach grounded authorities until that corpus is live. Switch to India or the United States to launch grounded agent runs today.`,
  }),
  analytics: (label) => ({
    title: `${label} — Coming soon`,
    body: `Usage and score analytics below reflect all activity. Jurisdiction-scoped grounding for ${label} is not live yet — switch to India or the United States for grounded caselaw and statutes.`,
  }),
};

export function ReservedJurisdictionNotice({
  surface,
  showSwitch = true,
}: {
  surface: ReservedNoticeSurface;
  showSwitch?: boolean;
}) {
  const { jurisdiction, setJurisdiction } = useJurisdiction();
  if (!isReserved(jurisdiction)) return null;

  const info = JURISDICTIONS.find((j) => j.code === jurisdiction);
  const label = info?.label ?? jurisdiction;
  const { title, body } = COPY[surface](label);

  return (
    <Card
      className="border-dashed border-amber-500/40 bg-amber-500/5"
      data-testid={`reserved-jurisdiction-notice-${surface}`}
    >
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">
          {info?.flag} {title}
        </p>
        <p className="text-sm text-muted-foreground">{body}</p>
        {showSwitch && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setJurisdiction("IN")}
            >
              <Landmark className="w-4 h-4" /> Switch to India
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setJurisdiction("US")}
            >
              <Scale className="w-4 h-4" /> Switch to United States
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
