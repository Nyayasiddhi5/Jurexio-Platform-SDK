import { Badge } from "@/components/ui/badge";
import { Database } from "lucide-react";
import { cn } from "@/lib/utils";

interface CorpusSourceBadgeProps {
  badge?: string;
  source?: string | null;
  claimEcourts?: boolean;
  className?: string;
}

/** Judgment corpus vs live eCourts indicator. */
export function CorpusSourceBadge({
  badge = "Judgment corpus",
  source,
  claimEcourts = false,
  className,
}: CorpusSourceBadgeProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Badge
        variant={claimEcourts ? "default" : "secondary"}
        className={cn(
          "gap-1.5 font-normal",
          claimEcourts && "bg-emerald-600 hover:bg-emerald-600/90",
        )}
      >
        <Database className="w-3 h-3" />
        {badge}
      </Badge>
      {source && (
        <Badge variant="outline" className="text-xs font-normal">
          {source}
        </Badge>
      )}
      {claimEcourts ? (
        <span className="text-xs text-emerald-700 dark:text-emerald-400">
          Live eCourts — may differ from corpus
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Not live eCourts · corpus only</span>
      )}
    </div>
  );
}
