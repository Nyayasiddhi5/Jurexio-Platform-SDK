/**
 * Secure Random Utility Tests — Math.random() ban enforcement
 */
import { describe, it, expect } from 'vitest';
import { secureRandom, secureRandomInt, secureRandomBetween, secureRandomElement, secureRandomHex, secureRandomBase64 } from '../src/utils/jrx-secure-random.js';

describe('secureRandom() — crypto-backed, Math.random() banned', () => {
  it('returns a float between 0 and 1', () => {
    const vals = Array.from({ length: 100 }, () => secureRandom());
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces different values (not constant)', () => {
    const vals = new Set(Array.from({ length: 50 }, () => secureRandom()));
    expect(vals.size).toBeGreaterThan(1);
  });

  it('secureRandomInt returns integers in range', () => {
    for (let i = 0; i < 100; i++) {
      const n = secureRandomInt(1, 10);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(10);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('secureRandomBetween returns floats in range', () => {
    for (let i = 0; i < 100; i++) {
      const n = secureRandomBetween(5.5, 10.5);
      expect(n).toBeGreaterThanOrEqual(5.5);
      expect(n).toBeLessThanOrEqual(10.5);
    }
  });

  it('secureRandomElement picks from array', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 50; i++) {
      const picked = secureRandomElement(arr);
      expect(arr).toContain(picked);
    }
  });

  it('secureRandomHex returns hex string of correct length', () => {
    const hex = secureRandomHex(16);
    expect(hex).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
  });

  it('secureRandomBase64 returns base64 string', () => {
    const b64 = secureRandomBase64(16);
    expect(b64.length).toBeGreaterThan(0);
    expect(/^[A-Za-z0-9+/=]+$/.test(b64)).toBe(true);
  });

  it('secureRandomInt(n, n) returns exactly n', () => {
    expect(secureRandomInt(42, 42)).toBe(42);
  });
});
