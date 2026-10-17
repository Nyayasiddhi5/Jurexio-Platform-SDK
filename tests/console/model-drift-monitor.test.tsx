/**
 * @vitest-environment jsdom
 *
 * Render smoke for Model Drift Monitor — zero-coverage page (2026-05-08).
 */
import './setup-jsdom';
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from './test-utils';
import ModelDriftMonitor from '../../client/src/pages/model-drift-monitor';

describe('ModelDriftMonitor', () => {
  it('renders without throwing', async () => {
    renderWithProviders(<ModelDriftMonitor />);
    const hits = await screen.findAllByText(/drift|model|baseline|metric/i, {}, { timeout: 5000 });
    expect(hits.length).toBeGreaterThan(0);
  });
});
