import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { PdfViewerDialog, usePdfViewer } from "@/components/PdfViewerDialog";
import { listCnrDocuments } from "@/lib/cnrApi";
import type { CnrDocument } from "@/lib/cnrTypes";
import { extractErrorMessage } from "@/pages/CaselawSearch";

interface CaseDocumentsPanelProps {
  cnr: string;
  initialDocuments: CnrDocument[];
  className?: string;
}

function DocumentRow({ cnr, doc }: { cnr: string; doc: CnrDocument }) {
  const viewer = usePdfViewer(async () => {
    if (doc.url) return doc.url;
    const docs = await listCnrDocuments(cnr);
    const fresh = docs.find((d) => d.id === doc.id);
    return fresh?.url ?? null;
  });

  const label = doc.title || doc.kind;

  if (doc.url || doc.s3Path) {
    return (
      <>
        <button
          type="button"
          onClick={viewer.openViewer}
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline text-left"
        >
          <FileText className="w-3.5 h-3.5 shrink-0" />
          {label}
        </button>
        <PdfViewerDialog viewer={viewer} title={doc.title} />
      </>
    );
  }

  return (
    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
      <FileText className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

/** Document list with lazy presign via GET /api/cnr/:cnr/documents. */
export function CaseDocumentsPanel({
  cnr,
  initialDocuments,
  className,
}: CaseDocumentsPanelProps) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const docs = await listCnrDocuments(cnr);
      setDocuments(docs.length ? docs : initialDocuments);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [cnr, initialDocuments]);

  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-serif flex items-center gap-2">
          <FileText className="w-4 h-4" /> Documents
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
          className="h-8 gap-1.5"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Refresh links
        </Button>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-3">{error}</p>}
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents linked in corpus.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 border-b last:border-0"
              >
                <DocumentRow cnr={cnr} doc={doc} />
                <span className="text-xs text-muted-foreground">
                  {doc.decisionDate ?? doc.kind}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
