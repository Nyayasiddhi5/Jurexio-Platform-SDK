import { describe, it, expect } from 'vitest';
import {
  resolveCaselawSearchMode,
  resolveCaselawYearFrom,
  resolveCaselawCourtType,
} from '../../src/services/jrx-nys-knowledge-retriever.js';

describe('./jrx-nys-caselaw-search-mode', () => {
  it('uses FTS for bare numeric section queries', () => {
    expect(resolveCaselawSearchMode('IPC 302 murder')).toBe('fts');
    expect(resolveCaselawSearchMode('BNS 103')).toBe('fts');
    expect(resolveCaselawSearchMode('anticipatory bail economic offences')).toBe('hybrid');
  });

  it('uses FTS for recent HC queries (embedding gap)', () => {
    expect(resolveCaselawSearchMode('recent Telangana High Court bail orders 2026')).toBe('fts');
    expect(resolveCaselawCourtType('Delhi High Court anticipatory bail')).toBe('hc');
  });

  it('defaults yearFrom to 1950 for leading-authority queries', () => {
    expect(resolveCaselawYearFrom('leading authorities on anticipatory bail', 2026)).toBe(1950);
    expect(resolveCaselawYearFrom('landmark Supreme Court cases', 2026)).toBe(1950);
    expect(resolveCaselawYearFrom('recent bail orders 2026', 2026)).toBe(2023);
    expect(resolveCaselawYearFrom('recent bail orders 2026', 2026)).toBeGreaterThanOrEqual(2020);
  });
});
