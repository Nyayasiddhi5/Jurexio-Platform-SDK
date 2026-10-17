import { describe, expect, it } from 'vitest';
import { blocksToPlainText } from '../../src/services/document-pipeline/jrx-textract-ocr-service.js';

describe('./jrx-textract-ocr blocksToPlainText', () => {
  it('joins LINE blocks', () => {
    const { text, meanConf } = blocksToPlainText([
      { BlockType: 'LINE', Text: 'CNR NO', Confidence: 90 },
      { BlockType: 'LINE', Text: '1234567890', Confidence: 80 },
    ]);
    expect(text).toBe('CNR NO\n1234567890');
    expect(meanConf).toBeCloseTo(0.85, 2);
  });

  it('falls back to WORD blocks', () => {
    const { text } = blocksToPlainText([
      { BlockType: 'WORD', Text: 'Hello', Confidence: 95 },
      { BlockType: 'WORD', Text: 'World', Confidence: 85 },
    ]);
    expect(text).toBe('Hello World');
  });
});
