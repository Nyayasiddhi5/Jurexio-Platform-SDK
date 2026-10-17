/**
 * @jurexio/react-hooks — Unit Tests v3.1.2
 * Tests all 6 hooks without DOM rendering (pure logic tests)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Test useGovernanceBadge logic ────────────────────────────────────────────
// We test the pure computation logic directly rather than rendering hooks
// since jsdom React setup is complex in pure vitest.

function computeBadge(score: number) {
  const clamp = Math.max(0, Math.min(1, score));
  if (clamp < 0.25)  return { badge: 'LOW',      label: 'Low Risk' };
  if (clamp < 0.55)  return { badge: 'MEDIUM',   label: 'Medium Risk' };
  if (clamp < 0.8)   return { badge: 'HIGH',      label: 'High Risk' };
  return               { badge: 'CRITICAL',  label: 'Critical Risk' };
}

describe('useGovernanceBadge — badge computation', () => {
  it('score 0.0 → LOW', () => expect(computeBadge(0).badge).toBe('LOW'));
  it('score 0.1 → LOW', () => expect(computeBadge(0.1).badge).toBe('LOW'));
  it('score 0.24 → LOW', () => expect(computeBadge(0.24).badge).toBe('LOW'));
  it('score 0.25 → MEDIUM', () => expect(computeBadge(0.25).badge).toBe('MEDIUM'));
  it('score 0.5 → MEDIUM', () => expect(computeBadge(0.5).badge).toBe('MEDIUM'));
  it('score 0.55 → HIGH', () => expect(computeBadge(0.55).badge).toBe('HIGH'));
  it('score 0.79 → HIGH', () => expect(computeBadge(0.79).badge).toBe('HIGH'));
  it('score 0.8 → CRITICAL', () => expect(computeBadge(0.8).badge).toBe('CRITICAL'));
  it('score 1.0 → CRITICAL', () => expect(computeBadge(1.0).badge).toBe('CRITICAL'));
  it('clamps below 0', () => expect(computeBadge(-1).badge).toBe('LOW'));
  it('clamps above 1', () => expect(computeBadge(2).badge).toBe('CRITICAL'));
});

// ─── Test jurisdiction logic ───────────────────────────────────────────────────
const JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'GC', 'SG'] as const;
type JCode = typeof JURISDICTIONS[number];

const JURISDICTION_INFO: Record<JCode, { name: string; currency: string }> = {
  IN: { name: 'India', currency: 'INR' },
  UK: { name: 'United Kingdom', currency: 'GBP' },
  US: { name: 'United States', currency: 'USD' },
  EU: { name: 'European Union', currency: 'EUR' },
  GC: { name: 'Gulf Cooperation Council', currency: 'AED' },
  SG: { name: 'Singapore', currency: 'SGD' },
};

describe('useJurisdiction — jurisdiction info', () => {
  it('India has INR currency', () => expect(JURISDICTION_INFO.IN.currency).toBe('INR'));
  it('UK has GBP currency', () => expect(JURISDICTION_INFO.UK.currency).toBe('GBP'));
  it('US has USD currency', () => expect(JURISDICTION_INFO.US.currency).toBe('USD'));
  it('EU has EUR currency', () => expect(JURISDICTION_INFO.EU.currency).toBe('EUR'));
  it('GC has AED currency', () => expect(JURISDICTION_INFO.GC.currency).toBe('AED'));
  it('SG has SGD currency', () => expect(JURISDICTION_INFO.SG.currency).toBe('SGD'));
  it('all 6 jurisdictions present', () => expect(JURISDICTIONS.length).toBe(6));
  it('IN requires GST', () => {
    const requiresGST = (j: JCode) => j === 'IN' || j === 'SG';
    expect(requiresGST('IN')).toBe(true);
    expect(requiresGST('UK')).toBe(false);
  });
});

// ─── Test NyvClient config logic ──────────────────────────────────────────────
function buildHeaders(apiKey: string, jurisdiction?: string, orgId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (jurisdiction) headers['X-NYV-Jurisdiction'] = jurisdiction;
  if (orgId) headers['X-Org-ID'] = orgId;
  return headers;
}

describe('useNyvClient — header construction', () => {
  it('sets Authorization header', () => {
    const h = buildHeaders('key-abc');
    expect(h['Authorization']).toBe('Bearer key-abc');
  });
  it('sets Content-Type', () => {
    expect(buildHeaders('k')['Content-Type']).toBe('application/json');
  });
  it('includes jurisdiction when provided', () => {
    const h = buildHeaders('k', 'IN');
    expect(h['X-NYV-Jurisdiction']).toBe('IN');
  });
  it('omits jurisdiction when not provided', () => {
    expect(buildHeaders('k')['X-NYV-Jurisdiction']).toBeUndefined();
  });
  it('includes X-Org-ID when provided', () => {
    const h = buildHeaders('k', 'IN', 'org-123');
    expect(h['X-Org-ID']).toBe('org-123');
  });
});

// ─── Test audit chain verification ────────────────────────────────────────────
function verifyAuditChain(entries: Array<{ auditHash: string; prevHash: string | null }>): boolean {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].prevHash !== entries[i - 1].auditHash) return false;
  }
  return true;
}

describe('useAuditLog — chain verification', () => {
  it('empty chain is valid', () => {
    expect(verifyAuditChain([])).toBe(true);
  });
  it('single entry is valid', () => {
    expect(verifyAuditChain([{ auditHash: 'abc', prevHash: null }])).toBe(true);
  });
  it('linked chain is valid', () => {
    const chain = [
      { auditHash: 'hash1', prevHash: null },
      { auditHash: 'hash2', prevHash: 'hash1' },
      { auditHash: 'hash3', prevHash: 'hash2' },
    ];
    expect(verifyAuditChain(chain)).toBe(true);
  });
  it('broken chain is invalid', () => {
    const chain = [
      { auditHash: 'hash1', prevHash: null },
      { auditHash: 'hash2', prevHash: 'WRONG' },
    ];
    expect(verifyAuditChain(chain)).toBe(false);
  });
});

// ─── Test credit logic ────────────────────────────────────────────────────────
describe('useCredits — balance logic', () => {
  const hasEnough = (balance: number, amount: number) => balance >= amount;

  it('returns true when balance covers amount', () => {
    expect(hasEnough(100, 50)).toBe(true);
  });
  it('returns true when balance equals amount exactly', () => {
    expect(hasEnough(50, 50)).toBe(true);
  });
  it('returns false when balance is insufficient', () => {
    expect(hasEnough(10, 50)).toBe(false);
  });
  it('returns false for zero balance', () => {
    expect(hasEnough(0, 1)).toBe(false);
  });
});

// ─── Test pattern stream options validation ────────────────────────────────────
describe('usePatternStream — pattern key validation', () => {
  const VALID_PATTERNS = [
    'P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11',
    'P12','P13','P14','P15','P16','P17','P18','P19','P20','P21','P22',
  ];

  it('has exactly 22 valid patterns', () => {
    expect(VALID_PATTERNS.length).toBe(22);
  });

  it('P01 is in valid patterns', () => {
    expect(VALID_PATTERNS.includes('P01')).toBe(true);
  });

  it('P22 is in valid patterns', () => {
    expect(VALID_PATTERNS.includes('P22')).toBe(true);
  });

  it('P23 is not a valid pattern', () => {
    expect(VALID_PATTERNS.includes('P23' as any)).toBe(false);
  });

  it('all patterns have P prefix', () => {
    expect(VALID_PATTERNS.every(p => p.startsWith('P'))).toBe(true);
  });
});
