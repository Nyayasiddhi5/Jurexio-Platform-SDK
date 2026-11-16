import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bindOrchestrationMemoryUser,
  resolveOrchestrationMemorySubject,
  type OrchestrationMemoryCaller,
} from '../../src/authz/orchestration-memory-subject.js';

function caller(id: string, role?: string): OrchestrationMemoryCaller {
  return { id, role };
}

describe('resolveOrchestrationMemorySubject', () => {
  it('rejects a missing caller', () => {
    expect(resolveOrchestrationMemorySubject(null, '42')).toEqual({ ok: false, status: 401 });
  });

  it('uses the caller when no other user is requested', () => {
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), undefined)).toEqual({
      ok: true,
      userId: '42',
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), '')).toEqual({
      ok: true,
      userId: '42',
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), '   ')).toEqual({
      ok: true,
      userId: '42',
    });
  });

  it('allows a user to name themselves', () => {
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), '42')).toEqual({
      ok: true,
      userId: '42',
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), 42)).toEqual({
      ok: true,
      userId: '42',
    });
  });

  it('refuses a user who names someone else', () => {
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), '7')).toEqual({ ok: false, status: 403 });
    expect(resolveOrchestrationMemorySubject(caller('42', 'org_admin'), '7')).toEqual({ ok: false, status: 403 });
    expect(resolveOrchestrationMemorySubject(caller('42', 'sme'), 7)).toEqual({ ok: false, status: 403 });
  });

  it('allows an operator to name another principal', () => {
    expect(resolveOrchestrationMemorySubject(caller('1', 'admin'), '7')).toEqual({
      ok: true,
      userId: '7',
    });
    expect(resolveOrchestrationMemorySubject(caller('service-account', 'service'), '7')).toEqual({
      ok: true,
      userId: '7',
    });
    expect(resolveOrchestrationMemorySubject(caller('1', 'superadmin'), 7)).toEqual({
      ok: true,
      userId: '7',
    });
  });
});

describe('bindOrchestrationMemoryUser', () => {
  it('keeps the resolved subject when the body names someone else', () => {
    const bound = bindOrchestrationMemoryUser(
      { userId: '7', key: 'matter', value: 'confidential filing', limit: 20 },
      '42',
    );
    expect(bound.userId).toBe('42');
    expect(bound.key).toBe('matter');
    expect(bound.value).toBe('confidential filing');
    expect(bound.limit).toBe(20);
  });
});

describe('orchestration memory routes', () => {
  const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const source = readFileSync(join(repoRoot, 'src/routes/jrx-orchestration-routes.ts'), 'utf8');

  it('binds store, retrieve, and clear through the subject helper', () => {
    const store = source.indexOf("router.post('/memory/store'");
    const retrieve = source.indexOf("router.post('/memory/retrieve'");
    const clear = source.indexOf("router.delete('/memory/clear'");
    expect(store).toBeGreaterThan(0);
    expect(retrieve).toBeGreaterThan(store);
    expect(clear).toBeGreaterThan(retrieve);
    const handlers = source.slice(store, clear + 800);
    expect(handlers.match(/resolveOrchestrationMemorySubject/g)?.length).toBe(3);
    expect(handlers).not.toContain('{ userId, ...req.body }');
    expect(handlers).toContain('bindOrchestrationMemoryUser');
  });
});
