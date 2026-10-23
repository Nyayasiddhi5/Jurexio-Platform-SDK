import { describe, it, expect } from 'vitest';
import { shouldAttemptCloudOcr } from '../src/ocr/cloud-ocr-gate.js';
import type { RoutedOcrResult } from '../src/ocr/router.js';

const emptyLocal: RoutedOcrResult = {
  words: [],
  meanConf: 0,
  passes: [],
  arbitration: [],
  numericConflicts: [],
  ms: 1,
  notes: [],
  humanReviewRequired: false,
};

const goodLocal: RoutedOcrResult = {
  words: [{ text: 'CNR', bbox: { x: 0, y: 0, w: 1, h: 1 }, conf: 0.9, script: 'Latn', source: 'OCR', engine: 'tesseract' }],
  meanConf: 0.9,
  passes: [],
  arbitration: [],
  numericConflicts: [],
  ms: 1,
  notes: [],
  humanReviewRequired: false,
};

const cloud = { id: 'x', available: async () => true, recognizePage: async () => null };

describe('cloud OCR page gate', () => {
  it('does not escalate when local OCR is confident and dense', () => {
    expect(shouldAttemptCloudOcr(undefined, goodLocal)).toBe(false);
    expect(shouldAttemptCloudOcr(cloud, goodLocal)).toBe(false);
  });

  it('escalates when local OCR empty or low confidence', () => {
    expect(shouldAttemptCloudOcr(cloud, emptyLocal)).toBe(true);
    expect(shouldAttemptCloudOcr(cloud, { ...goodLocal, meanConf: 0.1, humanReviewRequired: true })).toBe(true);
  });

  it('escalates sparse scan text despite high meanConf', () => {
    const sparse: RoutedOcrResult = {
      ...goodLocal,
      words: [{ text: 'mee seva registration government', bbox: { x: 0, y: 0, w: 1, h: 1 }, conf: 0.85, script: 'Latn', source: 'OCR', engine: 'tesseract' }],
      meanConf: 0.85,
    };
    expect(shouldAttemptCloudOcr(cloud, sparse, { glyphCount: 80, garbleRate: 0.05, scannedPage: true, imageCoverage: 0.9 })).toBe(true);
  });

  it('escalates on high garble', () => {
    expect(shouldAttemptCloudOcr(cloud, goodLocal, { garbleRate: 0.3, glyphCount: 200 })).toBe(true);
  });
});
