import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetRun,
  getGetRunQueryKey,
  useEvaluateRun,
  useDeleteRun,
  getListRunsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import type { RunDetail as RunDetailType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  AlertCircle,
  FileText,
  Scale,
  Loader2,
  Trash2,
  Clock,
  Gavel,
  ExternalLink,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Highlighter,
  Copy,
  Download,
  Pencil,
  Eye,
  Users,
  BookMarked,
  ScrollText,
  Info,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

/* ---------- Markdown serialization from TipTap JSON ---------- */
function serializeInline(node: JSONContent): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    const marks = node.marks ?? [];
    for (const m of marks) {
      if (m.type === "bold") text = `**${text}**`;
      else if (m.type === "italic") text = `*${text}*`;
      else if (m.type === "underline") text = `<u>${text}</u>`;
      else if (m.type === "highlight") text = `==${text}==`;
      else if (m.type === "code") text = `\`${text}\``;
    }
    return text;
  }
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(serializeInline).join("");
}

function serializeBlocks(nodes: JSONContent[], indent = ""): string {
  const out: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const level = (node.attrs?.level as number) ?? 1;
        out.push(`${"#".repeat(level)} ${(node.content ?? []).map(serializeInline).join("")}`);
        break;
      }
      case "paragraph": {
        out.push(indent + (node.content ?? []).map(serializeInline).join(""));
        break;
      }
      case "blockquote": {
        const inner = serializeBlocks(node.content ?? []);
        out.push(inner.split("\n").map((l) => `> ${l}`).join("\n"));
        break;
      }
      case "bulletList": {
        (node.content ?? []).forEach((li: JSONContent) => {
          const inner = serializeBlocks(li.content ?? []).trim();
          out.push(`${indent}- ${inner}`);
        });
        break;
      }
      case "orderedList": {
        (node.content ?? []).forEach((li: JSONContent, i: number) => {
          const inner = serializeBlocks(li.content ?? []).trim();
          out.push(`${indent}${i + 1}. ${inner}`);
        });
        break;
      }
      case "codeBlock": {
        out.push("```\n" + (node.content ?? []).map(serializeInline).join("") + "\n```");
        break;
      }
      case "horizontalRule": {
        out.push("---");
        break;
      }
      default: {
        if (node.content) out.push(serializeBlocks(node.content, indent));
      }
    }
  }
  return out.join("\n\n");
}

function editorToMarkdown(editor: Editor): string {
  const json = editor.getJSON();
  return serializeBlocks(json.content ?? []).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ---------- Intelligence extraction ---------- */
interface StatuteRef {
  label: string;
  query: string;
}

function extractStatutes(text: string): StatuteRef[] {
  const found = new Map<string, StatuteRef>();
  const codes = "BNS|BNSS|BSA|IPC|CrPC|CRPC|IEA";
  const patterns: RegExp[] = [
    new RegExp(`\\bSection\\s+(\\d+[A-Z]?)\\s+of\\s+the\\s+(${codes})\\b`, "gi"),
    new RegExp(`\\b(${codes})\\s+(?:Section\\s+)?(\\d+[A-Z]?)\\b`, "gi"),
    new RegExp(`\\bSection\\s+(\\d+[A-Z]?)\\s+(${codes})\\b`, "gi"),
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      let code: string, section: string;
      if (/^section/i.test(m[0]) && m[2] && /^(?:BNS|BNSS|BSA|IPC|CrPC|CRPC|IEA)$/i.test(m[2])) {
        section = m[1];
        code = m[2];
      } else if (/^section/i.test(m[0]) && /^(?:BNS|BNSS|BSA|IPC|CrPC|CRPC|IEA)$/i.test(m[2] ?? "")) {
        section = m[1];
        code = m[2];
      } else {
        code = m[1];
        section = m[2];
      }
      const codeNorm = code.toUpperCase() === "CRPC" ? "CrPC" : code.toUpperCase();
      const label = `${codeNorm} § ${section}`;
      found.set(label, { label, query: `${codeNorm} ${section}` });
    }
  }
  // Articles of the Constitution
  const artRe = /\bArticle\s+(\d+[A-Z]?)\b/gi;
  let am: RegExpExecArray | null;
  while ((am = artRe.exec(text))) {
    const label = `Article ${am[1]}`;
    found.set(label, { label, query: `Article ${am[1]}` });
  }
  return Array.from(found.values()).slice(0, 24);
}

function extractParties(text: string): string[] {
  const parties = new Set<string>();
  const re = /([A-Z][A-Za-z.&'’\- ]{1,60}?)\s+(?:v\.?|vs\.?|versus)\s+([A-Z][A-Za-z.&'’\- ]{1,60})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = m[1].trim().replace(/\s+/g, " ");
    const b = m[2].trim().replace(/\s+/g, " ").replace(/[.,;].*$/, "");
    if (a.length > 1 && b.length > 1) parties.add(`${a} v. ${b}`);
  }
  return Array.from(parties).slice(0, 12);
}

