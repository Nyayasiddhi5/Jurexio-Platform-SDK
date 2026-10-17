import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import {
  useListChatConversations,
  getListChatConversationsQueryKey,
  useGetChatConversation,
  getGetChatConversationQueryKey,
  useCreateChatConversation,
  useDeleteChatConversation,
  useUpdateChatConversation,
  useUploadChatDocument,
  useListTemplates,
  type ChatMessage,
  type ChatAction,
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Search,
  Trash2,
  Paperclip,
  Send,
  Loader2,
  FileText,
  Copy,
  FileDown,
  MessageSquare,
  ScrollText,
  Users,
  FolderSearch,
  PenTool,
  BrainCircuit,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { postSse, SseCancelledError } from "@/lib/sse";
import { useJurisdiction, isAllJurisdictions } from "@/lib/jurisdiction";
import { Markdown, markdownToHtml } from "@/components/Markdown";
import { XCircle } from "lucide-react";

type ActionMode = ChatAction;

const ACTIONS: Array<{
  action: ActionMode;
  label: string;
  icon: typeof ScrollText;
  hint: string;
}> = [
  { action: "summary", label: "Summary", icon: ScrollText, hint: "Summarize the matter and uploaded documents" },
  { action: "extract", label: "Extract", icon: Users, hint: "Extract parties, counsel, judges, witnesses, dates" },
  { action: "case_details", label: "Case Details", icon: FolderSearch, hint: "Structured case record: court, sections, statutes, references" },
  { action: "draft", label: "Draft", icon: PenTool, hint: "Draft a new work product from the documents or your ask" },
  { action: "intelligence", label: "Intelligence", icon: BrainCircuit, hint: "Points to note, references, study, arguments, approach" },
  { action: "predictions", label: "Predictions", icon: TrendingUp, hint: "Outcome likelihood % and suggestions to strengthen the case" },
];

const ACTION_LABEL: Record<string, string> = {
  chat: "Chat",
  summary: "Summary",
  extract: "Extract",
  case_details: "Case Details",
  draft: "Draft",
  intelligence: "Intelligence",
  predictions: "Predictions & Suggestions",
};

const STAGE_LABEL: Record<string, string> = {
  working: "Starting…",
  retrieving: "Retrieving authorities…",
  analyzing: "Analyzing…",
  formatting: "Formatting…",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function exportMessageAsPdf(message: ChatMessage, title: string) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; max-width: 760px; margin: 40px auto; color: #1a1a1a; line-height: 1.6; }
      h1,h2,h3 { font-family: Georgia, serif; }
      blockquote { border-left: 3px solid #999; padding-left: 12px; color: #555; font-style: italic; }
      .meta { color: #666; font-size: 12px; border-bottom: 1px solid #ddd; padding-bottom: 12px; margin-bottom: 24px; }
      li { margin-left: 20px; }
    </style></head><body>
    <div class="meta">NYS Agentic AI — ${ACTION_LABEL[message.action] ?? message.action} · ${format(new Date(message.createdAt), "PPpp")}</div>
    ${markdownToHtml(message.content)}
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function MessageBubble({ message, title }: { message: ChatMessage; title: string }) {
  const { toast } = useToast();
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-3">
          {message.action !== "chat" && (
            <Badge variant="secondary" className="mb-1 text-[10px]">
              {ACTION_LABEL[message.action] ?? message.action}
            </Badge>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content || <em className="opacity-70">(document-driven {ACTION_LABEL[message.action]?.toLowerCase()})</em>}
          </div>
        </div>
      </div>
    );
  }

  const isStructured = !!message.structured;
  const isPredictions = message.action === "predictions";

  return (
    <div className="flex justify-start">
      <Card
        className={cn(
          "max-w-[92%] w-full px-5 py-4 shadow-sm",
          isStructured && "border-l-4 border-l-primary",
        )}
      >
        <div className="flex items-center justify-between mb-2">
          <Badge variant={message.action === "chat" ? "outline" : "default"} className="text-[10px]">
            {ACTION_LABEL[message.action] ?? message.action}
          </Badge>
          <div className="flex gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    navigator.clipboard.writeText(message.content);
                    toast({ title: "Copied to clipboard" });
                  }}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => exportMessageAsPdf(message, title)}
                >
                  <FileDown className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save as PDF</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Markdown content={message.content} className="text-foreground/90" />
        {isPredictions && (
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Analytical assistance only — not legal advice. Outcomes depend on
              facts, evidence, forum, and counsel.
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function LegalChat() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchString = useSearch();
  // Support deep-links like /chat?c=<conversationId> (used by Archive Search
  // "Summarize" to open the conversation the judgment was attached to).
  const initialConvId = (() => {
    const raw = new URLSearchParams(searchString).get("c");
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  })();
  const [selectedId, setSelectedId] = useState<number | null>(initialConvId);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [pendingAction, setPendingAction] = useState<ActionMode | null>(null);
  const [templateId, setTemplateId] = useState<string>("none");
  const { jurisdiction } = useJurisdiction();
  const { data: templates } = useListTemplates(
    {
      kind: "template",
      jurisdiction: jurisdiction === "ALL" ? "ALL" : jurisdiction,
    },
    {
      query: {
        queryKey: ["templates", "chat", jurisdiction],
      },
    },
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading: listLoading } =
    useListChatConversations(search ? { search } : undefined, {
      query: { queryKey: getListChatConversationsQueryKey(search ? { search } : undefined) },
    });

  const { data: conversation } = useGetChatConversation(selectedId ?? 0, {
    query: {
      enabled: !!selectedId,
      queryKey: getGetChatConversationQueryKey(selectedId ?? 0),
    },
  });

  const createConv = useCreateChatConversation();
  const deleteConv = useDeleteChatConversation();
  const updateConv = useUpdateChatConversation();
  const uploadDoc = useUploadChatDocument();

  const [pendingUserContent, setPendingUserContent] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState<{
    action: ActionMode;
    userContent: string | null;
    content: string;
  } | null>(null);
  const busy = pendingAction !== null;
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, busy, streamText]);

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

  const invalidate = (id: number) => {
    queryClient.invalidateQueries({ queryKey: getGetChatConversationQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey(search ? { search } : undefined) });
  };

  const ensureConversation = async (): Promise<number> => {
    if (selectedId) return selectedId;
    const conv = await createConv.mutateAsync({ data: {} });
    setSelectedId(conv.id);
    invalidate(conv.id);
    return conv.id;
  };

  const handleNewChat = async () => {
    const conv = await createConv.mutateAsync({ data: {} });
    setSelectedId(conv.id);
    invalidate(conv.id);
  };

  const handleDelete = async (id: number) => {
    await deleteConv.mutateAsync({ id });
    if (selectedId === id) setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey(search ? { search } : undefined) });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const id = await ensureConversation();
      for (const file of Array.from(files)) {
        try {
          const contentBase64 = await fileToBase64(file);
          await uploadDoc.mutateAsync({
            id,
            data: { filename: file.name, contentBase64 },
          });
          toast({ title: `Uploaded ${file.name}` });
        } catch (err) {
          const message =
            err && typeof err === "object" && "data" in err
              ? ((err as { data?: { error?: string } }).data?.error ?? "Upload failed")
              : "Upload failed";
          toast({ title: `Could not upload ${file.name}`, description: message, variant: "destructive" });
        }
      }
      invalidate(id);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submit = async (action: ActionMode) => {
    if (busy) return;
    const content = input.trim();
    if (action === "chat" && !content) return;
    setPendingAction(action);
    setPendingUserContent(content);
    setStreamText("");
    setStage(null);
    setCancelled(null);
    bufferRef.current = "";
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const id = await ensureConversation();
      setInput("");
      await postSse(
        `/api/chat/conversations/${id}/messages/stream`,
        {
          content,
          action,
          jurisdiction,
          locale: navigator.language?.slice(0, 16) || undefined,
          ...(action === "draft" && templateId !== "none"
            ? { templateId: Number(templateId) }
            : {}),
        },
        {
          onDelta: pushDelta,
          onStatus: (s) => setStage(s),
        },
        controller.signal,
      );
      await queryClient.invalidateQueries({ queryKey: getGetChatConversationQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey(search ? { search } : undefined) });
    } catch (err) {
      if (err instanceof SseCancelledError) {
        setCancelled({
          action,
          userContent: content || null,
          content: bufferRef.current,
        });
        toast({
          title: "Cancelled",
          description: "The response was stopped. Partial output is shown below.",
        });
        return;
      }
      const message = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Action failed", description: message, variant: "destructive" });
      if (content) setInput(content);
    } finally {
      setPendingAction(null);
      setPendingUserContent(null);
      setStreamText("");
      setStage(null);
      abortRef.current = null;
    }
  };

  const toggleFormat = async () => {
    if (!selectedId || !conversation) return;
    const next = conversation.outputFormat === "brief" ? "detailed" : "brief";
    await updateConv.mutateAsync({ id: selectedId, data: { outputFormat: next } });
    invalidate(selectedId);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-8 overflow-hidden">
      {/* History sidebar */}
      <div className="w-72 flex-shrink-0 border-r bg-card flex flex-col">
        <div className="p-3 space-y-2 border-b">
          <Button className="w-full gap-2" onClick={handleNewChat} disabled={createConv.isPending}>
            <Plus className="w-4 h-4" /> New Chat
          </Button>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations…"
              className="pl-8 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {listLoading && (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading…</div>
          )}
          {conversations?.length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-sm">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No conversations yet.
            </div>
          )}
          {conversations?.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-start gap-2 rounded-md px-3 py-2.5 cursor-pointer text-sm transition-colors",
                selectedId === c.id ? "bg-accent" : "hover:bg-accent/50",
              )}
              onClick={() => {
                setSelectedId(c.id);
                setCancelled(null);
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.title}</div>
                {c.matchedSnippet && (
                  <div className="text-xs text-muted-foreground/90 truncate italic mt-0.5">
                    “{c.matchedSnippet}”
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {c.messageCount} msgs · {c.documentCount} docs ·{" "}
                  {format(new Date(c.updatedAt), "MMM d")}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(c.id);
                }}
              >
                <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Main thread */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 border-b bg-card px-5 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <h1 className="font-serif font-semibold truncate">
              {conversation?.title ?? "Legal Chat"}
            </h1>
            {conversation && conversation.documents.length > 0 && (
              <div className="text-xs text-muted-foreground truncate">
                {conversation.documents.map((d) => d.filename).join(" · ")}
              </div>
            )}
          </div>
          {conversation && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={toggleFormat} className="gap-1.5">
                  <ScrollText className="w-3.5 h-3.5" />
                  {conversation.outputFormat === "brief" ? "Brief" : "Detailed"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle output format for responses</TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {!conversation || conversation.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground max-w-md mx-auto">
              <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
              <h2 className="font-serif text-xl text-foreground mb-2">
                Legal Chat Workspace
              </h2>
              <p className="text-sm mb-4">
                Upload case documents (PDF, DOCX, TXT) and converse with the
                legal agent — or trigger one of the six action modes below.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {ACTIONS.map((a) => (
                  <Badge key={a.action} variant="secondary" className="gap-1">
                    <a.icon className="w-3 h-3" /> {a.label}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            conversation.messages.map((m) => (
              <MessageBubble key={m.id} message={m} title={conversation.title} />
            ))
          )}
          {busy && pendingAction && (
            <div className="flex justify-end">
              <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-3">
                {pendingAction !== "chat" && (
                  <Badge variant="secondary" className="mb-1 text-[10px]">
                    {ACTION_LABEL[pendingAction] ?? pendingAction}
                  </Badge>
                )}
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {pendingUserContent || (
                    <em className="opacity-70">
                      (document-driven {ACTION_LABEL[pendingAction]?.toLowerCase()})
                    </em>
                  )}
                </div>
              </div>
            </div>
          )}
          {busy && streamText && (
            <div className="flex justify-start">
              <Card className="max-w-[92%] w-full px-5 py-4 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={pendingAction === "chat" ? "outline" : "default"} className="text-[10px]">
                      {(pendingAction && ACTION_LABEL[pendingAction]) ?? "Chat"}
                    </Badge>
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    {stage && (
                      <span className="text-[10px] text-muted-foreground">
                        {STAGE_LABEL[stage] ?? stage}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={cancelStream}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                  </Button>
                </div>
                <Markdown content={streamText} className="text-foreground/90" />
                <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-primary/70 animate-pulse align-text-bottom" />
              </Card>
            </div>
          )}
          {busy && !streamText && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground pl-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {stage
                ? `${pendingAction && pendingAction !== "chat" ? `${ACTION_LABEL[pendingAction]} — ` : ""}${STAGE_LABEL[stage] ?? stage}`
                : pendingAction && pendingAction !== "chat"
                  ? `Running ${ACTION_LABEL[pendingAction]}…`
                  : "The agent is working…"}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={cancelStream}
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel
              </Button>
            </div>
          )}
          {!busy && cancelled && (
            <>
              {cancelled.userContent && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-3">
                    {cancelled.action !== "chat" && (
                      <Badge variant="secondary" className="mb-1 text-[10px]">
                        {ACTION_LABEL[cancelled.action] ?? cancelled.action}
                      </Badge>
                    )}
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {cancelled.userContent}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex justify-start">
                <Card className="max-w-[92%] w-full px-5 py-4 shadow-sm border-l-4 border-l-amber-500">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">
                      <XCircle className="w-3 h-3 mr-1" />
                      Cancelled
                    </Badge>
                  </div>
                  {cancelled.content ? (
                    <Markdown content={cancelled.content} className="text-foreground/90" />
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Stopped before any output was generated. This turn was not saved.
                    </p>
                  )}
                </Card>
              </div>
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="border-t bg-card p-4 flex-shrink-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <Tooltip key={a.action}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 rounded-full"
                    disabled={busy || uploading}
                    onClick={() => submit(a.action)}
                  >
                    {busy && pendingAction === a.action ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <a.icon className="w-3.5 h-3.5" />
                    )}
                    {a.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{a.hint}</TooltipContent>
              </Tooltip>
            ))}
            {templates && templates.length > 0 && (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-8 w-56 rounded-full text-xs">
                  <SelectValue placeholder="Draft template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template (Draft)</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                      {isAllJurisdictions(jurisdiction) ? ` · ${t.jurisdiction}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  disabled={uploading || busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Paperclip className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload documents (PDF, DOCX, TXT, PNG/JPEG/WebP)</TooltipContent>
            </Tooltip>
            <Textarea
              placeholder="Ask the legal agent anything about this matter…"
              className="min-h-[44px] max-h-40 resize-none"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit("chat");
                }
              }}
              disabled={busy}
            />
            <Button
              size="icon"
              className="flex-shrink-0"
              disabled={busy || uploading || !input.trim()}
              onClick={() => submit("chat")}
            >
              {busy && pendingAction === "chat" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          {conversation && conversation.documents.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {conversation.documents.map((d) => (
                <Badge key={d.id} variant="secondary" className="gap-1 font-normal">
                  <FileText className="w-3 h-3" />
                  {d.filename}
                  <span className="text-muted-foreground">
                    ({Math.round(d.textLength / 1000)}k chars)
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
