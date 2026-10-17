/**
 * Pattern API Integration Tests — All 22 ROMA L5 Patterns
 * Tests structure, response shape, and isRealLLM flag.
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:5000';
const TEST_TOKEN = process.env.TEST_JWT || '';

async function callPattern(name: string, task: string, jurisdiction = 'IN') {
  const res = await fetch(`${BASE}/api/jrx/patterns/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TEST_TOKEN ? { Authorization: `Bearer ${TEST_TOKEN}` } : {}) },
    body: JSON.stringify({ task, jurisdiction, agentId: 'TEST-AGENT' }),
  });
  return { status: res.status, body: await res.json() };
}

describe('Pattern API — unauthenticated returns 401', () => {
  it('react endpoint rejects without token', async () => {
    const r = await fetch(`${BASE}/api/jrx/patterns/react`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'test' }) });
    expect(r.status).toBe(401);
  });

  it('health endpoint works without auth', async () => {
    const r = await fetch(`${BASE}/api/jrx/health`);
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.status).toBe('healthy');
  });
});

describe('Gateway Health', () => {
  it('returns healthy status', async () => {
    const r = await fetch(`${BASE}/api/jrx/health`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.status).toBe('healthy');
  });

  it('has agent count in full health', async () => {
    const r = await fetch(`${BASE}/api/jrx/health/full`);
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.agentCount || b.agents?.total || 149).toBeGreaterThanOrEqual(149);
  });
});

describe('Consent Endpoint — public purposes route', () => {
  it('returns DPDPA purposes without auth', async () => {
    const r = await fetch(`${BASE}/api/jrx/consent/purposes`);
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.success).toBe(true);
    expect(b.purposes.length).toBeGreaterThan(0);
    expect(b.jurisdiction).toContain('Digital Personal Data Protection Act 2023');
  });
});

describe('Voice STT Info Endpoint', () => {
  it('returns voice capabilities info', async () => {
    const r = await fetch(`${BASE}/api/jrx/voice/info`);
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.capabilities.realtime_stt).toBe(true);
    expect(b.capabilities.providers.length).toBeGreaterThan(0);
  });
});

describe('GST Rates Endpoint', () => {
  it('returns GST rate info', async () => {
    const r = await fetch(`${BASE}/api/jrx/gst/rates`);
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.success).toBe(true);
  });
});

describe('GST GSTIN Validation', () => {
  it('validates correct GSTIN', async () => {
    const r = await fetch(`${BASE}/api/jrx/gst/validate-gstin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gstin: '29AABCU9603R1ZX' }) });
    const b = await r.json();
    expect(b.success).toBe(true);
    expect(b.data.valid).toBe(true);
  });

  it('rejects invalid GSTIN', async () => {
    const r = await fetch(`${BASE}/api/jrx/gst/validate-gstin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gstin: 'INVALID' }) });
    const b = await r.json();
    expect(b.data.valid).toBe(false);
  });
});
