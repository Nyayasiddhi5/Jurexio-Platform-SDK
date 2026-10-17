import { describe, expect, it } from 'vitest';
import { resolveNysPlaneHealth } from '../../src/utils/jrx-nys-plane-health.js';

describe('resolveNysPlaneHealth', () => {
  it('is not_configured when the flag is off', () => {
    expect(resolveNysPlaneHealth({ flagOn: false, configured: true, probeOk: true }).status)
      .toBe('not_configured');
  });

  it('is healthy when NYS healthz is reachable even if embed SLO is critical', () => {
    const r = resolveNysPlaneHealth({
      flagOn: true,
      configured: true,
      probeOk: true,
      embeddingSloStatus: 'critical',
    });
    expect(r.status).toBe('healthy');
    expect(r.details).toMatch(/backfill/);
  });

  it('is degraded only when the plane probe fails', () => {
    expect(resolveNysPlaneHealth({
      flagOn: true,
      configured: true,
      probeOk: false,
      probeError: 'NYS HTTP 503',
    }).status).toBe('degraded');
  });
});
