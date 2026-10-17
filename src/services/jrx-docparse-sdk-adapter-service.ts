/**
 * NV-DOCPARSE-SDK-ADAPTER-001 — @jurexio/docparse-sdk engine for NYV ingest (dev flag).
 * Production default remains @jurexio/docparse until golden parity + cutover GO.
 */
import type { ExtractionResult } from '@jurexio/docparse-sdk';
import type { DocparseAdapterInput } from './jrx-docparse-adapter-service.js';

type LegalParseGuide = ReturnType<
  typeof import('@jurexio/docparse-sdk').buildLegalParseGuide
>;

export type DocparseSdkEngineExtras = {
  legalParseGuide?: LegalParseGuide;
  engine: 'docparse-sdk';
  domainPackId: string;
};

export type DocparseSdkRunOpts = {
  domainPackId?: string;
  forceOcr?: boolean;
  preferOcr?: boolean;
  maxPagesPerDoc?: number;
};

export async function runDocparseSdkEngine(
  files: Array<{ bytes: Buffer; fileName: string; mimeType?: string }>,
  batchId: string,
  actor: string,
  onProgress?: DocparseAdapterInput['onProgress'],
  domainPackId = 'legal-in-civil',
  runOpts: DocparseSdkRunOpts = {},
): Promise<ExtractionResult> {
  const { runComplete } = await import('@jurexio/docparse-sdk');
  const { createNyvPartialFieldRecoveryProvider } = await import('./jrx-docparse-partial-llm-sdk-provider.js');
  const { createNyvCloudOcrProvider } = await import('./jrx-docparse-cloud-ocr-sdk-provider.js');
  const inputFiles = files.map((f) => ({
    bytes: new Uint8Array(f.bytes),
    fileName: f.fileName,
    mime: f.mimeType,
  }));
  const pack = runOpts.domainPackId ?? domainPackId;
  const partialFieldRecovery = createNyvPartialFieldRecoveryProvider();
  const cloudOcr = createNyvCloudOcrProvider();
  const completed = await runComplete(inputFiles, {
    batchId,
    actor,
    domainPackId: pack,
    forceOcr: runOpts.forceOcr,
    preferOcr: runOpts.preferOcr ?? true,
    maxPagesPerDoc: runOpts.maxPagesPerDoc,
    partialFieldRecovery,
    cloudOcr,
    onPage: onProgress
      ? (detail) => {
          onProgress('docparse_page', {
            documentId: detail.documentId,
            pageNo: detail.pageNo,
            pageTotal: detail.pageTotal,
            route: detail.route,
            engine: 'docparse-sdk',
          });
        }
      : undefined,
  });
  return completed.extraction;
}

export async function buildSdkLegalParseGuide(
  result: ExtractionResult,
  domainPackId = 'legal-in',
): Promise<LegalParseGuide> {
  const bundle = await buildSdkResultBundle(result, domainPackId);
  return bundle.legalParseGuide;
}

export async function buildSdkResultBundle(
  result: ExtractionResult,
  domainPackId = 'legal-in',
) {
  const { buildDocparseResultBundle, DOCPARSE_SDK_VERSION } = await import('@jurexio/docparse-sdk');
  return buildDocparseResultBundle(result, {
    domainPackId,
    engineVersion: DOCPARSE_SDK_VERSION,
  });
}
