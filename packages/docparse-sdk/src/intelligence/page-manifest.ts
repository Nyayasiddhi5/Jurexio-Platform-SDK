/**
 * NV-DOCPARSE-PAGE-MANIFEST-001 — per-page manifest inside docparseIntelligence v1.
 */
import type { ExtractionResult, PageRoute } from "../types.js";

export const DOCPARSE_PAGE_MANIFEST_V1 = "docparse.pageManifest/v1" as const;

export interface PageManifestEntryV1 {
  documentId: string;
  pageNo: number;
  route: PageRoute;
  meanConf: number;
  garbleRate: number;
  handwrittenSuspected: boolean;
  tableCount: number;
  lineCount: number;
  humanReview: boolean;
}

export function buildPageManifestV1(result: ExtractionResult): PageManifestEntryV1[] {
  const reviewKeys = new Set(
    (result.governance.humanReviewRequired ?? []).map(
      (r) => `${r.documentId}:${r.pageNo}`,
    ),
  );
  const out: PageManifestEntryV1[] = [];
  for (const doc of result.documents) {
    for (const page of doc.pages) {
      out.push({
        documentId: doc.documentId,
        pageNo: page.pageNo,
        route: page.route,
        meanConf: page.quality.meanConf,
        garbleRate: page.quality.garbleRate,
        handwrittenSuspected: page.quality.handwrittenSuspected,
        tableCount: page.tables?.length ?? 0,
        lineCount: page.lines?.length ?? 0,
        humanReview: reviewKeys.has(`${doc.documentId}:${page.pageNo}`),
      });
    }
  }
  return out;
}
