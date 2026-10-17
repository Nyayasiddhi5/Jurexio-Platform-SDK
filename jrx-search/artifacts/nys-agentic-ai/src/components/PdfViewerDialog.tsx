import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ExternalLink, Download, AlertTriangle } from "lucide-react";

/**
 * Shared in-app PDF viewer dialog. Presigned URLs expire quickly (SC links
 * have a 5-minute TTL), so a fresh URL is fetched via `fetchUrl` every time
 * the viewer or a new tab is opened — never reused from a previous open.
 */
export function usePdfViewer(fetchUrl: () => Promise<string | null>) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const openViewer = async () => {
    setViewerOpen(true);
    setLoading(true);
    setError(null);
    setUrl(null);
    const link = await fetchUrl();
    if (link) {
      setUrl(link);
    } else {
      setError(
        "Failed to generate a secure link for this PDF. The link may have expired or the document service is unavailable. Please try again.",
      );
    }
    setLoading(false);
  };

  const openInNewTab = async () => {
    setTabLoading(true);
    const link = await fetchUrl();
    setTabLoading(false);
    if (link) {
      window.open(link, "_blank", "noopener,noreferrer");
    } else {
      toast({
        title: "Could not open document",
        description:
          "Failed to generate a secure link for this PDF. Please try again.",
        variant: "destructive",
      });
    }
  };

  return {
    viewerOpen,
    setViewerOpen,
    url,
    loading,
    tabLoading,
    error,
    openViewer,
    openInNewTab,
  };
}

export function PdfViewerDialog({
  viewer,
  title,
}: {
  viewer: ReturnType<typeof usePdfViewer>;
  title?: string;
}) {
  const {
    viewerOpen,
    setViewerOpen,
    url,
    loading,
    tabLoading,
    error,
    openViewer,
    openInNewTab,
  } = viewer;

  const download = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = title ? `${title}.pdf` : "";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="pr-8 text-base font-serif leading-snug">
            {title ?? "Judgment document"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 bg-muted/30">
          {loading && (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-3">
              <Loader2 className="w-6 h-6 animate-spin" />
              Generating a secure link and loading the document…
            </div>
          )}
          {!loading && error && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-8">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
              <p className="text-sm text-muted-foreground max-w-md">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={openViewer}
                data-testid="button-retry-pdf"
              >
                Retry
              </Button>
            </div>
          )}
          {!loading && !error && url && (
            <iframe
              src={url}
              title={title ?? "Judgment document"}
              className="w-full h-full border-0"
              data-testid="iframe-pdf-viewer"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={openInNewTab}
            disabled={tabLoading}
            data-testid="button-viewer-new-tab"
          >
            {tabLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ExternalLink className="w-3.5 h-3.5" />
            )}
            Open in new tab
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={download}
            disabled={!url}
            data-testid="button-download-pdf"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
