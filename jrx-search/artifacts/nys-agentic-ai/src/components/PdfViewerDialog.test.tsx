import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PdfViewerDialog, usePdfViewer } from "./PdfViewerDialog";

function Harness({ fetchUrl, title }: { fetchUrl: () => Promise<string | null>; title?: string }) {
  const viewer = usePdfViewer(fetchUrl);
  return (
    <>
      <button type="button" onClick={viewer.openViewer} data-testid="button-open-viewer">
        View judgment PDF
      </button>
      <PdfViewerDialog viewer={viewer} title={title} />
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("PdfViewerDialog", () => {
  it("opens an in-app dialog with an iframe showing the fetched PDF URL", async () => {
    const fetchUrl = vi.fn().mockResolvedValue("https://example.com/doc.pdf?sig=1");
    render(<Harness fetchUrl={fetchUrl} title="State v. Example" />);

    fireEvent.click(screen.getByTestId("button-open-viewer"));

    expect(screen.getByText("State v. Example")).toBeTruthy();
    await waitFor(() => {
      const iframe = screen.getByTestId("iframe-pdf-viewer") as HTMLIFrameElement;
      expect(iframe.getAttribute("src")).toBe("https://example.com/doc.pdf?sig=1");
    });
    expect(fetchUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("button-viewer-new-tab")).toBeTruthy();
    expect(screen.getByTestId("button-download-pdf")).toBeTruthy();
  });

  it("shows an error with a Retry button when the URL fetch fails", async () => {
    const fetchUrl = vi.fn().mockResolvedValue(null);
    render(<Harness fetchUrl={fetchUrl} />);

    fireEvent.click(screen.getByTestId("button-open-viewer"));

    await waitFor(() => {
      expect(screen.getByTestId("button-retry-pdf")).toBeTruthy();
    });
    expect(screen.queryByTestId("iframe-pdf-viewer")).toBeNull();

    fetchUrl.mockResolvedValue("https://example.com/doc.pdf?sig=2");
    fireEvent.click(screen.getByTestId("button-retry-pdf"));
    await waitFor(() => {
      const iframe = screen.getByTestId("iframe-pdf-viewer") as HTMLIFrameElement;
      expect(iframe.getAttribute("src")).toBe("https://example.com/doc.pdf?sig=2");
    });
  });

  it("refetches a fresh URL on every open (presigned URLs expire)", async () => {
    let n = 0;
    const fetchUrl = vi.fn().mockImplementation(async () => `https://example.com/doc.pdf?sig=${++n}`);
    render(<Harness fetchUrl={fetchUrl} />);

    fireEvent.click(screen.getByTestId("button-open-viewer"));
    await waitFor(() => {
      expect(
        (screen.getByTestId("iframe-pdf-viewer") as HTMLIFrameElement).getAttribute("src"),
      ).toBe("https://example.com/doc.pdf?sig=1");
    });

    // Close then reopen — must fetch a fresh link, never reuse the old one.
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByTestId("button-open-viewer"));
    await waitFor(() => {
      expect(
        (screen.getByTestId("iframe-pdf-viewer") as HTMLIFrameElement).getAttribute("src"),
      ).toBe("https://example.com/doc.pdf?sig=2");
    });
    expect(fetchUrl).toHaveBeenCalledTimes(2);
  });
});
