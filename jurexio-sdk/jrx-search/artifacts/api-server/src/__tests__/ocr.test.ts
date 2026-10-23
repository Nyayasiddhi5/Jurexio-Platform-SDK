import { describe, it, expect, vi } from "vitest";
import {
  extractDocumentText,
  ocrPdf,
  OcrError,
  type OcrDeps,
} from "../lib/extractDocText";

/**
 * Build a minimal, valid single-page PDF with NO text content stream — the
 * closest analog to a scanned / image-only page. unpdf extracts (near) empty
 * text from it, so the OCR fallback path is exercised.
 */
function buildImageOnlyPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const off of offsets) {
    body += `${off.toString().padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(body, "latin1");
}

describe("OCR fallback for scanned/image-only PDFs (#14)", () => {
  it("triggers OCR when a PDF has (near) no embedded text", async () => {
    const pdf = buildImageOnlyPdf();

    const rasterize = vi.fn<OcrDeps["rasterize"]>(async () => [
      Buffer.from("fake-png-page-1"),
    ]);
    const ocr = vi.fn<OcrDeps["ocr"]>(async () => "RECOVERED SCANNED TEXT");

    const result = await extractDocumentText("scan.pdf", pdf, {
      rasterize,
      ocr,
    });

    expect(rasterize).toHaveBeenCalledOnce();
    expect(ocr).toHaveBeenCalledOnce();
    expect(result.ocrUsed).toBe(true);
    expect(result.mimeType).toBe("application/pdf");
    expect(result.text).toContain("RECOVERED SCANNED TEXT");
  });

  it("caps OCR at 25 pages and notes truncation in the stored text", async () => {
    const rasterize = vi.fn<OcrDeps["rasterize"]>(async (_b, maxPages) =>
      Array.from({ length: maxPages }, (_v, i) =>
        Buffer.from(`page-${i}`),
      ),
    );
    const ocr = vi.fn<OcrDeps["ocr"]>(async () => "page text");

    const result = await ocrPdf(Buffer.from("x"), 40, { rasterize, ocr });

    expect(result.pagesProcessed).toBe(25);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("OCR truncated to the first 25 of 40 pages");
    expect(rasterize).toHaveBeenCalledWith(expect.any(Buffer), 25);
  });

  it("throws a typed OcrError (never silent empty) when OCR fails", async () => {
    const rasterize = vi.fn<OcrDeps["rasterize"]>(async () => [
      Buffer.from("page"),
    ]);
    const ocr = vi.fn<OcrDeps["ocr"]>(async () => {
      throw new Error("tesseract exploded");
    });

    await expect(
      ocrPdf(Buffer.from("x"), 1, { rasterize, ocr }),
    ).rejects.toBeInstanceOf(OcrError);
  });

  it("throws a typed OcrError when rasterization fails", async () => {
    const rasterize = vi.fn<OcrDeps["rasterize"]>(async () => {
      throw new Error("cannot rasterize");
    });
    const ocr = vi.fn<OcrDeps["ocr"]>(async () => "unused");

    await expect(
      ocrPdf(Buffer.from("x"), 1, { rasterize, ocr }),
    ).rejects.toBeInstanceOf(OcrError);
  });
});
