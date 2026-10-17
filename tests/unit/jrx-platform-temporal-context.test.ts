import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildCompactPlatformTemporalContextBlock,
  buildPlatformTemporalContextBlock,
  getPlatformReferenceYear,
  queryNeedsLiveWebData,
} from '../../src/utils/jrx-platform-temporal-context.js';

describe('./jrx-platform-temporal-context', () => {
  const prev = process.env.NYV_REFERENCE_DATE;

  beforeEach(() => {
    process.env.NYV_REFERENCE_DATE = '2026-08-20T12:00:00+05:30';
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.NYV_REFERENCE_DATE;
    else process.env.NYV_REFERENCE_DATE = prev;
  });

  it('injects authoritative 2026 reference date', () => {
    const block = buildPlatformTemporalContextBlock();
    expect(block).toMatch(/PLATFORM REFERENCE DATE/);
    expect(block).toMatch(/2026/);
    expect(block).toMatch(/Do NOT treat 2026 as a future year/);
    expect(getPlatformReferenceYear()).toBe(2026);
  });

  it('compact temporal block keeps year/YTD rules for micro_faq overlay budget', () => {
    const block = buildCompactPlatformTemporalContextBlock();
    expect(block).toMatch(/REF DATE: 2026-08-20/);
    expect(block).toMatch(/2026 is current/);
    expect(block).toMatch(/never invent figures/i);
    expect(block.length).toBeLessThan(buildPlatformTemporalContextBlock().length);
  });

  it('detects current-year factual queries for live web search', () => {
    expect(
      queryNeedsLiveWebData(
        'tell me the number of murders which happened in Telangana in the year 2026',
      ),
    ).toBe(true);
    expect(
      queryNeedsLiveWebData(
        'give me a list of all money laundering cases with less than 100 crores in 2026 till date',
      ),
    ).toBe(true);
    expect(queryNeedsLiveWebData('what is anticipatory bail under BNSS 482')).toBe(false);
    expect(queryNeedsLiveWebData('latest Supreme Court judgment on bail')).toBe(true);
    expect(queryNeedsLiveWebData('legal news on DPDP amendment today')).toBe(true);
  });
});
