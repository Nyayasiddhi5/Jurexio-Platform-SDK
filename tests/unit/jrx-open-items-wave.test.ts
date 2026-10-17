/**
 * Open-items wave: NV-MEM-RECALL-INDEX-001, NV-STEP0-OBSERVABILITY-001,
 * NV-NER-PERSON-INDIA-001, NV-BENCH-LEAF-SCOPE-001.
 *
 * Each locks a defect that was root-caused against live evidence, not inferred:
 *  - memory recall ranked with a per-row to_tsvector (688ms / 1,430 rows measured on
 *    live RDS => the 30s breaker at ~62k rows for one user) and issued one awaited
 *    UPDATE per returned row.
 *  - step0's release only logged on the early path, so `grep -c` = 0 could not
 *    distinguish "never needed" from "never reached".
 *  - PERSON was a declared entity type with no pattern at all.
 *  - the provider-log extractor scoped on exact requestId equality and so counted
 *    none of the four child-dispatch id shapes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  recordStep0Outcome,
  getStep0Counters,
  __resetStep0CountersForTest,
} from '../../src/orchestration/jrx-completion-driven.js';
import { nvLegalNerV2Service } from '../../src/services/jrx-legal-ner-v2-service.js';

const SRC = join(process.cwd(), 'src');

// ───────────────────────── item 2 ─────────────────────────

describe('NV-STEP0-OBSERVABILITY-001 — the ratio is falsifiable', () => {
  beforeEach(() => __resetStep0CountersForTest());

  it('observed=0 is the ONLY signal that the stage is never reached', () => {
    expect(getStep0Counters()).toEqual({
      bothSettled: 0, releasedEarly: 0, neitherUseful: 0, observed: 0,
    });
  });

  it('a healthy run increments bothSettled, so 0 releases becomes 0/N not 0/0', () => {
    recordStep0Outcome({ releasedEarly: false, ragSettled: true, memSettled: true, ragUseful: true, memUseful: true });
    const c = getStep0Counters();
    expect(c.observed).toBe(1);
    expect(c.bothSettled).toBe(1);
    expect(c.releasedEarly).toBe(0);
  });

  it('counts an early release only when a sibling was still pending', () => {
    recordStep0Outcome({ releasedEarly: true, ragSettled: true, memSettled: false, ragUseful: true, memUseful: false });
    expect(getStep0Counters().releasedEarly).toBe(1);
    // releasedEarly with BOTH settled is not the mechanism firing — it is a normal run.
    __resetStep0CountersForTest();
    recordStep0Outcome({ releasedEarly: true, ragSettled: true, memSettled: true, ragUseful: true, memUseful: true });
    expect(getStep0Counters().releasedEarly).toBe(0);
    expect(getStep0Counters().bothSettled).toBe(1);
  });

  it('separates "nothing useful" from "both settled" — they need different responses', () => {
    recordStep0Outcome({ releasedEarly: false, ragSettled: true, memSettled: true, ragUseful: false, memUseful: false });
    expect(getStep0Counters().neitherUseful).toBe(1);
    expect(getStep0Counters().bothSettled).toBe(0);
  });

  it('is wired into Step-0 and exposed on router-stats', () => {
    const queen = readFileSync(join(SRC, 'orchestration/jrx-queen-orchestrator.ts'), 'utf8');
    const routes = readFileSync(join(SRC, 'routes/jrx-router-stats-routes.ts'), 'utf8');
    expect(queen).toContain('recordStep0Outcome({');
    expect(routes).toContain('step0Grounding: getStep0Counters()');
    expect(routes).toContain('decisionLog: getPersistentLogStats()');
  });
});

// ───────────────────────── item 1 ─────────────────────────

describe('NV-MEM-RECALL-INDEX-001 — recall no longer ranks per row', () => {
  const svc = readFileSync(join(SRC, 'services/jrx-orchestration-services.ts'), 'utf8');

  it('ranks against the generated column on the fast path', () => {
    expect(svc).toContain('ts_rank_cd(value_tsv, plainto_tsquery');
  });

  it('keeps the OLD expression as a fallback so deploy order cannot break recall', () => {
    // Code may ship before the DDL applies; a missing column must degrade, not throw.
    expect(svc).toContain('hasTsvColumn');
    expect(svc).toContain("column_name = 'value_tsv'");
    expect(svc).toContain("ts_rank_cd(to_tsvector('simple', COALESCE(value::text, ''))");
  });

  it('does NOT filter by @@ — a no-match query must still return recent memory', () => {
    // Making the match a WHERE clause would turn "no lexical hit" into an empty
    // recall, which the middleware reads as "no memory".
    expect(svc).not.toContain('WHERE value_tsv @@');
    expect(svc).not.toContain('AND value_tsv @@');
  });

  it('replaces the N+1 access-count writes with one batched, non-awaited statement', () => {
    expect(svc).toContain('WHERE id = ANY(');
    expect(svc).not.toMatch(/for \(const row of \(result\.rows \|\| \[\]\) as any\[\]\) \{\s*await db\.execute/);
  });

  it('caps per-user rows and evicts least-useful first', () => {
    expect(svc).toContain('JRX_MEMORY_MAX_ROWS_PER_USER');
    expect(svc).toContain('ORDER BY importance ASC, last_accessed_at ASC');
    // TTL'd rows excluded so a session burst cannot evict durable matter memory.
    expect(svc).toContain('AND expires_at IS NULL');
  });

  it('the migration is CONCURRENTLY and re-appliable', () => {
    const mig = readFileSync(
      join(process.cwd(), 'migrations/2026-08-17-memory-recall-index.sql'),
      'utf8',
    );
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS value_tsv tsvector');
    expect(mig).toContain('GENERATED ALWAYS AS');
    expect(mig).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_value_tsv');
    expect(mig).toContain('idx_memory_user_evict');
    // CONCURRENTLY cannot run inside a transaction block — assert no executable
    // BEGIN, ignoring prose (the file's own comment explains why there is none).
    const executable = mig
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/\bBEGIN\b/i);
  });
});

// ───────────────────────── item 3B ─────────────────────────

async function personsIn(text: string): Promise<string[]> {
  const r = await nvLegalNerV2Service.extractEntities(text, 'IN' as never);
  return r.entities.filter((e) => e.type === 'PERSON').map((e) => e.text);
}

describe('NV-NER-PERSON-INDIA-001 — PERSON from Indian structural cues', () => {
  it.each([
    ['Ram Kumar S/o Late Shri Mohan Lal, aged 42 years', 'Ram Kumar'],
    ['Radha Devi W/o Shri Mohan Lal', 'Radha Devi'],
    ['Counsel for the Petitioner: Ravi Shankar', 'Ravi Shankar'],
    ['Deponent: Suresh Babu', 'Suresh Babu'],
  ])('extracts a person from %s', async (text, expected) => {
    expect(await personsIn(text)).toContain(expected);
  });

  it('captures only the NAME, not the structural cue around it', async () => {
    const found = await personsIn('Counsel for the Respondent: Ravi Shankar');
    // "Counsel for the Respondent: Ravi Shankar" as a party value would be a bug.
    expect(found.some((p) => /Counsel|Respondent|:/.test(p))).toBe(false);
  });

  it('does NOT invent people from places, courts, statutes or companies', async () => {
    const found = await personsIn(
      'The High Court of Judicature at Hyderabad considered the Bharatiya Nyaya Sanhita ' +
      'and the claim against Meridian Textiles Pvt Ltd at Banjara Hills.',
    );
    for (const bad of ['High Court', 'Banjara Hills', 'Bharatiya Nyaya', 'Meridian Textiles', 'Judicature']) {
      expect(found.join(' | ')).not.toContain(bad);
    }
  });

  it('does not double-count a judge as a person (JUDGE owns that span)', async () => {
    const r = await nvLegalNerV2Service.extractEntities(
      "Listed before the Hon'ble Justice A. Rajashekar Reddy today.", 'IN' as never,
    );
    // NV-NER-JUDGE-INITIALS-001: this assertion originally FAILED — JUDGE_PATTERN
    // could not match a judge cited with initials, which is the standard Indian form.
    expect(r.entities.some((e) => e.type === 'JUDGE')).toBe(true);
    const persons = r.entities.filter((e) => e.type === 'PERSON').map((e) => e.text);
    expect(persons.some((p) => p.includes('Rajashekar'))).toBe(false);
  });

  it.each([
    "Hon'ble Justice A. Rajashekar Reddy",
    'Justice K. S. Puttaswamy',
    'Justice Sharma',
  ])('JUDGE handles the initial forms actually used in cause lists: %s', async (text) => {
    const r = await nvLegalNerV2Service.extractEntities(`Before ${text} today.`, 'IN' as never);
    expect(r.entities.some((e) => e.type === 'JUDGE')).toBe(true);
  });

  it('reports the rule-based model so callers know this is not a neural NER', async () => {
    const r = await nvLegalNerV2Service.extractEntities('Ram Kumar S/o Mohan Lal', 'IN' as never);
    expect(r.model).toBe('regex-v2');
  });

  it('terminates on pathological input (no zero-length match loop)', async () => {
    // The captured-group extractor advances lastIndex manually; assert no hang.
    await expect(personsIn('A '.repeat(500))).resolves.toBeDefined();
  });
});

// ───────────────────────── item 4 ─────────────────────────

describe('NV-BENCH-LEAF-SCOPE-001 — dispatch ids and the extractor agree', () => {
  const client = readFileSync(join(SRC, 'services/jrx-client.ts'), 'utf8');
  const probe = readFileSync(
    join(process.cwd(), 'scripts/_nv-provider-usage-extract.py'),
    'utf8',
  );

  it('the JSON-retry dispatch is request-scoped, not a standalone UUID', () => {
    // A standalone UUID made this billed call attributable to no request at all.
    expect(client).toContain('id: `${requestId}-jsonretry`');
  });

  it('the extractor matches all four child id shapes, including the orch- prefix', () => {
    expect(probe).toContain('QUEEN_ID_PREFIX');
    expect(probe).toContain("CHILD_SEPARATORS = ('::', '-')");
    expect(probe).toContain('def _belongs_to_request');
    // Regression guard: exact equality is what under-counted every leaf.
    expect(probe).not.toContain("c.get('requestId') == request_id]");
  });

  it('reports parent and leaf counts separately so a divergence stays visible', () => {
    expect(probe).toContain('billedParentCalls');
    expect(probe).toContain('billedLeafCalls');
    expect(probe).toContain('byDispatchStage');
  });
});
