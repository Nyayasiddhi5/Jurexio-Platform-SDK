/**
 * NV-MEM-INSERT-FIX-001 — matter memory durable writes must bind org RLS context.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const withTenantTxMock = vi.fn(async (_orgId: string, fn: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
  const tx = { execute: vi.fn(async () => ({ rows: [{ id: 42 }] })) };
  return fn(tx);
});

vi.mock('../../../src/middleware/jrx-org-rls-middleware.js', () => ({
  withTenantTx: (...args: unknown[]) => withTenantTxMock(...args as [string, (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>]),
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {},
}));

vi.mock('../../../src/services/field-encryption-service.js', () => ({
  encryptedExpr: vi.fn(() => ({ sql: 'enc' })),
  decryptedExpr: vi.fn(() => ({ sql: 'dec' })),
}));

describe('Nv5TierMemoryService RLS-bound durable writes', () => {
  beforeEach(() => {
    withTenantTxMock.mockClear();
  });

  it('saveMatterMemory uses withTenantTx when orgId is present (integration)', async () => {
    const { nv5TierMemoryService } = await import('../../../src/services/memory/jrx-5tier-memory-service.js');
    await nv5TierMemoryService.saveMatterMemory(
      'partner-user-88421',
      '88421',
      { memoryType: 'interaction', content: 'Q: codeword\nA: ack' },
      { userId: 88421, orgId: 10000000 },
    );
    expect(withTenantTxMock).toHaveBeenCalledTimes(1);
    expect(withTenantTxMock.mock.calls[0]?.[0]).toBe('10000000');
    const txFn = withTenantTxMock.mock.calls[0]?.[1];
    expect(typeof txFn).toBe('function');
    const tx = { execute: vi.fn(async () => ({ rows: [{ id: 7 }] })) };
    await txFn!(tx);
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it('saveMatterMemory refuses write without orgId (RLS requires tenant binding)', async () => {
    const { nv5TierMemoryService } = await import('../../../src/services/memory/jrx-5tier-memory-service.js');
    await nv5TierMemoryService.saveMatterMemory(
      'partner-user-88421',
      '88421',
      { memoryType: 'interaction', content: 'probe' },
      { userId: 88421 },
    );
    expect(withTenantTxMock).not.toHaveBeenCalled();
  });

  it('getMatterMemory routes reads through withTenantTx', async () => {
    const { nv5TierMemoryService } = await import('../../../src/services/memory/jrx-5tier-memory-service.js');
    withTenantTxMock.mockImplementationOnce(async (_orgId, fn) => {
      const tx = {
        execute: vi.fn(async () => ({
          rows: [{
            id: 1,
            matterId: 'm1',
            userId: 88421,
            memoryType: 'interaction',
            content: 'codeword roundtrip',
            importance: 0.6,
            metadata: {},
            createdAt: new Date().toISOString(),
          }],
        })),
      };
      return fn(tx);
    });
    const rows = await nv5TierMemoryService.getMatterMemory('m1', { userId: 88421, orgId: 10000000 }, 5);
    expect(withTenantTxMock).toHaveBeenCalledWith('10000000', expect.any(Function));
    expect(rows).toHaveLength(1);
    expect(String(rows[0].content)).toContain('codeword');
  });

  it('source wires withTenantTx + raw INSERT for saveMatterMemory (static guard)', () => {
    const root = path.join(process.cwd());
    const src = fs.readFileSync(
      path.join(root, 'src/services/memory/jrx-5tier-memory-service.ts'),
      'utf8',
    );
    expect(src).toMatch(/withMatterMemoryTenantTx/);
    expect(src).toMatch(/withTenantTx/);
    expect(src).toMatch(/refused-missing-org-id/);
    expect(src).toMatch(/INSERT INTO nv_matter_memory/);
    expect(src).toMatch(/SET content_enc = \$\{encryptedExpr\(memory\.content\)\}/);
  });
});
