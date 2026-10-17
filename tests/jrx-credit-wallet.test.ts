/**
 * Credit Wallet & Subscription Tests — Jurexio Enterprise Platform 3.1.2
 */
import { describe, it, expect } from 'vitest';

describe('Credit Wallet API (unauthenticated returns 401)', () => {
  const BASE = 'http://localhost:5000';

  it('wallet endpoint requires auth', async () => {
    const r = await fetch(`${BASE}/api/jrx/credits/wallet`);
    expect([401, 403]).toContain(r.status);
  });

  it('subscription endpoint requires auth', async () => {
    const r = await fetch(`${BASE}/api/jrx/subscription/me`);
    expect([401, 403]).toContain(r.status);
  });

  it('credits costs endpoint requires auth', async () => {
    const r = await fetch(`${BASE}/api/jrx/credits/costs`);
    expect([401, 403]).toContain(r.status);
  });
});

describe('Consent Purposes (public endpoint)', () => {
  const BASE = 'http://localhost:5000';

  it('lists all DPDPA 2023 consent purposes', async () => {
    const r = await fetch(`${BASE}/api/jrx/consent/purposes`);
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.purposes).toContainEqual(expect.objectContaining({ purpose: 'ai_processing', required: true }));
    expect(b.purposes).toContainEqual(expect.objectContaining({ purpose: 'legal_research', required: true }));
    expect(b.consentVersion).toContain('dpdpa-2023');
  });
});

describe('Compliance Health Check', () => {
  const BASE = 'http://localhost:5000';

  it('compliance health requires auth', async () => {
    const r = await fetch(`${BASE}/api/jrx/compliance/health`);
    expect([401, 403]).toContain(r.status);
  });
});
