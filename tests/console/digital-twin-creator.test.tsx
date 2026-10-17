/**
 * @vitest-environment jsdom
 *
 * Render smoke for TwinDesk™ Digital Twin Creator — zero-coverage (2026-05-08).
 */
import './setup-jsdom';
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from './test-utils';
import DigitalTwinCreator from '../../client/src/pages/digital-twin-creator';

describe('DigitalTwinCreator', () => {
  it('renders without throwing', async () => {
    renderWithProviders(<DigitalTwinCreator />);
    const hits = await screen.findAllByText(/twin|persona|simulate|scenario/i, {}, { timeout: 5000 });
    expect(hits.length).toBeGreaterThan(0);
  });
});
