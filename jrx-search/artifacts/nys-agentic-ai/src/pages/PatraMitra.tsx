import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Upload,
  Loader2,
  MessageSquare,
  Sparkles,
  ListChecks,
  AlertCircle,
  Send,
  X,
  BookOpen,
  History,
  Wrench,
  Copy,
  ClipboardPaste,
  Languages,
  RefreshCw,
  Download,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useJurisdiction } from "@/lib/jurisdiction";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

type Field = { key: string; label: string; value: string; confidence?: number };
type Turn = { role: "user" | "assistant"; content: string; at: string };
type ToolDef = { id: string; label: string; description: string };
type HistoryItem = {
  sessionId: string;
  fileName: string;
  documentType?: string;
  wordCount: number;
  detectedLanguage?: string;
  languageLabel?: string;
  createdAt: string;
  updatedAt: string;
  fieldCount: number;
  chatTurns: number;
};

interface Session {
  sessionId: string;
  fileName: string;
  documentType?: string;
  extractionMethod: string;
  warnings: string[];
  characterCount: number;
  wordCount: number;
  textPreview: string;
  fields: Field[];
  summary: string;
  keyPoints: string[];
  chat: Turn[];
  detectedLanguage?: string;
  languageLabel?: string;
  tools?: ToolDef[];
  toolRuns?: Array<{ tool: string; at: string; result: Record<string, unknown> }>;
  product?: { name: string; tagline: string };
}

const HISTORY_KEY = "nys_patra_mitra_history_v1";
const LANG_OPTIONS = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "te", label: "Telugu" },
  { code: "ta", label: "Tamil" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "pa", label: "Punjabi" },
  { code: "or", label: "Odia" },
  { code: "mixed", label: "Mixed / auto" },
];

const PIPELINE = ["Upload", "Extract / OCR", "Language", "Fields", "Summary", "Ready"] as const;

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

function loadLocalHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(items: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 40)));
}

function MarkdownLite({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l) || !l.trim())) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>{l.replace(/^\s*[-*•]\s+/, "")}</li>
                ))}
            </ul>
          );
        }
        if (/^#{1,3}\s/.test(lines[0])) {
          return (
            <div key={i}>
              <div className="font-serif font-semibold text-base mb-1" style={{ color: BRAND.primary }}>
                {lines[0].replace(/^#{1,3}\s+/, "")}
              </div>
              {lines.slice(1).map((l, j) => (
                <p key={j}>{l}</p>
              ))}
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {block}
          </p>
        );
      })}
    </div>
  );
}

function copyText(label: string, value: string, toast: ReturnType<typeof useToast>["toast"]) {
  void navigator.clipboard.writeText(value).then(
    () => toast({ title: `${label} copied` }),
    () => toast({ title: "Copy failed", description: "Clipboard unavailable" }),
  );
}

