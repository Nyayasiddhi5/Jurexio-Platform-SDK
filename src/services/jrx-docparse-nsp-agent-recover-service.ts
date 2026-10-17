/**
 * NV-DOCPARSE-NSP-AGENT-RECOVER-001 — JRX gap recovery for NSP local parse failures only.
 * Full doc re-OCR on JRX (Textract + partial LLM); optional extractive summary — not full /analyze by default.
 */
import type { ExtractionResult } from '@jurexio/docparse-sdk';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-docparse-nsp-agent-recover');

export interface NspLocalParseHints {
  unparsedPageNos?: number[];
  humanReviewPageNos?: number[];
  lowConfidenceFieldPaths?: string[];
  qualityBand?: 'high' | 'medium' | 'low';
  /** Optional local engine version for audit. */
  localEngineVersion?: string;
}

export interface NspAgentRecoverOptions {
  partialLlm?: boolean;
  /** Extractive summary from deterministic analysis (no extra LLM). */
  extractiveSummary?: boolean;
  /** When true, partial LLM snippets limited to humanReviewPageNos from hints. */
  humanReviewPagesOnly?: boolean;
}

export interface NspAgentRecoverRequest {
  bytes: Buffer;
  fileName: string;
  mimeType?: string;
  domainPackId?: string;
  jurisdiction?: string;
  localParse?: NspLocalParseHints;
  options?: NspAgentRecoverOptions;
  actor?: string;
}

export interface NspAgentRecoverResponse {
  mode: 'nsp-agent-recover';
  domainPackId: string;
  extraction: ExtractionResult;
  caseCreate: ReturnType<
    typeof import('@jurexio/docparse-sdk').mapExtractionToNspCaseCreate
  >;
  companyProfile: ReturnType<
    typeof import('@jurexio/docparse-sdk').mapExtractionToNspCompanyProfile
  > | null;
  userProfile: ReturnType<
    typeof import('@jurexio/docparse-sdk').mapExtractionToNspUserOnboarding
  > | null;
  evidence: ReturnType<
    typeof import('@jurexio/docparse-sdk').mapExtractionToNspEvidence
  > | null;
  legalParseGuide: unknown;
  docparseIntelligence: unknown;
  partialRecoveryApplied: boolean;
  extractiveSummary?: string[];
  unparsedPagesAfterRecover: number[];
}

function pagesWithNoText(result: ExtractionResult): number[] {
  const out: number[] = [];
  for (const doc of result.documents) {
    for (const p of doc.pages) {
      const text = p.lines.map((l) => l.text).join('').trim();
      if (!text) out.push(p.pageNo);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export async function runNspDocparseAgentRecover(
  req: NspAgentRecoverRequest,
): Promise<NspAgentRecoverResponse> {
  const {
    runComplete,
    buildDocparseResultBundle,
    mapExtractionToNspCaseCreate,
    mapExtractionToNspCompanyProfile,
    mapExtractionToNspUserOnboarding,
    mapExtractionToNspEvidence,
    buildExtractiveLegalIntelligence,
  } = await import('@jurexio/docparse-sdk');
  const { createJrxPartialFieldRecoveryProvider } = await import('./jrx-docparse-partial-llm-sdk-provider.js');
  const { createJrxCloudOcrProvider } = await import('./jrx-docparse-cloud-ocr-sdk-provider.js');

  const domainPackId = req.domainPackId ?? 'legal-in-civil';
  const batchId = `nsp_recover_${Date.now()}`;
  const opts = req.options ?? {};
  const partialLlm = opts.partialLlm !== false;
  const humanReviewOnly = opts.humanReviewPagesOnly !== false;

  const prevHumanReviewFlag = process.env.JRX_DOCPARSE_PARTIAL_LLM_HUMAN_REVIEW_ONLY;
  if (humanReviewOnly && (req.localParse?.humanReviewPageNos?.length ?? 0) > 0) {
    process.env.JRX_DOCPARSE_PARTIAL_LLM_HUMAN_REVIEW_ONLY = '1';
  }

  try {
    const completed = await runComplete(
      [{
        bytes: new Uint8Array(req.bytes),
        fileName: req.fileName,
        mime: req.mimeType,
      }],
      {
        batchId,
        actor: req.actor ?? 'nyv:nsp-agent-recover',
        domainPackId,
        forceOcr: true,
        preferOcr: true,
        partialFieldRecovery: partialLlm ? createJrxPartialFieldRecoveryProvider() : undefined,
        cloudOcr: createJrxCloudOcrProvider(),
      },
    );

    const extraction = completed.extraction;
    const bundle = buildDocparseResultBundle(extraction, {
      domainPackId,
      engineVersion: 'nsp-agent-recover',
    });

    let extractiveSummary: string[] | undefined;
    if (opts.extractiveSummary !== false) {
      const intel = buildExtractiveLegalIntelligence(extraction);
      extractiveSummary = intel?.summarySentences?.slice(0, 8).map((s) => s.text) ?? [];
    }

    const stillEmpty = pagesWithNoText(extraction);
    logger.info('nsp agent recover done', {
      fileName: req.fileName,
      domainPackId,
      partialRecoveryApplied: completed.partialRecoveryApplied,
      unparsedAfter: stillEmpty.length,
    });

    return {
      mode: 'nsp-agent-recover',
      domainPackId,
      extraction,
      caseCreate: mapExtractionToNspCaseCreate(extraction),
      companyProfile: mapExtractionToNspCompanyProfile(extraction),
      userProfile: mapExtractionToNspUserOnboarding(extraction),
      evidence: mapExtractionToNspEvidence(extraction, { mime: req.mimeType }),
      legalParseGuide: bundle.legalParseGuide,
      docparseIntelligence: bundle.intelligence,
      partialRecoveryApplied: completed.partialRecoveryApplied,
      extractiveSummary,
      unparsedPagesAfterRecover: stillEmpty,
    };
  } finally {
    if (prevHumanReviewFlag === undefined) {
      delete process.env.JRX_DOCPARSE_PARTIAL_LLM_HUMAN_REVIEW_ONLY;
    } else {
      process.env.JRX_DOCPARSE_PARTIAL_LLM_HUMAN_REVIEW_ONLY = prevHumanReviewFlag;
    }
  }
}

/** True when NSP should call JRX agent-recover (not full re-upload path). */
export function nspLocalParseNeedsAgentRecover(
  extraction: ExtractionResult,
  hints?: NspLocalParseHints,
): boolean {
  const empty = pagesWithNoText(extraction);
  if (empty.length > 0) return true;
  if (hints?.unparsedPageNos?.length) return true;
  if (hints?.humanReviewPageNos?.length) return true;
  const hr = extraction.governance.humanReviewRequired.length;
  if (hr > 0) return true;
  const lowConf = extraction.resolutions.filter((r) => r.status === 'LOW_CONFIDENCE' || r.status === 'ABSENT').length;
  const resolved = extraction.resolutions.filter((r) => r.status === 'RESOLVED').length;
  if (resolved === 0 && lowConf > 0) return true;
  return false;
}
