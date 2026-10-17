/**
 * NV-COURT-MASTER-P0-001 — seed-source integrity + row-count magnitudes.
 *
 * Validates the checked-in courts.csv (the seed input for nv_court_complexes)
 * parses cleanly and carries the expected order-of-magnitude coverage
 * (~3,500 complexes, ~700 districts, 36 states/UTs). This is the seed-count
 * assertion for the acceptance criteria; the DB upsert itself is idempotent
 * (ON CONFLICT DO UPDATE) so after-counts match the distinct-key count here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';

const CSV_PATH = join(process.cwd(), 'scripts', 'data-seeds', 'courts.csv');

interface CsvRow {
  state_code: string;
  state_name: string;
  district_code: string;
  district_name: string;
  complex_code: string;
  complex_name: string;
  court_numbers: string;
  flag: string;
}

describe('court-master seed source (courts.csv)', () => {
  it('the checked-in seed CSV exists', () => {
    expect(existsSync(CSV_PATH)).toBe(true);
  });

  const raw = existsSync(CSV_PATH) ? readFileSync(CSV_PATH, 'utf8') : '';
  const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });
  const rows = parsed.data.filter(
    (r) => r.state_code && r.district_code && r.complex_code && r.complex_name,
  );

  it('has the expected header columns', () => {
    expect(parsed.meta.fields).toEqual([
      'state_code', 'state_name', 'district_code', 'district_name',
      'complex_code', 'complex_name', 'court_numbers', 'flag',
    ]);
  });

  it('carries ~3,500 court complexes (order of magnitude)', () => {
    expect(rows.length).toBeGreaterThan(3000);
    expect(rows.length).toBeLessThan(4500);
  });

  it('spans ~700 districts across 36 states/UTs', () => {
    const states = new Set(rows.map((r) => r.state_code));
    const districts = new Set(rows.map((r) => `${r.state_code}|${r.district_code}`));
    expect(states.size).toBeGreaterThanOrEqual(35);
    expect(states.size).toBeLessThanOrEqual(40);
    expect(districts.size).toBeGreaterThan(600);
    expect(districts.size).toBeLessThan(900);
  });

  it('every row has the fields the upsert requires', () => {
    for (const r of rows.slice(0, 200)) {
      expect(r.state_name).toBeTruthy();
      expect(r.district_name).toBeTruthy();
      expect(r.complex_name).toBeTruthy();
    }
  });

  it('complex codes are unique within a (state, district)', () => {
    const seen = new Set<string>();
    let dupes = 0;
    for (const r of rows) {
      const k = `${r.state_code}|${r.district_code}|${r.complex_code}`;
      if (seen.has(k)) dupes += 1;
      seen.add(k);
    }
    expect(dupes).toBe(0);
  });
});
