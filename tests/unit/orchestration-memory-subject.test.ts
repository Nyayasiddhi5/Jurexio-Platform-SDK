import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bindOrchestrationMemoryUser,
  memoryCallerFromUser,
  resolveOrchestrationMemorySubject,
  type OrchestrationMemoryCaller,
} from '../../src/authz/orchestration-memory-subject.js';

function caller(id: string, role?: string): OrchestrationMemoryCaller {
  return { id, role };
}

describe('memoryCallerFromUser', () => {
  it('rejects a missing user or a blank id', () => {
    expect(memoryCallerFromUser(null)).toBeNull();
    expect(memoryCallerFromUser(undefined)).toBeNull();
    expect(memoryCallerFromUser({})).toBeNull();
    // `??` does not treat '' as missing, so a blank id stays unauthenticated
    // instead of adopting userId.
    expect(memoryCallerFromUser({ id: '', userId: '7', role: 'admin' })).toBeNull();
    expect(
      resolveOrchestrationMemorySubject(
        memoryCallerFromUser({ id: '', userId: '7', role: 'admin' }),
        '7',
      ),
    ).toEqual({ ok: false, status: 401 });
  });

  it('prefers id and falls back to userId, including numeric zero', () => {
    expect(memoryCallerFromUser({ id: '42', userId: '7', role: 'user' })).toEqual({
      id: '42',
      role: 'user',
    });
    expect(memoryCallerFromUser({ userId: 42, role: 'user' })).toEqual({
      id: '42',
      role: 'user',
    });
    expect(memoryCallerFromUser({ id: 0, role: 'user' })).toEqual({
      id: '0',
      role: 'user',
    });
  });

  it('drops a non-string role so it cannot match an operator', () => {
    const callerFromRole = memoryCallerFromUser({ id: '42', role: 1 });
    expect(callerFromRole).toEqual({ id: '42', role: undefined });
    expect(resolveOrchestrationMemorySubject(callerFromRole, '7')).toEqual({
      ok: false,
      status: 403,
    });
  });
});

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
    expect(resolveOrchestrationMemorySubject(caller('1', 'super_admin'), '7')).toEqual({
      ok: true,
      userId: '7',
    });
  });

  it('rejects lookalike roles and non-id request values', () => {
    expect(resolveOrchestrationMemorySubject(caller('42', 'Admin'), '7')).toEqual({
      ok: false,
      status: 403,
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'super_admin '), '7')).toEqual({
      ok: false,
      status: 403,
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'SUPERADMIN'), '7')).toEqual({
      ok: false,
      status: 403,
    });

    const disguised = { toString: () => '7' };
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), disguised)).toEqual({
      ok: true,
      userId: '42',
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), ['7'])).toEqual({
      ok: true,
      userId: '42',
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), true)).toEqual({
      ok: true,
      userId: '42',
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), Number.NaN)).toEqual({
      ok: true,
      userId: '42',
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), Number.POSITIVE_INFINITY)).toEqual({
      ok: true,
      userId: '42',
    });
  });

  it('trims a requested id before comparing it to the caller', () => {
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), ' 42 ')).toEqual({
      ok: true,
      userId: '42',
    });
    expect(resolveOrchestrationMemorySubject(caller('42', 'user'), ' 7 ')).toEqual({
      ok: false,
      status: 403,
    });
    expect(resolveOrchestrationMemorySubject(caller('1', 'admin'), ' 7 ')).toEqual({
      ok: true,
      userId: '7',
    });
  });
});

describe('bindOrchestrationMemoryUser', () => {
  it('keeps the resolved subject when the body names someone else', () => {
    const body = { userId: '7', key: 'matter', value: 'confidential filing', limit: 20 };
    const bound = bindOrchestrationMemoryUser(body, '42');
    expect(bound.userId).toBe('42');
    expect(bound.key).toBe('matter');
    expect(bound.value).toBe('confidential filing');
    expect(bound.limit).toBe(20);
    expect(body.userId).toBe('7');
  });

  it('replaces a numeric userId without keeping the original property', () => {
    const bound = bindOrchestrationMemoryUser({ userId: 7, key: 'matter' }, '42');
    expect(bound).toEqual({ key: 'matter', userId: '42' });
  });
});

describe('orchestration memory routes', () => {
  const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const source = readFileSync(join(repoRoot, 'src/routes/jrx-orchestration-routes.ts'), 'utf8');

  function handlerSlice(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it('returns before the memory service when the subject is denied', () => {
    const store = handlerSlice("router.post('/memory/store'", "router.post('/memory/retrieve'");
    const retrieve = handlerSlice("router.post('/memory/retrieve'", "router.delete('/memory/clear'");
    const clear = handlerSlice("router.delete('/memory/clear'", "router.post('/rag/ingest'");

    for (const handler of [store, retrieve, clear]) {
      const denied = handler.indexOf('if (!subject.ok)');
      const returned = handler.indexOf('return;', denied);
      const service = handler.indexOf('nvMemoryService.');
      expect(denied).toBeGreaterThan(0);
      expect(returned).toBeGreaterThan(denied);
      expect(service).toBeGreaterThan(returned);
      expect(handler).toContain('memoryCallerFromUser(req.user)');
      expect(handler).toContain('resolveOrchestrationMemorySubject');
      expect(handler).not.toContain('{ userId, ...req.body }');
      expect(handler).not.toContain('{ userId, ...body }');
    }

    expect(store).toContain(
      'nvMemoryService.store(bindOrchestrationMemoryUser(body, subject.userId)',
    );
    expect(retrieve).toContain(
      'nvMemoryService.retrieve(bindOrchestrationMemoryUser(body, subject.userId)',
    );
    expect(clear).toContain('nvMemoryService.clear(subject.userId, scope)');
    expect(clear).toContain("typeof body.scope === 'string'");
  });
});
