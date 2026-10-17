import { useListRuns, useDeleteRun, getListRunsQueryKey, getGetDashboardSummaryQueryKey, type JurisdictionFilter } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { CheckCircle2, AlertCircle, Clock, Trash2, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useJurisdiction, jurisdictionBadgeLabel, jurisdictionQueryParam } from "@/lib/jurisdiction";
import { ReservedJurisdictionNotice } from "@/components/ReservedJurisdictionNotice";

export default function Runs() {
  const { jurisdiction } = useJurisdiction();
  const jParam = jurisdictionQueryParam(jurisdiction);
  const { data: runs, isLoading, isError } = useListRuns(
    { jurisdiction: jParam },
    { query: { queryKey: getListRunsQueryKey({ jurisdiction: jParam }) } },
  );
  const deleteRun = useDeleteRun();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    if (!confirm("Are you sure you want to delete this run?")) return;

    try {
      await deleteRun.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListRunsQueryKey({ jurisdiction: jParam }) });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({ jurisdiction: jParam }) });
      toast({ title: "Run deleted successfully" });
    } catch {
      toast({ variant: "destructive", title: "Failed to delete run" });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-serif font-bold text-foreground mb-2">Run History</h1>
          <p className="text-muted-foreground text-lg">
            Past agent executions and their work products
            {jurisdiction === "ALL" ? " across India and the United States." : "."}
          </p>
        </div>
      </div>

      <ReservedJurisdictionNotice surface="runs" />

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-card border rounded-lg"></div>)}
        </div>
      ) : isError ? (
        <div className="text-center p-12 text-destructive border rounded-lg bg-destructive/5">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p>Failed to load run history.</p>
        </div>
      ) : !runs || runs.length === 0 ? (
        <div className="text-center p-16 border rounded-lg bg-card">
          <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-xl font-serif font-medium mb-2">No runs yet</h3>
          <p className="text-muted-foreground mb-6">Start a new agent run to see it here.</p>
          <Link href="/run/new">
            <Button>Start New Run</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => (
            <Link key={run.id} href={`/run/${run.id}`}>
              <Card className="group cursor-pointer hover:border-primary transition-colors">
                <CardContent className="p-5 flex items-center justify-between gap-6">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="mt-1 flex-shrink-0">
                      {run.status === "completed" ? (
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                      ) : run.status === "failed" ? (
                        <AlertCircle className="w-5 h-5 text-destructive" />
                      ) : (
                        <Clock className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge variant="secondary" className="font-normal text-xs uppercase tracking-wider">{run.categoryName}</Badge>
                        <Badge variant="outline" className="font-normal text-xs capitalize">{run.workType}</Badge>
                        <Badge variant="outline" className="font-normal text-xs">
                          {jurisdictionBadgeLabel(run.jurisdiction)}
                        </Badge>
                        {run.score !== undefined && run.score !== null && (
                          <Badge className={run.score >= 80 ? "bg-green-700 hover:bg-green-800" : run.score >= 60 ? "bg-amber-600 hover:bg-amber-700" : "bg-destructive hover:bg-destructive"}>
                            Score: {Math.round(run.score)}%
                          </Badge>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold group-hover:text-primary transition-colors truncate">{run.title}</h3>
                      <p className="text-sm text-muted-foreground flex items-center gap-4">
                        <span>{format(new Date(run.createdAt), "MMM d, yyyy h:mm a")}</span>
                        {run.taskId && <span>From Benchmark Task #{run.taskId}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleDelete(e, run.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
