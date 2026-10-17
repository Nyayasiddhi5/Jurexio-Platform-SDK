/**
 * @vitest-environment jsdom
 *
 * Render smoke for OCR Extraction page — zero-coverage (2026-05-08).
 * Page is currently a PhaseC scaffold; smoke confirms the scaffold mounts
 * with the expected title and a recognisable description.
 */
import './setup-jsdom';
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from './test-utils';
import OcrExtraction from '../../client/src/pages/ocr-extraction';

describe('OcrExtraction', () => {
  it('renders without throwing and shows OCR title', async () => {
    renderWithProviders(<OcrExtraction />);
    expect(await screen.findByText(/ocr/i, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