function extractCitations(text: string): string[] {
  const cites = new Set<string>();
  const patterns: RegExp[] = [
    /\(\d{4}\)\s+\d+\s+SCC\s+\d+/g,
    /AIR\s+\d{4}\s+[A-Z]{2,4}\s+\d+/g,
    /\d{4}\s+SCC\s+OnLine\s+[A-Za-z]+\s+\d+/g,
    /\(\d{4}\)\s+\d+\s+[A-Z]{2,5}\s+\d+/g,
    /\b\d+\s+U\.S\.\s+\d+/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) cites.add(m[0].trim().replace(/\s+/g, " "));
  }
  // case names X v. Y
  const nameRe = /([A-Z][A-Za-z.&'’\- ]{1,50}?)\s+(?:v\.?|vs\.?)\s+([A-Z][A-Za-z.&'’\- ]{1,50}?)(?=[,.;\n]|\s+\()/g;
  let nm: RegExpExecArray | null;
  while ((nm = nameRe.exec(text))) {
    const name = `${nm[1].trim()} v. ${nm[2].trim()}`.replace(/\s+/g, " ");
    cites.add(name);
  }
  return Array.from(cites).slice(0, 16);
}

function firstSentences(text: string, n = 2): string {
  const plain = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>#`]/g, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return plain.slice(0, 280);
  return sentences.slice(0, n).join(" ").trim();
}

/* ---------- Toolbar ---------- */
function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40",
        active && "bg-primary/10 text-primary border-primary/20",
      )}
    >
      {children}
    </button>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-3 py-2 rounded-t-lg sticky top-0 z-10">
      <ToolbarButton title="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton title="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton title="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="w-4 h-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="w-4 h-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton title="Ordered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton title="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="w-4 h-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton title="Highlight important topic" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter className="w-4 h-4" />
      </ToolbarButton>
    </div>
  );
}

/* ---------- Draft editor ---------- */
function DraftEditor({ markdown }: { markdown: string }) {
  const { toast } = useToast();
  const [editable, setEditable] = useState(false);

  const initialHtml = useMemo(() => {
    try {
      const raw = marked.parse(markdown, { async: false }) as string;
      return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    } catch {
      return `<p>${DOMPurify.sanitize(markdown, { USE_PROFILES: { html: true } })}</p>`;
    }
  }, [markdown]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: false }),
    ],
    content: initialHtml,
    editable: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-base max-w-none focus:outline-none prose-headings:font-serif prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl text-foreground/90 min-h-[400px]",
      },
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;

  const handleCopy = async () => {
    const md = editorToMarkdown(editor);
    try {
      await navigator.clipboard.writeText(md);
      toast({ title: "Copied", description: "Draft copied to clipboard as Markdown." });
    } catch {
      toast({ variant: "destructive", title: "Copy failed" });
    }
  };

  const handleDownload = () => {
    const md = editorToMarkdown(editor);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "work-product.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="shadow-sm border-t-4 border-t-primary overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
        <Button
          variant={editable ? "default" : "outline"}
          size="sm"
          className="gap-2"
          onClick={() => setEditable((e) => !e)}
        >
          {editable ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          {editable ? "Done editing" : "Edit draft"}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleCopy}>
            <Copy className="w-4 h-4" /> Copy
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleDownload}>
            <Download className="w-4 h-4" /> Download .md
          </Button>
        </div>
      </div>
      {editable && <EditorToolbar editor={editor} />}
      <CardContent className="bg-white dark:bg-card p-8 md:p-14">
        <div className="mx-auto max-w-3xl font-serif">
          <EditorContent editor={editor} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Intelligence panel ---------- */
