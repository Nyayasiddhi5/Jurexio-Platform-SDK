import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClock } from "lucide-react";
import type { CnrTimelineEntry } from "@/lib/cnrTypes";

interface CaseTimelineProps {
  entries: CnrTimelineEntry[];
  className?: string;
}

/** Vertical timeline from `caseCreate.timeline` (hearings + judgment orders). */
export function CaseTimeline({ entries, className }: CaseTimelineProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-serif flex items-center gap-2">
          <CalendarClock className="w-4 h-4" /> Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timeline entries in corpus.</p>
        ) : (
          <ol className="relative space-y-0">
            {entries.map((e, i) => (
              <li
                key={`${e.date ?? "undated"}-${e.purpose ?? "event"}-${i}`}
                className="relative pl-8 pb-6 last:pb-0"
              >
                {i < entries.length - 1 && (
                  <span
                    className="absolute left-[11px] top-3 bottom-0 w-px bg-border"
                    aria-hidden
                  />
                )}
                <span
                  className="absolute left-0 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-primary/40 bg-background"
                  aria-hidden
                >
                  <span className="h-2 w-2 rounded-full bg-primary/70" />
                </span>
                <div className="space-y-1">
                  <time className="text-sm font-medium tabular-nums">
                    {e.date ?? "Date unknown"}
                  </time>
                  {e.purpose && <p className="text-sm">{e.purpose}</p>}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {e.judge && <span>Judge: {e.judge}</span>}
                    {e.status && (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {e.status}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {e.source} · {Math.round(e.confidence * 100)}%
                    </Badge>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground mt-4">
          Historical hearings from judgment corpus — future dates require live eCourts.
        </p>
      </CardContent>
    </Card>
  );
}
