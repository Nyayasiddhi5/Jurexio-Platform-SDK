/**
 * @vitest-environment jsdom
 *
 * Render smoke for ROMA L5 Admin Dashboard — one of 4 previously
 * zero-coverage pages flagged in the 2026-05-08 audit.
 */
import './setup-jsdom';
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from './test-utils';
import RomaL5AdminDashboard from '../../client/src/pages/roma-l5-admin';

describe('RomaL5AdminDashboard', () => {
  it('renders without throwing and shows recognisable header text', async () => {
    renderWithProviders(<RomaL5AdminDashboard />);
    // Heuristic: page title or any "Agent" label should appear.
    const hits = await screen.findAllByText(/agent|roma|grpo/i, {}, { timeout: 5000 });
    expect(hits.length).toBeGreaterThan(0);
  });
});
