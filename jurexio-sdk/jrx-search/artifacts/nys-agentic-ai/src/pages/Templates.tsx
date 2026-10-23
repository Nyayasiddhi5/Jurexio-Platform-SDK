import { useRef, useState } from "react";
import {
  useListTemplates,
  getListTemplatesQueryKey,
  useGetTemplate,
  getGetTemplateQueryKey,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
  useExtractTemplateText,
  type ListTemplatesParams,
  type TemplateInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  FileText,
  ListChecks,
  Copy,
  Loader2,
  Globe,
  Plus,
  Upload,
  Pencil,
  Trash2,
  Sparkles,
} from "lucide-react";
import { useJurisdiction, isReserved, isAllJurisdictions, JURISDICTIONS } from "@/lib/jurisdiction";

interface EditorState {
  mode: "create" | "edit";
  editId?: number;
  kind: "template" | "checklist";
  title: string;
  category: string;
  jurisdiction: "IN" | "US";
  description: string;
  body: string;
  tags: string;
  sourceFilename?: string;
}

const emptyEditor: EditorState = {
  mode: "create",
  kind: "template",
  title: "",
  category: "",
  jurisdiction: "IN",
  description: "",
  body: "",
  tags: "",
};

export default function Templates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [courtFilter, setCourtFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const { jurisdiction, setJurisdiction } = useJurisdiction();
  const canBrowse = isAllJurisdictions(jurisdiction) || jurisdiction === "IN" || jurisdiction === "US";
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const params: ListTemplatesParams = { jurisdiction };
  if (kind !== "all") params.kind = kind as "template" | "checklist";
  if (search.trim()) params.search = search.trim();

  const { data: templates, isLoading } = useListTemplates(params, {
    query: { enabled: canBrowse, queryKey: getListTemplatesQueryKey(params) },
  });

  const filteredTemplates = (templates ?? []).filter((t) => {
    const tags = (t.tags ?? []).map((x) => String(x).toLowerCase());
    if (courtFilter !== "all" && !tags.includes(`court:${courtFilter}`)) return false;
    if (tierFilter === "1" && !tags.some((x) => x.startsWith("tier:1"))) return false;
    if (tierFilter === "2" && !tags.some((x) => x.startsWith("tier:2"))) return false;
    if (tierFilter === "3" && !tags.some((x) => x.startsWith("tier:3"))) return false;
    return true;
  });

  const { data: detail, isLoading: detailLoading } = useGetTemplate(openId ?? 0, {
    query: { enabled: !!openId, queryKey: getGetTemplateQueryKey(openId ?? 0) },
  });

  const invalidate = (id?: number) => {
    queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
    if (id) queryClient.invalidateQueries({ queryKey: getGetTemplateQueryKey(id) });
  };

  const createMutation = useCreateTemplate({
    mutation: {
      onSuccess: (created) => {
        invalidate();
        setEditor(null);
        toast({ title: "Template saved", description: created.title });
      },
      onError: (err) =>
        toast({
          title: "Could not save template",
          description: err instanceof Error ? err.message : "Save failed",
          variant: "destructive",
        }),
    },
  });

  const updateMutation = useUpdateTemplate({
    mutation: {
      onSuccess: (updated) => {
        invalidate(updated.id);
        setEditor(null);
        toast({ title: "Template updated", description: updated.title });
      },
      onError: (err) =>
        toast({
          title: "Could not update template",
          description: err instanceof Error ? err.message : "Update failed",
          variant: "destructive",
        }),
    },
  });

  const deleteMutation = useDeleteTemplate({
    mutation: {
      onSuccess: () => {
        invalidate();
        setConfirmDeleteId(null);
        setOpenId(null);
        toast({ title: "Template deleted" });
      },
      onError: (err) =>
        toast({
          title: "Could not delete template",
          description: err instanceof Error ? err.message : "Delete failed",
          variant: "destructive",
        }),
    },
  });

  const extractMutation = useExtractTemplateText({
    mutation: {
      onSuccess: (result) => {
        const baseName = result.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        setEditor((prev) => ({
          ...(prev ?? emptyEditor),
          mode: "create",
          title: prev?.title || baseName,
          body: result.text,
          sourceFilename: result.filename,
        }));
        toast({
          title: result.ocrUsed ? "Text recovered via OCR" : "Text extracted",
          description: `${result.text.length.toLocaleString()} characters — review and edit before saving.`,
        });
      },
      onError: (err) =>
        toast({
          title: "Could not read file",
          description: err instanceof Error ? err.message : "Extraction failed",
          variant: "destructive",
        }),
    },
  });

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    if (!editor) setEditor({ ...emptyEditor });
    extractMutation.mutate({
      data: { filename: file.name, contentBase64: btoa(binary) },
    });
  };

  const saveEditor = () => {
    if (!editor) return;
    const payload: TemplateInput = {
      kind: editor.kind,
      title: editor.title.trim(),
      category: editor.category.trim(),
      jurisdiction: editor.jurisdiction,
      description: editor.description.trim(),
      body: editor.body,
      tags: editor.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10),
      ...(editor.sourceFilename ? { sourceFilename: editor.sourceFilename } : {}),
    };
    if (editor.mode === "edit" && editor.editId) {
      updateMutation.mutate({ id: editor.editId, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const editorValid =
    !!editor &&
    editor.title.trim().length >= 3 &&
    editor.category.trim().length >= 2 &&
    editor.description.trim().length >= 3 &&
    editor.body.trim().length >= 20;

  const saving = createMutation.isPending || updateMutation.isPending;

  if (isReserved(jurisdiction)) {
    const info = JURISDICTIONS.find((j) => j.code === jurisdiction);
    return (
      <div className="space-y-8">
        <h1 className="text-4xl font-serif font-bold text-foreground">
          Templates &amp; Checklists
        </h1>
        <Card className="border-dashed">
          <CardContent className="p-12 text-center space-y-3">
            <Globe className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-2xl font-serif font-semibold" data-testid="text-templates-coming-soon">
              {info?.flag} {info?.label} — Coming soon
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Templates and checklists for {info?.label} are on our roadmap. India and the United States libraries are live today — switch to Any/All, India, or United States in the sidebar.
            </p>
            <div className="flex justify-center gap-2 pt-2 flex-wrap">
              <Button onClick={() => setJurisdiction("ALL")} variant="default">Any / All</Button>
              <Button onClick={() => setJurisdiction("IN")} variant="outline">Switch to India</Button>
              <Button onClick={() => setJurisdiction("US")} variant="outline">Switch to United States</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-serif font-bold text-foreground mb-2">
            Templates &amp; Checklists
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            India library: final instruments by <strong>Supreme Court / High Court / District</strong> and
            quality <strong>Tier 1–3</strong> (simple · court-rules-aligned · comprehensive contractual).
            Aligned to court rules/practice — verify current e-filing directions before filing.
            {isAllJurisdictions(jurisdiction) && " Showing India and United States libraries."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              setEditor({ ...emptyEditor });
              setTimeout(() => fileInputRef.current?.click(), 50);
            }}
          >
            <Upload className="w-4 h-4" /> Upload document
          </Button>
          <Button className="gap-2" onClick={() => setEditor({ ...emptyEditor })}>
            <Plus className="w-4 h-4" /> New template
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.md,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={kind} onValueChange={setKind}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="template">Templates</TabsTrigger>
            <TabsTrigger value="checklist">Checklists</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={courtFilter} onValueChange={setCourtFilter}>
          <SelectTrigger className="w-[200px]" data-testid="select-court-filter">
            <SelectValue placeholder="Court forum" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All forums</SelectItem>
            <SelectItem value="supreme-court">Supreme Court</SelectItem>
            <SelectItem value="high-court">High Court</SelectItem>
            <SelectItem value="district-court">District / Sessions</SelectItem>
            <SelectItem value="contractual">Contractual (Tier instruments)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-[220px]" data-testid="select-tier-filter">
            <SelectValue placeholder="Quality tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="1">Tier 1 · Simple</SelectItem>
            <SelectItem value="2">Tier 2 · Court-aligned</SelectItem>
            <SelectItem value="3">Tier 3 · Comprehensive</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search templates…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-lg" />
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="p-16 text-center bg-card border rounded-lg text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>No templates match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredTemplates.map((t) => {
            const tags = (t.tags ?? []).map((x) => String(x));
            const courtTag = tags.find((x) => x.startsWith("court:"))?.replace("court:", "");
            const tierTag = tags.find((x) => x.startsWith("tier:"));
            return (
            <Card
              key={t.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setOpenId(t.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="font-serif text-lg leading-snug">
                    {t.title}
                  </CardTitle>
                  <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {courtTag && (
                      <Badge variant="outline" className="text-[10px]">
                        {courtTag.replace(/-/g, " ")}
                      </Badge>
                    )}
                    {tierTag && (
                      <Badge variant="secondary" className="text-[10px]">
                        {tierTag.replace("tier:", "T")}
                      </Badge>
                    )}
                    {t.isCustom && (
                      <Badge variant="outline" className="gap-1 border-primary/50 text-primary">
                        <Sparkles className="w-3 h-3" /> custom
                      </Badge>
                    )}
                    <Badge variant={t.kind === "template" ? "default" : "secondary"} className="gap-1">
                      {t.kind === "template" ? (
                        <FileText className="w-3 h-3" />
                      ) : (
                        <ListChecks className="w-3 h-3" />
                      )}
                      {t.kind}
                    </Badge>
                  </div>
                </div>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{t.jurisdiction}</Badge>
                  <Badge variant="outline">{t.category}</Badge>
                  {t.tags.slice(0, 4).map((tag) => (
                    <Badge key={tag} variant="secondary" className="font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!openId} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-serif pr-8">
              {detail?.title ?? "Loading…"}
            </DialogTitle>
            {detail && <DialogDescription>{detail.description}</DialogDescription>}
          </DialogHeader>
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge>{detail.kind}</Badge>
                <Badge variant="outline">{detail.jurisdiction}</Badge>
                <Badge variant="outline">{detail.category}</Badge>
                {detail.isCustom && (
                  <Badge variant="outline" className="gap-1 border-primary/50 text-primary">
                    <Sparkles className="w-3 h-3" />
                    {detail.source === "uploaded" ? "custom · uploaded" : "custom"}
                  </Badge>
                )}
                {detail.sourceFilename && (
                  <Badge variant="secondary" className="font-normal">
                    {detail.sourceFilename}
                  </Badge>
                )}
              </div>
              <pre className="flex-1 overflow-y-auto whitespace-pre-wrap text-sm bg-muted/50 border rounded-md p-4 font-mono leading-relaxed">
                {detail.body}
              </pre>
              <div className="flex justify-between gap-2">
                <div className="flex gap-2">
                  {detail.isCustom && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          setEditor({
                            mode: "edit",
                            editId: detail.id,
                            kind: detail.kind as "template" | "checklist",
                            title: detail.title,
                            category: detail.category,
                            jurisdiction: (detail.jurisdiction === "US" ? "US" : "IN"),
                            description: detail.description,
                            body: detail.body,
                            tags: detail.tags.join(", "),
                          });
                          setOpenId(null);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 text-destructive hover:text-destructive"
                        onClick={() => setConfirmDeleteId(detail.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </Button>
                    </>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    navigator.clipboard.writeText(detail.body);
                    toast({ title: "Copied to clipboard" });
                  }}
                >
                  <Copy className="w-3.5 h-3.5" /> Copy body
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this template?</DialogTitle>
            <DialogDescription>
              This permanently removes the custom template from your library.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDeleteId && deleteMutation.mutate({ id: confirmDeleteId })}
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create / edit editor */}
      <Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editor?.mode === "edit" ? "Edit template" : "New template"}
            </DialogTitle>
            <DialogDescription>
              {editor?.mode === "edit"
                ? "Update your custom template."
                : "Write the body in markdown, or upload a DOCX/PDF/MD document to start from its text."}
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input
                    value={editor.title}
                    placeholder="e.g. Anticipatory Bail Application (BNSS 482)"
                    onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Category (practice area)</Label>
                  <Input
                    value={editor.category}
                    placeholder="e.g. criminal, arbitration, contracts"
                    onChange={(e) => setEditor({ ...editor, category: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Kind</Label>
                  <Select
                    value={editor.kind}
                    onValueChange={(v) =>
                      setEditor({ ...editor, kind: v as "template" | "checklist" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="template">Template</SelectItem>
                      <SelectItem value="checklist">Checklist</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Jurisdiction</Label>
                  <Select
                    value={editor.jurisdiction}
                    onValueChange={(v) =>
                      setEditor({ ...editor, jurisdiction: v as "IN" | "US" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN">India (IN)</SelectItem>
                      <SelectItem value="US">United States (US)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input
                  value={editor.description}
                  placeholder="One-line summary shown in the library"
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tags (comma-separated, optional)</Label>
                <Input
                  value={editor.tags}
                  placeholder="bail, criminal, BNSS"
                  onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Body (markdown)</Label>
                  <div className="flex items-center gap-2">
                    {editor.sourceFilename && (
                      <Badge variant="secondary" className="font-normal">
                        from {editor.sourceFilename}
                      </Badge>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={extractMutation.isPending}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {extractMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      {extractMutation.isPending ? "Extracting…" : "Upload document"}
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={editor.body}
                  rows={14}
                  placeholder={"# Heading\n\n1. Parties\n2. Facts\n3. Grounds\n4. Prayer"}
                  className="font-mono text-sm"
                  onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {editor.body.trim().length.toLocaleString()} characters
                  {editor.body.trim().length < 20 && " — at least 20 required"}
                </p>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button disabled={!editorValid || saving} onClick={saveEditor}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editor?.mode === "edit" ? "Save changes" : "Save template"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
