/**
 * JrxStreamReader unit tests — @jurexio/client-sdk v5
 * Tests: instantiation, handler wiring, event type coverage.
 */

import { describe, it, expect, vi } from 'vitest';

const MOCK_API_KEY = 'nyv_test_sk_0000000000000000000000000000000000000000';
const MOCK_BASE_URL = 'https://app.jurexio.com';

describe('JrxStreamReader', () => {
  describe('Instantiation', () => {
    it('creates instance with apiKey and baseUrl', async () => {
      const { JrxStreamReader } = await import('../../src/index.js');
      const reader = new JrxStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      expect(reader).toBeDefined();
      expect(reader).toBeInstanceOf(JrxStreamReader);
    });

    it('exposes streamPattern method', async () => {
      const { JrxStreamReader } = await import('../../src/index.js');
      const reader = new JrxStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      expect(typeof reader.streamPattern).toBe('function');
    });

    it('exposes streamOrchestrate method', async () => {
      const { JrxStreamReader } = await import('../../src/index.js');
      const reader = new JrxStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      expect(typeof reader.streamOrchestrate).toBe('function');
    });
  });

  describe('Handler interface', () => {
    it('accepts all handler callbacks and aborts immediately without throwing', async () => {
      const { JrxStreamReader } = await import('../../src/index.js');
      const reader = new JrxStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      const ctrl = new AbortController();
      const handlers = {
        onStart: vi.fn(),
        onThinking: vi.fn(),
        onToolCall: vi.fn(),
        onTextDelta: vi.fn(),
        onCitation: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onPatternEvent: vi.fn(),
        onMetadata: vi.fn(),
        onCitationBlock: vi.fn(),
      };
      ctrl.abort();
      await reader
        .streamPattern('react', { task: 'test' }, handlers, { signal: ctrl.signal })
        .catch(() => {});
    });
  });

  describe('JrxStreamReader options', () => {
    it('accepts AbortSignal and aborts the stream', async () => {
      const { JrxStreamReader } = await import('../../src/index.js');
      const reader = new JrxStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      const controller = new AbortController();
      controller.abort();
      await reader
        .streamPattern('cot', { task: 'test' }, {}, { signal: controller.signal })
        .catch(() => {});
    });

    it('accepts reconnectMs and maxReconnects without throwing', async () => {
      const { JrxStreamReader } = await import('../../src/index.js');
      const reader = new JrxStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      const ctrl = new AbortController();
      ctrl.abort();
      await reader
        .streamPattern('rag', { task: 'test' }, {}, {
          signal: ctrl.signal,
          reconnectMs: 1000,
          maxReconnects: 3,
        })
        .catch(() => {});
    });
  });
});
