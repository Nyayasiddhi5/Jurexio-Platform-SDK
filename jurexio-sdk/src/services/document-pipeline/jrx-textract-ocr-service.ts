/**
 * NV-TEXTRACT-OCR-001 — Amazon Textract page OCR (structured backup before vision LLM).
 * Region default ap-south-1; gated by JRX_F_TEXTRACT.
 */
import { createLogger } from '../../utils/logger.js';
import { isJrxFeatureOn } from '../../config/jrx-feature-flags.js';

const logger = createLogger('./jrx-textract-ocr');

export interface TextractPageOcrResult {
  text: string;
  meanConf: number;
  provider: 'aws-textract';
  blockCount: number;
}

type TextractBlock = {
  BlockType?: string;
  Text?: string;
  Confidence?: number;
};

export function blocksToPlainText(blocks: TextractBlock[]): { text: string; meanConf: number } {
  const lines = blocks.filter((b) => b.BlockType === 'LINE' && b.Text);
  if (lines.length === 0) {
    const words = blocks.filter((b) => b.BlockType === 'WORD' && b.Text);
    const text = words.map((w) => w.Text).join(' ').trim();
    const confs = words.map((w) => (typeof w.Confidence === 'number' ? w.Confidence / 100 : 0));
    const meanConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
    return { text, meanConf };
  }
  const text = lines.map((l) => l.Text).join('\n').trim();
  const confs = lines.map((l) => (typeof l.Confidence === 'number' ? l.Confidence / 100 : 0));
  const meanConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { text, meanConf };
}

export function isTextractOcrEnabled(): boolean {
  return isJrxFeatureOn('textractOcr');
}

export function textractRegion(): string {
  return (
    process.env.JRX_TEXTRACT_REGION?.trim()
    || process.env.AWS_REGION?.trim()
    || 'ap-south-1'
  );
}

/** Cheap availability probe — flag on; SDK loads at call time on EC2 IAM role. */
export async function isTextractOcrAvailable(): Promise<boolean> {
  if (!isTextractOcrEnabled()) return false;
  return true;
}

export async function textractOcrPageBytes(bytes: Buffer): Promise<TextractPageOcrResult | null> {
  if (!isTextractOcrEnabled()) return null;
  try {
    const { TextractClient, AnalyzeDocumentCommand } = await import('@aws-sdk/client-textract');
    const client = new TextractClient({ region: textractRegion() });
    const out = await client.send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: bytes },
        FeatureTypes: ['TABLES', 'FORMS', 'LAYOUT'],
      }),
    );
    const blocks = (out.Blocks ?? []) as TextractBlock[];
    const { text, meanConf } = blocksToPlainText(blocks);
    if (!text) {
      logger.warn('textract empty text', { blockCount: blocks.length });
      return null;
    }
    return {
      text,
      meanConf,
      provider: 'aws-textract',
      blockCount: blocks.length,
    };
  } catch (e) {
    logger.warn('textract analyze failed', {
      err: e instanceof Error ? e.message : String(e),
      region: textractRegion(),
    });
    return null;
  }
}
