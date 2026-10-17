/**
 * NV-MEMORY-ACCESS-ACCOUNTING-001 — the Drizzle `ANY()` trap.
 *
 * Interpolating a JS array into a Drizzle `sql` template expands it into a parameter
 * LIST — `ANY(($1, $2, …))` — and Postgres rejects that with:
 *
 *   op ANY/ALL (array) requires array on right side
 *
 * That is not a typing error, so it compiles and ships. The memory access-accounting
 * UPDATE hit it on every recall and only ever logged a *non-fatal* warn, so it survived
 * a deploy and was found by reading the live gateway log, not the code. While broken,
 * `access_count` / `last_accessed_at` never advanced, so memory importance ranking and
 * the eviction cap were both working from frozen counters.
 *
 * Verified on the live database (SSM `any-form-proof`): the list form FAILS with the
 * message above; `ANY(string_to_array($1, ',')::uuid[])` succeeds and updates rows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('NV-MEMORY-ACCESS-ACCOUNTING-001 — no bare ANY(${array}) in SQL templates', () => {
  it('the memory access-accounting UPDATE casts to uuid[]', () => {
    const src = read('src/services/jrx-orchestration-services.ts');
    expect(src).toContain("ANY(string_to_array(${idCsv}, ',')::uuid[])");
    // The broken form must not come back.
    expect(src).not.toContain('WHERE id = ANY(${ids})');
  });

  it('the agent-registry composite lookup casts to text[]', () => {
    const src = read('src/services/agent-registry-service.ts');
    expect(src).toContain("ANY(string_to_array(${candidateCsv}, ',')::text[])");
    expect(src).not.toContain('ANY(${compositeCandidates})');
  });

  it('no service interpolates a bare array into ANY() without an array cast', () => {
    /* Guard the whole class rather than the two known sites. An `ANY(${x})` with no
     * `::type[]` cast on the interpolation is the exact shape that fails at runtime. */
    const files = [
      'src/services/jrx-orchestration-services.ts',
      'src/services/agent-registry-service.ts',
      'src/services/rag-service.ts',
      'src/services/jrx-phase5-services.ts',
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      for (const rawLine of src.split('\n')) {
        /* Skip comment lines: this file's own explanatory comments quote the broken
         * form verbatim, and an earlier version of this test flagged them as a third
         * offender. Scan CODE only. */
        const trimmed = rawLine.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
        // ANY(${...}) where the closing brace is NOT followed by an array cast.
        const re = /ANY\(\$\{[^}]+\}(?!\s*::\s*\w+\[\])/g;
        for (const m of rawLine.matchAll(re)) {
          // string_to_array(...) carries its own cast inside the interpolation.
          if (m[0].includes('string_to_array')) continue;
          offenders.push(`${f}: ${m[0].slice(0, 60)}`);
        }
      }
    }
    expect(offenders, `uncast ANY(\${array}) found:\n${offenders.join('\n')}`).toEqual([]);
  });
});