export default function PatraMitra() {
  const { toast } = useToast();
  const { jurisdiction } = useJurisdiction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [tab, setTab] = useState<"summary" | "fields" | "tools" | "preview" | "chat">("summary");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [answerLanguage, setAnswerLanguage] = useState("en");
  const [pipelineStep, setPipelineStep] = useState(0);
  const [lastToolResult, setLastToolResult] = useState<{ tool: string; result: Record<string, unknown> } | null>(
    null,
  );

  const rememberSession = useCallback((s: Session) => {
    const item: HistoryItem = {
      sessionId: s.sessionId,
      fileName: s.fileName,
      documentType: s.documentType,
      wordCount: s.wordCount,
      detectedLanguage: s.detectedLanguage,
      languageLabel: s.languageLabel,
      createdAt: (s as any).createdAt || new Date().toISOString(),
      updatedAt: (s as any).updatedAt || new Date().toISOString(),
      fieldCount: s.fields?.length || 0,
      chatTurns: s.chat?.length || 0,
    };
    setHistory((prev) => {
      const next = [item, ...prev.filter((h) => h.sessionId !== item.sessionId)].slice(0, 40);
      saveLocalHistory(next);
      return next;
    });
  }, []);

  const refreshHistory = useCallback(async () => {
    const local = loadLocalHistory();
    setHistory(local);
    try {
      const body = await api<{ success: boolean; data: { sessions: HistoryItem[] } }>("/patra-mitra/sessions");
      const remote = body.data?.sessions || [];
      const byId = new Map<string, HistoryItem>();
      for (const s of [...remote, ...local]) byId.set(s.sessionId, s);
      const merged = [...byId.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      setHistory(merged);
      saveLocalHistory(merged);
    } catch {
      /* local history is enough offline */
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const tools = useMemo(
    () =>
      session?.tools?.length
        ? session.tools
        : [
            { id: "detect_language", label: "Detect language", description: "Script / language cues" },
            { id: "extract_parties", label: "Extract parties", description: "Party names" },
            { id: "extract_dates", label: "Extract dates", description: "Date mentions" },
            { id: "extract_amounts", label: "Extract amounts", description: "Currency figures" },
            { id: "extract_citations", label: "Citations & CNR", description: "Sections / CNR" },
            { id: "find_clauses", label: "Find key clauses", description: "Clause cues" },
            { id: "pii_scan", label: "PII scan", description: "Sensitive patterns" },
            { id: "regenerate_summary", label: "Regenerate summary", description: "Refresh overview" },
            { id: "export_fields", label: "Export fields", description: "JSON export" },
          ],
    [session],
  );

  const openSession = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setPipelineStep(1);
      try {
        setPipelineStep(2);
        const tick = window.setInterval(() => {
          setPipelineStep((p) => Math.min(p + 1, 4));
        }, 450);
        const body = await api<{ success: boolean; data: Session }>("/patra-mitra/sessions", {
          method: "POST",
          body: JSON.stringify({ ...payload, jurisdiction }),
        });
        window.clearInterval(tick);
        setPipelineStep(5);
        setSession(body.data);
        rememberSession(body.data);
        if (body.data.detectedLanguage) setAnswerLanguage(body.data.detectedLanguage === "mixed" ? "en" : body.data.detectedLanguage);
        setTab("summary");
        setLastToolResult(null);
        toast({
          title: "Document ready",
          description: `${body.data.fileName} · ${body.data.wordCount.toLocaleString()} words · ${body.data.languageLabel || "language detected"}`,
        });
      } catch (e: any) {
        toast({ title: "Parse failed", description: e?.message || "Try another file" });
      } finally {
        setBusy(false);
        setPipelineStep(0);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [jurisdiction, rememberSession, toast],
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const base64 = await fileToBase64(file);
      await openSession({
        base64,
        fileName: file.name,
        mimeType: file.type || undefined,
      });
    },
    [openSession],
  );

  const onPasteSubmit = async () => {
    if (!pasteText.trim()) return;
    setPasteOpen(false);
    await openSession({
      content: pasteText,
      fileName: "pasted-text.txt",
      mimeType: "text/plain",
    });
    setPasteText("");
  };

  const reopen = async (id: string) => {
    setBusy(true);
    try {
      const body = await api<{ success: boolean; data: Session }>(`/patra-mitra/sessions/${encodeURIComponent(id)}`);
      setSession(body.data);
      rememberSession(body.data);
      setTab("summary");
    } catch (e: any) {
      toast({
        title: "Session unavailable",
        description: e?.message || "Expired on server — re-upload the file",
      });
      setHistory((prev) => {
        const next = prev.filter((h) => h.sessionId !== id);
        saveLocalHistory(next);
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!session || !question.trim()) return;
    setChatBusy(true);
    const q = question.trim();
    setQuestion("");
    setTab("chat");
    try {
      const body = await api<{ success: boolean; data: { answer: string; session: Session } }>(
        `/patra-mitra/sessions/${encodeURIComponent(session.sessionId)}/chat`,
        { method: "POST", body: JSON.stringify({ message: q, jurisdiction, answerLanguage }) },
      );
      setSession(body.data.session);
      rememberSession(body.data.session);
    } catch (e: any) {
      toast({ title: "Chat failed", description: e?.message || "Retry" });
    } finally {
      setChatBusy(false);
    }
  };

  const runTool = async (toolId: string) => {
    if (!session) return;
    setToolBusy(toolId);
    setTab("tools");
    try {
      const body = await api<{
        success: boolean;
        data: { tool: string; result: Record<string, unknown>; session: Session };
      }>(`/patra-mitra/sessions/${encodeURIComponent(session.sessionId)}/tools`, {
        method: "POST",
        body: JSON.stringify({ tool: toolId, answerLanguage }),
      });
      setSession(body.data.session);
      rememberSession(body.data.session);
      setLastToolResult({ tool: body.data.tool, result: body.data.result });
      if (toolId === "regenerate_summary") setTab("summary");
      toast({ title: "Tool complete", description: tools.find((t) => t.id === toolId)?.label || toolId });
    } catch (e: any) {
      toast({ title: "Tool failed", description: e?.message || "Retry" });
    } finally {
      setToolBusy(null);
    }
  };

  const clear = () => {
    setSession(null);
    setQuestion("");
    setTab("summary");
    setLastToolResult(null);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        <header className="flex flex-wrap items-start gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: BRAND.primary }}>
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-serif text-2xl font-semibold tracking-tight" style={{ color: BRAND.primary }}>
                Patra Mitra
              </h1>
              <p className="text-sm text-muted-foreground">
                Document processing workbench — any file type · OCR · multilingual · parse tools · history
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{jurisdiction}</Badge>
            <Badge variant="outline">Parse · Understand · Ask</Badge>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <aside className="lg:col-span-3 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="w-4 h-4" style={{ color: BRAND.accent }} />
                  Session history
                </CardTitle>
                <CardDescription>Re-open recent parses (TTL ~2h on server)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" size="sm" className="w-full" onClick={() => void refreshHistory()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  Refresh
                </Button>
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1 pr-2">
                    {history.length === 0 && (
                      <p className="text-xs text-muted-foreground p-2">No history yet — upload a document.</p>
                    )}
                    {history.map((h) => (
                      <button
                        key={h.sessionId}
                        type="button"
                        onClick={() => void reopen(h.sessionId)}
                        className={cn(
                          "w-full text-left rounded-md border px-2.5 py-2 text-xs hover:bg-muted/60 transition-colors",
                          session?.sessionId === h.sessionId && "bg-muted",
                        )}
                      >
                        <div className="font-medium truncate">{h.fileName}</div>
                        <div className="text-muted-foreground mt-0.5 truncate">
                          {h.documentType || "Document"} · {h.wordCount?.toLocaleString?.() || 0} words
                          {h.languageLabel ? ` · ${h.languageLabel}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Answer language</CardTitle>
                <CardDescription>For Ask + regenerate summary</CardDescription>
              </CardHeader>
              <CardContent>
                <select
                  className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                  value={answerLanguage}
                  onChange={(e) => setAnswerLanguage(e.target.value)}
                >
                  {LANG_OPTIONS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>
          </aside>

          <section className="lg:col-span-9 space-y-4">
            {!session && (
              <Card
                className={cn("border-dashed transition-colors", dragging && "border-primary bg-muted/40")}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void onFiles(e.dataTransfer.files);
                }}
              >
                <CardContent className="py-12 flex flex-col items-center text-center gap-4">
                  {busy ? (
                    <>
                      <Loader2 className="w-10 h-10 animate-spin" style={{ color: BRAND.accent }} />
                      <p className="text-sm font-medium">Processing document…</p>
                      <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                        {PIPELINE.map((step, i) => (
                          <Badge
                            key={step}
                            variant={i <= pipelineStep ? "default" : "outline"}
                            className="gap-1"
                          >
                            {i < pipelineStep ? <CheckCircle2 className="w-3 h-3" /> : null}
                            {step}
                          </Badge>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-muted-foreground" />
                      <div>
                        <p className="font-medium" style={{ color: BRAND.primary }}>
                          Drop any document or image
                        </p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-lg">
                          PDF · DOCX · TXT · MD · PNG · JPEG · WebP · TIFF — scanned pages use OCR. English and Indic
                          scripts supported. Paste plain text when you only have a selection.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-center">
                        <Button onClick={() => inputRef.current?.click()} style={{ background: BRAND.primary }}>
                          <FileText className="w-4 h-4 mr-2" />
                          Choose file
                        </Button>
                        <Button variant="outline" onClick={() => setPasteOpen((v) => !v)}>
                          <ClipboardPaste className="w-4 h-4 mr-2" />
                          Paste text
                        </Button>
                      </div>
                      <input
                        ref={inputRef}
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.tiff"
                        onChange={(e) => void onFiles(e.target.files)}
                      />
                      {pasteOpen && (
                        <div className="w-full max-w-2xl text-left space-y-2">
                          <Textarea
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            placeholder="Paste judgment excerpt, petition, notice, contract clause…"
                            className="min-h-[140px]"
                          />
                          <Button onClick={() => void onPasteSubmit()} disabled={!pasteText.trim()} style={{ background: BRAND.primary }}>
                            Parse pasted text
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {session && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <aside className="xl:col-span-4 space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate font-serif">{session.fileName}</CardTitle>
                          <CardDescription className="mt-1">
                            {session.documentType || "Document"} · {session.extractionMethod}
                            {session.languageLabel ? ` · ${session.languageLabel}` : ""}
                          </CardDescription>
                        </div>
                        <Button variant="ghost" size="icon" onClick={clear} aria-label="Clear">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{session.wordCount.toLocaleString()} words</Badge>
                        <Badge variant="outline">{session.characterCount.toLocaleString()} chars</Badge>
                        <Badge variant="outline">{session.fields?.length || 0} fields</Badge>
                      </div>
                      {session.warnings?.length > 0 && (
                        <div className="flex gap-2 text-amber-700 bg-amber-50 rounded-md p-2 text-xs">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{session.warnings.join(" · ")}</span>
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        {(
                          [
                            ["summary", "Summary", Sparkles],
                            ["fields", "Fields", ListChecks],
                            ["tools", "Parse tools", Wrench],
                            ["preview", "Text preview", FileText],
                            ["chat", "Ask document", MessageSquare],
                          ] as const
                        ).map(([id, label, Icon]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                              tab === id ? "bg-muted font-medium" : "hover:bg-muted/50",
                            )}
                            style={tab === id ? { boxShadow: `inset 3px 0 0 ${BRAND.accent}` } : undefined}
                          >
                            <Icon className="w-4 h-4" style={{ color: BRAND.accent }} />
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => inputRef.current?.click()}
                          disabled={busy}
                        >
                          Replace
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => setPasteOpen(true)}>
                          Paste
                        </Button>
                      </div>
                      <input
                        ref={inputRef}
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.tiff"
                        onChange={(e) => void onFiles(e.target.files)}
                      />
                      {pasteOpen && (
                        <div className="space-y-2">
                          <Textarea
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            placeholder="Paste replacement text…"
                            className="min-h-[100px]"
                          />
                          <Button size="sm" onClick={() => void onPasteSubmit()} disabled={!pasteText.trim()}>
                            Parse paste
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </aside>

                <main className="xl:col-span-8 space-y-4">
                  {tab === "summary" && (
                    <Card>
                      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                        <div>
                          <CardTitle className="font-serif text-lg">Summary</CardTitle>
                          <CardDescription>
                            Counsel-grade overview · {session.languageLabel || "language detected"}
                          </CardDescription>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyText("Summary", session.summary || "", toast)}
                          >
                            <Copy className="w-3.5 h-3.5 mr-1" />
                            Copy
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!toolBusy}
                            onClick={() => void runTool("regenerate_summary")}
                          >
                            {toolBusy === "regenerate_summary" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <Languages className="w-3.5 h-3.5 mr-1" />
                                Regenerate
                              </>
                            )}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {!session.summary?.trim() ? (
                          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground space-y-3">
                            <p>No summary yet. Regenerate or use Ask for a targeted overview.</p>
                            <Button size="sm" onClick={() => void runTool("regenerate_summary")}>
                              Generate summary
                            </Button>
                          </div>
                        ) : (
                          <MarkdownLite text={session.summary} />
                        )}
                        {session.keyPoints?.length > 0 && (
                          <div>
                            <h3 className="text-sm font-semibold mb-2" style={{ color: BRAND.primary }}>
                              Key points
                            </h3>
                            <ul className="list-disc pl-5 space-y-1 text-sm">
                              {session.keyPoints.map((k, i) => (
                                <li key={i}>{k}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {tab === "fields" && (
                    <Card>
                      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                        <div>
                          <CardTitle className="font-serif text-lg">Extracted fields</CardTitle>
                          <CardDescription>Parties, dates, amounts, citations, and structured cues</CardDescription>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            copyText("Fields JSON", JSON.stringify(session.fields || [], null, 2), toast)
                          }
                        >
                          <Download className="w-3.5 h-3.5 mr-1" />
                          Export JSON
                        </Button>
                      </CardHeader>
                      <CardContent>
                        {session.fields?.length ? (
                          <div className="divide-y rounded-md border">
                            {session.fields.map((f) => (
                              <div key={f.key + f.label} className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
                                <div className="font-medium text-muted-foreground">
                                  {f.label}
                                  {typeof f.confidence === "number" && (
                                    <div className="text-[10px] opacity-70">{Math.round(f.confidence * 100)}%</div>
                                  )}
                                </div>
                                <div className="col-span-2 whitespace-pre-wrap">{f.value}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No structured fields yet — run party / date / amount tools.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {tab === "tools" && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="font-serif text-lg">Document parse tools</CardTitle>
                        <CardDescription>
                          Deterministic extractors + counsel summary refresh. Safe to run on any language document.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-2">
                          {tools.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              disabled={!!toolBusy}
                              onClick={() => void runTool(t.id)}
                              className="rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors disabled:opacity-60"
                            >
                              <div className="flex items-center gap-2 text-sm font-medium">
                                {toolBusy === t.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Wrench className="w-4 h-4" style={{ color: BRAND.accent }} />
                                )}
                                {t.label}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                            </button>
                          ))}
                        </div>
                        {lastToolResult && (
                          <div className="rounded-md border p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium">Last result · {lastToolResult.tool}</p>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  copyText("Tool result", JSON.stringify(lastToolResult.result, null, 2), toast)
                                }
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                            <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-72 bg-muted/40 rounded-md p-3">
                              {JSON.stringify(lastToolResult.result, null, 2)}
                            </pre>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {tab === "preview" && (
                    <Card>
                      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                        <div>
                          <CardTitle className="font-serif text-lg">Text preview</CardTitle>
                          <CardDescription>First portion of extracted / OCR’d content</CardDescription>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyText("Preview", session.textPreview || "", toast)}
                        >
                          <Copy className="w-3.5 h-3.5 mr-1" />
                          Copy
                        </Button>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[420px] rounded-md border p-4">
                          <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">
                            {session.textPreview || "No text extracted."}
                          </pre>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {tab === "chat" && (
                    <Card className="flex flex-col min-h-[520px]">
                      <CardHeader>
                        <CardTitle className="font-serif text-lg">Ask the document</CardTitle>
                        <CardDescription>
                          Grounded Q&A only — answers use this upload. Language:{" "}
                          {LANG_OPTIONS.find((l) => l.code === answerLanguage)?.label || answerLanguage}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 flex flex-col gap-4">
                        <div className="flex flex-wrap gap-2">
                          {[
                            "Who are the parties?",
                            "List key dates and deadlines",
                            "What amounts are mentioned?",
                            "Summarize obligations in bullets",
                          ].map((q) => (
                            <Button key={q} size="sm" variant="secondary" onClick={() => setQuestion(q)}>
                              {q}
                            </Button>
                          ))}
                        </div>
                        <ScrollArea className="flex-1 min-h-[280px] rounded-md border p-4">
                          <div className="space-y-4">
                            {(session.chat || []).length === 0 && (
                              <p className="text-sm text-muted-foreground">
                                Ask in English or Indic — set answer language in the left panel.
                              </p>
                            )}
                            {(session.chat || []).map((t, i) => (
                              <div
                                key={i}
                                className={cn(
                                  "rounded-lg px-3 py-2 text-sm max-w-[92%]",
                                  t.role === "user" ? "ml-auto bg-muted" : "mr-auto border bg-background",
                                )}
                              >
                                {t.role === "assistant" ? (
                                  <MarkdownLite text={t.content} />
                                ) : (
                                  <p className="whitespace-pre-wrap">{t.content}</p>
                                )}
                              </div>
                            ))}
                            {chatBusy && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                        <div className="flex gap-2">
                          <Textarea
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="Ask a question about this document…"
                            className="min-h-[52px] resize-none"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void ask();
                              }
                            }}
                          />
                          <Button
                            onClick={() => void ask()}
                            disabled={chatBusy || !question.trim()}
                            style={{ background: BRAND.primary }}
                            className="shrink-0 h-auto"
                          >
                            {chatBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </main>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
