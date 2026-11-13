import { afterEach, describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { governanceSelectOneIdByColumn } from '../../src/db/governance-sql.js';

const ORIGINAL_SCHEMA = process.env.JRX_PG_SCHEMA;

afterEach(() => {
  if (ORIGINAL_SCHEMA === undefined) delete process.env.JRX_PG_SCHEMA;
  else process.env.JRX_PG_SCHEMA = ORIGINAL_SCHEMA;
});

function rawIdentifier(query: SQL): string {
  const values = (query as unknown as { values?: Array<{ raw?: string }> }).values ?? [];
  return values.map((value) => value.raw ?? '').join(' ');
}

describe('governanceSelectOneIdByColumn', () => {
  it('returns an id found in the active schema', async () => {
    delete process.env.JRX_PG_SCHEMA;
    let calls = 0;
    const id = await governanceSelectOneIdByColumn(
      async (query) => {
        calls += 1;
        expect(rawIdentifier(query)).toContain('jrx_schema.protocol_registry');
        return { rows: [{ id: 'primary-row' }] };
      },
      'protocol_registry',
      'protocol_name',
      'CAP_chat',
    );
    expect(id).toBe('primary-row');
    expect(calls).toBe(1);
  });

  it('does not probe the legacy schema when the active schema has no row', async () => {
    delete process.env.JRX_PG_SCHEMA;
    let calls = 0;
    const id = await governanceSelectOneIdByColumn(
      async () => {
        calls += 1;
        return { rows: [] };
      },
      'protocol_registry',
      'protocol_name',
      'CAP_chat',
    );
    expect(id).toBeNull();
    expect(calls).toBe(1);
  });

  it('looks up JRX_PG_SCHEMA when that override is the write target', async () => {
    process.env.JRX_PG_SCHEMA = 'nv_schema';
    const id = await governanceSelectOneIdByColumn(
      async (query) => {
        expect(rawIdentifier(query)).toContain('nv_schema.protocol_registry');
        expect(rawIdentifier(query)).not.toContain('jrx_schema');
        return { rows: [{ id: 'legacy-row' }] };
      },
      'protocol_registry',
      'protocol_name',
      'ROMA_L1_Transparency',
    );
    expect(id).toBe('legacy-row');
  });

  it('still surfaces a missing active schema so boot can fail closed', async () => {
    delete process.env.JRX_PG_SCHEMA;
    const missing = Object.assign(new Error('relation "jrx_schema.protocol_registry" does not exist'), {
      code: '42P01',
    });
    await expect(
      governanceSelectOneIdByColumn(
        async () => {
          throw missing;
        },
        'protocol_registry',
        'protocol_name',
        'CAP_chat',
      ),
    ).rejects.toBe(missing);
  });
});
