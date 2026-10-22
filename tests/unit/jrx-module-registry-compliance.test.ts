import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  lookupJrxRegistryEvent,
  validateJrxCanonicalEventName,
} from '../../src/services/jrx-module-registry-service.js';

const registryDir = path.resolve(process.cwd(), 'jurexio-specs/registry');

describe('Jurexio module registry v1 compliance', () => {
  it('validate.py passes (schema + adoption invariants)', () => {
    const out = execSync('python3 jurexio-specs/registry/validate.py', {
      encoding: 'utf8',
    }).trim();
    expect(out).toBe('OK');
  });

  it('events.json is adopted with 758 rows and no null critical', () => {
    const doc = JSON.parse(
      fs.readFileSync(path.join(registryDir, 'events.json'), 'utf8'),
    ) as { _meta: { version: string }; events: { critical: boolean | null }[] };
    expect(doc._meta.version).toContain('adopted');
    expect(doc.events).toHaveLength(758);
    expect(doc.events.every((e) => typeof e.critical === 'boolean')).toBe(true);
  });

  it('lookup and validate canonical LEDGER export event', () => {
    const row = lookupJrxRegistryEvent('LEDGER.EXPORT_CERTIFIED');
    expect(row?.critical).toBe(true);
    const v = validateJrxCanonicalEventName('LEDGER.EXPORT_CERTIFIED');
    expect(v.valid).toBe(true);
    expect(v.code).toBe('CANONICAL_EVENT');
  });
});
