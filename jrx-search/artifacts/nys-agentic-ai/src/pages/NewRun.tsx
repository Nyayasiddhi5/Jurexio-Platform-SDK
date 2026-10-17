import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  useGetTask, 
  getGetTaskQueryKey, 
  useListCategories 
} from "@workspace/api-client-react";
import type { JurisdictionFilter } from "@workspace/api-client-react";
import { postSse, SseCancelledError } from "@/lib/sse";
import { Markdown } from "@/components/Markdown";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PlayCircle, Loader2, Sparkles, XCircle, FileText, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useJurisdiction, isReserved, isAllJurisdictions, isLive, type LiveJurisdiction, jurisdictionQueryParam } from "@/lib/jurisdiction";
import { ReservedJurisdictionNotice } from "@/components/ReservedJurisdictionNotice";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: z.string().min(1, "Practice area is required"),
  workType: z.string().min(1, "Work type is required"),
  instruction: z.string().min(10, "Instructions must be at least 10 characters"),
  context: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewRun() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const taskIdParam = searchParams.get("taskId");
  const taskId = taskIdParam ? Number(taskIdParam) : null;

  // Archive references arrive via ?refPath=…&refTitle=… (from Archive Search /
  // Caselaw Search "Use as reference"). Up to 3 are sent as grounding docs.
  const [archiveRefs, setArchiveRefs] = useState<{ s3Path: string; title?: string }[]>(() => {
    const paths = new URLSearchParams(searchString).getAll("refPath");
    const titles = new URLSearchParams(searchString).getAll("refTitle");
    return paths
      .filter((p) => p.startsWith("s3://"))
      .slice(0, 3)
      .map((p, i) => ({ s3Path: p, ...(titles[i] ? { title: titles[i] } : {}) }));
  });
  
  const { toast } = useToast();
  const { jurisdiction } = useJurisdiction();
  const [runJurisdiction, setRunJurisdiction] = useState<LiveJurisdiction>("IN");
  const jParam = jurisdictionQueryParam(jurisdiction);
  const { data: categories } = useListCategories(
    { jurisdiction: jParam },
    { query: { queryKey: ["categories", jParam] } },
  );
  
  const { data: task, isLoading: isLoadingTask } = useGetTask(taskId!, {
    query: { enabled: !!taskId, queryKey: getGetTaskQueryKey(taskId!) }
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [streamText, setStreamText] = useState("");
  const [cancelledText, setCancelledText] = useState("");
  const streamEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [streamText]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Throttle re-renders: buffer deltas and flush at most once per animation
  // frame so markdown parsing stays fast during a fast token stream.
  const pushDelta = (text: string) => {
    bufferRef.current += text;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setStreamText(bufferRef.current);
      });
    }
  };

  const cancelStream = () => {
    abortRef.current?.abort();
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      category: "",
      workType: "",
      instruction: "",
      context: "",
    },
  });

  // Pre-fill form when task loads
  useEffect(() => {
    if (task) {
      form.reset({
        title: `Run: ${task.title}`,
        category: task.slug,
        workType: task.workType,
        instruction: task.instructions,
        context: "",
      });
    }
  }, [task, form]);

  const onSubmit = async (values: FormValues) => {
    setIsGenerating(true);
    setStage("");
    setStreamText("");
    setCancelledText("");
    bufferRef.current = "";
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = {
        taskId: taskId || undefined,
        ...values,
        jurisdiction: isAllJurisdictions(jurisdiction) ? runJurisdiction : isLive(jurisdiction) ? jurisdiction : undefined,
        locale: navigator.language?.slice(0, 16) || undefined,
        ...(archiveRefs.length > 0 ? { archiveReferences: archiveRefs } : {}),
      };

      const result = await postSse<{ id: number }>(
        "/api/runs/stream",
        data,
        {
          onStatus: (s) => setStage(s),
          onDelta: pushDelta,
        },
        controller.signal,
      );

      toast({
        title: "Agent Run Completed",
        description: "The AI agent has successfully completed the work.",
      });

      setLocation(`/run/${result.id}`);
    } catch (error) {
      setIsGenerating(false);
      if (error instanceof SseCancelledError) {
        setCancelledText(bufferRef.current);
        setStreamText("");
        toast({
          title: "Agent Run Cancelled",
          description: "The run was stopped. The partial draft is shown below.",
        });
        return;
      }
      toast({
        variant: "destructive",
        title: "Agent Error",
        description:
          error instanceof Error
            ? error.message
            : "The agent encountered an error while processing the request.",
      });
    } finally {
      abortRef.current = null;
    }
  };

  const STAGE_LABELS: Record<string, string> = {
    "resolving-task": "Resolving the benchmark task…",
    "retrieving-authorities": "Retrieving legal authorities and statutes…",
    drafting: "Drafting the work product…",
    saving: "Saving the completed run…",
  };

  if (isGenerating) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 pb-12">
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full animate-pulse"></div>
            <div className="w-14 h-14 bg-card border rounded-xl flex items-center justify-center shadow-lg relative z-10">
              <Sparkles className="w-6 h-6 text-primary animate-pulse" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-serif font-bold text-foreground">Agent is Working</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              {STAGE_LABELS[stage] ?? "Starting the agent…"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={cancelStream}
          >
            <XCircle className="w-4 h-4" />
            Cancel
          </Button>
        </div>
        {streamText ? (
          <Card className="border shadow-sm">
            <CardContent className="p-6 max-h-[60vh] overflow-y-auto">
              <Markdown content={streamText} className="text-foreground/90" />
              <span className="inline-block w-2 h-4 ml-0.5 bg-primary/70 animate-pulse align-text-bottom" />
              <div ref={streamEndRef} />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="w-full max-w-md bg-muted rounded-full h-2 overflow-hidden">
              <div className="bg-primary h-full animate-[progress_2s_ease-in-out_infinite]" style={{ width: '50%' }}></div>
            </div>
            <p className="text-sm font-mono text-muted-foreground">The draft will stream in live below as the agent writes…</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-4xl font-serif font-bold text-foreground mb-2">Configure Agent Run</h1>
        <p className="text-muted-foreground text-lg">
          {taskId ? "Start an agent run from the selected benchmark task." : "Write a custom instruction for the legal agent."}
        </p>
      </div>

      <ReservedJurisdictionNotice surface="new-run" />

      {isAllJurisdictions(jurisdiction) && (
        <Card className="border-dashed">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-muted-foreground flex-1">
              Practice areas below include India and United States tasks. Choose which jurisdiction this run should be grounded under:
            </p>
            <Select value={runJurisdiction} onValueChange={(v) => setRunJurisdiction(v as LiveJurisdiction)}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IN">India (IN)</SelectItem>
                <SelectItem value="US">United States (US)</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {cancelledText && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-700">
              <XCircle className="w-4 h-4" />
              Run Cancelled
            </CardTitle>
            <CardDescription>
              The run was stopped before it finished. The partial draft below was
              not saved.
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[40vh] overflow-y-auto">
            <Markdown content={cancelledText} className="text-foreground/90" />
          </CardContent>
        </Card>
      )}

      <Card className="border shadow-sm">
        <CardContent className="p-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-semibold">Run Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. M&A Due Diligence Memo" {...field} className="h-12" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-semibold">Practice Area</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={!!taskId}>
                        <FormControl>
                          <SelectTrigger className="h-12">
                            <SelectValue placeholder="Select practice area" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories?.map((cat) => (
                            <SelectItem key={cat.slug} value={cat.slug}>
                              {cat.name}
                              {isAllJurisdictions(jurisdiction) ? ` (${cat.taskCount})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="workType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-semibold">Work Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={!!taskId}>
                        <FormControl>
                          <SelectTrigger className="h-12">
                            <SelectValue placeholder="Select work type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="draft">Drafting</SelectItem>
                          <SelectItem value="analyze">Analysis</SelectItem>
                          <SelectItem value="review">Review</SelectItem>
                          <SelectItem value="research">Research</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="instruction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-semibold">Instructions</FormLabel>
                    <CardDescription className="mb-3">Detailed instructions for what the agent should accomplish.</CardDescription>
                    <FormControl>
                      <Textarea 
                        placeholder="Detail the task..." 
                        {...field} 
                        className="min-h-[200px] font-mono text-sm resize-y" 
                        disabled={!!taskId}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="context"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-semibold">Additional Context (Optional)</FormLabel>
                    <CardDescription className="mb-3">Provide any facts, background, or specific constraints the agent should know.</CardDescription>
                    <FormControl>
                      <Textarea 
                        placeholder="Paste facts, background documents, or context here..." 
                        {...field} 
                        className="min-h-[150px]" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {archiveRefs.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-base font-semibold">Archive Reference Documents</p>
                    <CardDescription>
                      These judgments will be fetched from the archive, text-extracted, and
                      given to the agent as citable source documents (recorded on the run
                      with their archive provenance).
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {archiveRefs.map((ref) => (
                      <Badge
                        key={ref.s3Path}
                        variant="secondary"
                        className="gap-1.5 py-1.5 px-3 max-w-full"
                        data-testid="badge-archive-ref"
                      >
                        <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate max-w-[24rem]">
                          {ref.title ?? ref.s3Path.split("/").pop()}
                        </span>
                        <button
                          type="button"
                          className="ml-1 hover:text-destructive"
                          onClick={() =>
                            setArchiveRefs((refs) => refs.filter((r) => r.s3Path !== ref.s3Path))
                          }
                          aria-label="Remove reference"
                          data-testid="button-remove-archive-ref"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-6 border-t flex justify-end">
                <Button type="submit" size="lg" className="gap-2 text-base px-8 h-14" disabled={isGenerating}>
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
                  {isGenerating ? "Agent Working..." : "Launch Agent"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
