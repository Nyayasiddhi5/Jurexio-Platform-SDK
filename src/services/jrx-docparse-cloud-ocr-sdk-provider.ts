/**
 * NV-DOCPARSE-CLOUD-OCR-SDK-001 — cloud OCR hook for @jurexio/docparse-sdk (Textract → GOT chain).
 */
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { createLogger } from '../utils/logger.js';
import type { CloudOcrPageRequest, CloudOcrPageResult, CloudOcrProvider } from '@jurexio/docparse-sdk';
import { isTextractOcrAvailable, textractOcrPageBytes } from './document-pipeline/jrx-textract-ocr-service.js';

const logger = createLogger('./jrx-docparse-cloud-ocr-sdk');

async function gotOcrPage(req: CloudOcrPageRequest): Promise<CloudOcrPageResult | null> {
  const { nvOcrAdapterService } = await import('./document-pipeline/jrx-got-ocr-adapter-service.js');
  const mime = req.mime ?? 'image/png';
  const ocr = await nvOcrAdapterService.ocrDocument(Buffer.from(req.bytes), mime, {
    language: 'en',
    jurisdiction: 'IN',
  });
  const text = String(ocr?.text || '').trim();
  if (!text) return null;
  return {
    text,
    provider: String(ocr?.provider || 'jrx-got-ocr'),
    meanConf: typeof ocr?.confidence === 'number' ? ocr.confidence : 0.72,
  };
}

function textractPageEscalationEnabled(): boolean {
  return isJrxFeatureOn('textractOcr') || isJrxFeatureOn('docparseTextractPage');
}

export function createJrxCloudOcrProvider(): CloudOcrProvider | undefined {
  if (!isJrxFeatureOn('docparse') && !isJrxFeatureOn('docparseSdk')) return undefined;
  return {
    id: 'jrx-cloud-ocr-chain',
    async available(): Promise<boolean> {
      if (!isJrxFeatureOn('docparse') && !isJrxFeatureOn('docparseSdk')) return false;
      return true;
    },
    async recognizePage(req: CloudOcrPageRequest): Promise<CloudOcrPageResult | null> {
      try {
        if (textractPageEscalationEnabled() && (await isTextractOcrAvailable())) {
          const tx = await textractOcrPageBytes(Buffer.from(req.bytes));
          if (tx?.text?.trim()) {
            return {
              text: tx.text,
              provider: tx.provider,
              meanConf: tx.meanConf,
            };
          }
        }
        return await gotOcrPage(req);
      } catch (e) {
        logger.warn('cloud ocr page failed', {
          pageNo: req.pageNo,
          err: e instanceof Error ? e.message : String(e),
        });
        return null;
      }
    },
  };
}
