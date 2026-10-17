/**
 * Tests for the bounded PDF text-layer pass (NYS-ARCHIVE-LARGE-PDF-001).
 *
 * The cap was raised from 20 MB to 96 MB because Supreme Court PDFs are whole
 * SCR reporter-volume extracts, so the most-cited judgments in Indian
 * constitutional law were the ones being rejected (Kesavananda Bharati 35.8 MB /
 * 1,006 pages, Maneka Gandhi 60.9 MB). Raising a byte cap is only safe because
 * the real cost driver — PAGE COUNT — is now bounded: pages are read
 * sequentially with `cleanup()` under a page and wall-clock budget.
 *
 * These tests pin the properties that make the raise safe, using a fake
 * PDFDocumentProxy so no real PDF (or pdf.js runtime) is needed:
 *  - pages are read one at a time and released (never fanned out);
 *  - the page budget stops the pass and says so in the text;
 *  - the time budget stops the pass and says so in the text;
 *  - a complete read carries no truncation note.
 */
import { describe, it, expect, vi } from "vitest";
import {
  extractPdfTextLayer,
  MAX_TEXT_LAYER_PAGES,
  TEXT_LAYER_TIME_BUDGET_MS,
} from "../lib/extractDocText";

interface FakePage {
  getTextContent: () => Promise<{ items: Array<{ str: string; hasEOL: boolean }> }>;
  cleanup: () => void;
}

/** Minimal PDFDocumentProxy stand-in; `perPageDelayMs` lets a test outrun the clock. */
function fakePdf(numPages: number, perPageDelayMs = 0) {
  const opened: number[] = [];
  const cleaned: number[] = [];
  let concurrentOpen = 0;
  let maxConcurrentOpen = 0;
  const getPage = vi.fn(async (pageNumber: number): Promise<FakePage> => {
    opened.push(pageNumber);
    concurrentOpen += 1;
    maxConcurrentOpen = Math.max(maxConcurrentOpen, concurrentOpen);
    return {
      getTextContent: async () => {
        if (perPageDelayMs > 0) {
          await new Promise((r) => setTimeout(r, perPageDelayMs));
        }
        return {
          items: [
            { str: `page-${pageNumber}-alpha`, hasEOL: false },
            { str: `page-${pageNumber}-omega`, hasEOL: true },
          ],
        };
      },
      cleanup: () => {
        cleaned.push(pageNumber);
        concurrentOpen -= 1;
      },
    };
  });
  return {
    pdf: { numPages, getPage } as unknown as Parameters<typeof extractPdfTextLayer>[0],
    opened,
    cleaned,
    get maxConcurrentOpen() {
      return maxConcurrentOpen;
    },
  };
}

describe("extractPdfTextLayer", () => {
  it("reads a short PDF completely and adds no truncation note", async () => {
    const f = fakePdf(4);
    const result = await extractPdfTextLayer(f.pdf);
    expect(result.pagesRead).toBe(4);
    expect(result.totalPages).toBe(4);
    expect(result.truncated).toBe(false);
    expect(result.text).not.toMatch(/\[Note:/);
    expect(result.text).toContain("page-1-alpha");
    expect(result.text).toContain("page-4-omega");
  });

  it("releases each page before opening the next (bounded working set)", async () => {
    const f = fakePdf(50);
    await extractPdfTextLayer(f.pdf);
    expect(f.opened).toHaveLength(50);
    expect(f.cleaned).toHaveLength(50);
    // Unbounded Promise.all fan-out (what unpdf's extractText does) would hold
    // every page open at once; sequential reading keeps this at 1.
    expect(f.maxConcurrentOpen).toBe(1);
  });

  it("stops at the page budget and names it in the text", async () => {
    const f = fakePdf(1_006);
    const result = await extractPdfTextLayer(f.pdf, { maxPages: 25 });
    expect(result.pagesRead).toBe(25);
    expect(result.totalPages).toBe(1_006);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("first 25 of 1006 pages");
    expect(result.text).toContain("25-page extraction limit");
    expect(f.opened).toHaveLength(25);
  });

  it("stops at the time budget and says so rather than running past the caller timeout", async () => {
    const f = fakePdf(200, 12);
    const result = await extractPdfTextLayer(f.pdf, { timeBudgetMs: 60 });
    expect(result.pagesRead).toBeGreaterThan(0);
    expect(result.pagesRead).toBeLessThan(200);
    expect(result.truncated).toBe(true);
    expect(result.text).toMatch(/second extraction budget was reached/);
  });

  it("never opens more pages than the document has", async () => {
    const f = fakePdf(3);
    const result = await extractPdfTextLayer(f.pdf, { maxPages: 500 });
    expect(result.pagesRead).toBe(3);
    expect(result.truncated).toBe(false);
    expect(f.opened).toEqual([1, 2, 3]);
  });

  it("default budgets accommodate the largest reporter volume in the estate", () => {
    // Kesavananda Bharati is 1,006 pages and extracted in 17.6 s on the caselaw
    // worker; a budget below that would reintroduce the coverage hole as a
    // silent truncation instead of a 413.
    expect(MAX_TEXT_LAYER_PAGES).toBeGreaterThanOrEqual(1_006);
    expect(TEXT_LAYER_TIME_BUDGET_MS).toBeGreaterThanOrEqual(20_000);
    // ...and must stay inside the 60 s the NYV client allows for /athena/extract.
    expect(TEXT_LAYER_TIME_BUDGET_MS).toBeLessThan(60_000);
  });
});