function IntelligencePanel({ run }: { run: RunDetailType }) {
  const output = run.output ?? "";
  const combined = `${run.title}\n${output}`;
  const statutes = useMemo(() => extractStatutes(output), [output]);
  const parties = useMemo(() => extractParties(combined), [combined]);
  const citations = useMemo(() => extractCitations(output), [output]);
  const summary = useMemo(() => (output ? firstSentences(output) : ""), [output]);
  const authorities = run.authorities ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-primary" /> Sections & Statutes
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {statutes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {statutes.map((s) => (
                <Link key={s.label} href={`/statutes?q=${encodeURIComponent(s.query)}`}>
                  <Badge variant="secondary" className="cursor-pointer hover:bg-primary/10">
                    {s.label}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No statutory references detected.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Parties
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {parties.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {parties.map((p) => (
                <li key={p} className="text-foreground/90">{p}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No parties detected.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" /> Citations & References
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {citations.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {citations.map((c) => (
                <Link key={c} href={`/caselaw?q=${encodeURIComponent(c)}`}>
                  <Badge variant="outline" className="cursor-pointer hover:bg-primary/10 font-normal">
                    {c}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No case citations detected.</p>
          )}
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Case summary
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" /> Case details
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2 text-sm">
          <DetailRow label="Practice area" value={run.categoryName} />
          <DetailRow label="Work type" value={run.workType} capitalize />
          <DetailRow label="Created" value={format(new Date(run.createdAt), "MMM d, yyyy")} />
          <DetailRow label="Status" value={run.status} capitalize />
          {run.evaluation && (
            <DetailRow
              label="Score"
              value={`${Math.round(run.evaluation.score)}% (${run.evaluation.passCount}/${run.evaluation.totalCount})`}
            />
          )}
        </CardContent>
      </Card>

      {authorities.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gavel className="w-4 h-4 text-primary" /> Verified authorities
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {authorities.map((a, i) => (
              <div key={i} className="text-sm border-l-2 border-primary/30 pl-3">
                <p className="font-medium leading-snug text-foreground/90">{a.title}</p>
                {a.court && <p className="text-xs text-muted-foreground">{a.court}</p>}
                {a.url && (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                  >
                    View opinion <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DetailRow({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium text-right text-foreground/90", capitalize && "capitalize")}>{value}</span>
    </div>
  );
}

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const runId = Number(id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: run, isLoading, isError } = useGetRun(runId, {
    query: { enabled: !!runId, queryKey: getGetRunQueryKey(runId) },
  });

  const evaluateRun = useEvaluateRun();
  const deleteRun = useDeleteRun();
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  const handleEvaluate = async () => {
    setIsEvaluating(true);
    try {
      await evaluateRun.mutateAsync({ id: runId });
      queryClient.invalidateQueries({ queryKey: getGetRunQueryKey(runId) });
      queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
      toast({
        title: "Evaluation Complete",
        description: "The work product has been graded against the rubric.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Evaluation Failed",
        description: "An error occurred during evaluation.",
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this run?")) return;
    try {
      await deleteRun.mutateAsync({ id: runId });
      queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast({ title: "Run deleted successfully" });
      setLocation("/runs");
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to delete run" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-8 w-32 bg-muted rounded"></div>
        <div className="h-12 w-3/4 bg-muted rounded"></div>
        <div className="h-96 bg-card border rounded-lg"></div>
      </div>
    );
  }

  if (isError || !run) {
    return (
      <div className="text-center p-12">
        <h2 className="text-2xl font-serif mb-4">Run not found</h2>
        <Link href="/runs">
          <Button variant="outline">Return to History</Button>
        </Link>
      </div>
    );
  }

  const hasRubric = run.criteria && run.criteria.length > 0;
  const authorities = run.authorities ?? [];
  const isEvaluated = !!run.evaluation;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <Link href="/runs">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back to History
          </Button>
        </Link>
        <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleDelete}>
          <Trash2 className="w-4 h-4" />
          Delete Run
        </Button>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start gap-6 border-b pb-6">
        <div className="space-y-4 flex-1">
          <div className="flex items-center gap-3">
            {run.status === "completed" && <Badge className="bg-green-700">Completed</Badge>}
            {run.status === "failed" && <Badge variant="destructive">Failed</Badge>}
            <Badge variant="secondary" className="uppercase tracking-wider">{run.categoryName}</Badge>
            <Badge variant="outline" className="capitalize">{run.workType}</Badge>
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground leading-tight">{run.title}</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {format(new Date(run.createdAt), "MMMM d, yyyy 'at' h:mm a")}
          </p>
        </div>

        {hasRubric && !isEvaluated && (
          <Button size="lg" className="gap-2" onClick={handleEvaluate} disabled={isEvaluating}>
            {isEvaluating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Scale className="w-5 h-5" />}
            {isEvaluating ? "Evaluating..." : "Evaluate against rubric"}
          </Button>
        )}

        {isEvaluated && run.evaluation && (
          <Card className="bg-muted/30 border-primary/20 shrink-0 min-w-[200px]">
            <CardContent className="p-4 flex flex-col items-center justify-center text-center">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Score</span>
              <div className="text-4xl font-serif font-bold text-primary mb-1">
                {Math.round(run.evaluation.score)}%
              </div>
              <span className="text-sm text-muted-foreground">
                {run.evaluation.passCount} / {run.evaluation.totalCount} Passed
              </span>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="output" className="w-full">
        <TabsList className="mb-6 h-12 w-full justify-start bg-transparent border-b rounded-none p-0">
          <TabsTrigger value="output" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-6 font-semibold">
            Work Product
          </TabsTrigger>
          <TabsTrigger value="instruction" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-6 font-semibold">
            Instructions & Context
          </TabsTrigger>
          {hasRubric && (
            <TabsTrigger value="evaluation" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-6 font-semibold">
              Evaluation Result
            </TabsTrigger>
          )}
          {authorities.length > 0 && (
            <TabsTrigger value="authorities" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-6 font-semibold">
              Authorities ({authorities.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="output" className="mt-0">
          {run.output ? (
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              <div className="flex-1 min-w-0 w-full">
                <div className="flex justify-end lg:hidden mb-3">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setPanelOpen((o) => !o)}>
                    {panelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                    {panelOpen ? "Hide intelligence" : "Show intelligence"}
                  </Button>
                </div>
                <DraftEditor markdown={run.output} />
              </div>
              <aside
                className={cn(
                  "w-full lg:w-[320px] lg:shrink-0 lg:sticky lg:top-6",
                  !panelOpen && "hidden lg:block",
                )}
              >
                <IntelligencePanel run={run} />
              </aside>
            </div>
          ) : (
            <Card className="shadow-sm border-t-4 border-t-primary min-h-[500px]">
              <CardContent className="p-8 md:p-12">
                <div className="text-center py-20 text-muted-foreground">
                  <AlertCircle className="w-10 h-10 mx-auto mb-4 opacity-50" />
                  <p>No work product was generated for this run.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="instruction" className="mt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  Original Instructions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/30 p-6 rounded-md whitespace-pre-wrap font-mono text-sm leading-relaxed">
                  {run.instruction}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  Provided Context
                </CardTitle>
              </CardHeader>
              <CardContent>
                {run.context ? (
                  <div className="bg-muted/30 p-6 rounded-md whitespace-pre-wrap text-sm leading-relaxed">
                    {run.context}
                  </div>
                ) : (
                  <div className="text-muted-foreground italic p-6">No additional context was provided.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {hasRubric && (
          <TabsContent value="evaluation" className="mt-0">
            {isEvaluated && run.evaluation ? (
              <div className="space-y-6">
                <div className="flex items-center gap-4 mb-8 p-4 bg-muted rounded-lg border">
                  <Scale className="w-8 h-8 text-primary" />
                  <div>
                    <h3 className="font-serif font-bold text-lg">AI Judge Evaluation</h3>
                    <p className="text-sm text-muted-foreground">Graded against {run.evaluation.totalCount} rubric criteria.</p>
                  </div>
                </div>

                <div className="grid gap-6">
                  {run.evaluation.results.map((result) => (
                    <Card key={result.criterionId} className={result.passed ? "border-l-4 border-l-green-600" : "border-l-4 border-l-destructive"}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-4">
                          <CardTitle className="text-base font-semibold leading-tight">
                            {result.title}
                          </CardTitle>
                          <Badge variant="outline" className={result.passed ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}>
                            {result.passed ? "PASSED" : "FAILED"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-muted/50 p-4 rounded text-sm text-muted-foreground leading-relaxed">
                          <strong>Rationale: </strong>{result.rationale}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center p-20 border rounded-lg bg-card">
                <Scale className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
                <h3 className="text-xl font-serif font-medium mb-2">Not Evaluated Yet</h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">This run has a grading rubric available, but hasn't been evaluated yet. Run the evaluation to grade the work product.</p>
                <Button onClick={handleEvaluate} disabled={isEvaluating} className="gap-2">
                  {isEvaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
                  {isEvaluating ? "Evaluating..." : "Evaluate Now"}
                </Button>
              </div>
            )}
          </TabsContent>
        )}

        {authorities.length > 0 && (
          <TabsContent value="authorities" className="mt-0">
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg border">
                <Gavel className="w-8 h-8 text-primary" />
                <div>
                  <h3 className="font-serif font-bold text-lg">Real Authorities Used for Grounding</h3>
                  <p className="text-sm text-muted-foreground">Retrieved from live legal databases before drafting; the agent could rely on these verified real cases.</p>
                </div>
              </div>
              {authorities.map((a, i) => (
                <Card key={i} className="border shadow-sm">
                  <CardContent className="p-6 space-y-1.5">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-serif font-semibold leading-snug">{a.title}</h3>
                      <Badge variant="secondary" className="shrink-0">
                        {a.source === "in-sc" ? "SC of India" : "CourtListener"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {a.citation && <span className="font-medium text-foreground">{a.citation}</span>}
                      {a.court && <span>{a.court}</span>}
                      {a.date && <span>{a.date}</span>}
                    </div>
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        View opinion <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
