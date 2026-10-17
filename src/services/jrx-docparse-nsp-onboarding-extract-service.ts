/**
 * NV-DOCPARSE-NSP-ONBOARDING-EXTRACT-001 — KYC/firm cert parse → NSP autofill JSON.
 * Always OCR + partial LLM on NYV (same stack as agent-recover, opinionated for onboarding).
 */
import type { ExtractionResult } from '@jurexio/docparse-sdk';
import { createLogger } from '../utils/logger.js';

export type NspOnboardingDocumentHint = 'panCard' | 'barCert' | 'firmCert' | 'auto';

const logger = createLogger('./jrx-docparse-nsp-onboarding-extract');

export interface NspOnboardingExtractRequest {
  bytes: Buffer;
  fileName: string;
  mimeType?: string;
  jurisdiction?: string;
  ingestRole?: string;
  documentHint?: NspOnboardingDocumentHint | string;
  actor?: string;
}

export interface NspOnboardingExtractResponse {
  mode: 'nsp-onboarding-extract';
  domainPackId: string;
  documentHint: string;
  extraction: ExtractionResult;
  onboardingForm: Record<string, unknown>;
  userProfile: Record<string, unknown> | null;
  companyProfile: Record<string, unknown> | null;
  caseCreate: Record<string, unknown>;
  legalParseGuide: unknown;
  docparseIntelligence: unknown;
  partialRecoveryApplied: boolean;
  unparsedPagesAfter: number[];
}

function pagesWithNoText(result: ExtractionResult): number[] {
  const out: number[] = [];
  for (const doc of result.documents) {
    for (const p of doc.pages) {
      if (!p.lines.map((l) => l.text).join('').trim()) out.push(p.pageNo);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export async function runNspOnboardingExtract(
  req: NspOnboardingExtractRequest,
): Promise<NspOnboardingExtractResponse> {
  const hint = (req.documentHint ?? 'auto') as string;
  const { resolveOnboardingDomainPack } = await import('@jurexio/docparse-sdk');
  const domainPackId = resolveOnboardingDomainPack(hint, req.ingestRole);
  const batchId = `nsp_onboarding_${Date.now()}`;

  const {
    runComplete,
    buildDocparseResultBundle,
    mapExtractionToNspCaseCreate,
    mapExtractionToNspCompanyProfile,
    mapExtractionToNspUserOnboarding,
    mapExtractionToNspOnboardingForm,
  } = await import('@jurexio/docparse-sdk');
  const { createNyvPartialFieldRecoveryProvider } = await import('./jrx-docparse-partial-llm-sdk-provider.js');
  const { createNyvCloudOcrProvider } = await import('./jrx-docparse-cloud-ocr-sdk-provider.js');

  const completed = await runComplete(
    [{ bytes: new Uint8Array(req.bytes), fileName: req.fileName, mime: req.mimeType }],
    {
      batchId,
      actor: req.actor ?? 'nyv:nsp-onboarding-extract',
      domainPackId,
      forceOcr: true,
      preferOcr: true,
      partialFieldRecovery: createNyvPartialFieldRecoveryProvider(),
      cloudOcr: createNyvCloudOcrProvider(),
    },
  );

  const extraction = completed.extraction;
  const bundle = buildDocparseResultBundle(extraction, {
    domainPackId,
    engineVersion: 'nsp-onboarding-extract',
  });

  const stillEmpty = pagesWithNoText(extraction);
  logger.info('onboarding extract done', {
    fileName: req.fileName,
    domainPackId,
    hint,
    docType: extraction.documents[0]?.classification.code,
    completeness: extraction.autofill.completeness.ratio,
    unparsedAfter: stillEmpty.length,
  });

  return {
    mode: 'nsp-onboarding-extract',
    domainPackId,
    documentHint: hint,
    extraction,
    onboardingForm: mapExtractionToNspOnboardingForm(extraction, { domainPackId, documentHint: hint }),
    userProfile: mapExtractionToNspUserOnboarding(extraction),
    companyProfile: mapExtractionToNspCompanyProfile(extraction),
    caseCreate: mapExtractionToNspCaseCreate(extraction),
    legalParseGuide: bundle.legalParseGuide,
    docparseIntelligence: bundle.intelligence,
    partialRecoveryApplied: completed.partialRecoveryApplied,
    unparsedPagesAfter: stillEmpty,
  };
}
