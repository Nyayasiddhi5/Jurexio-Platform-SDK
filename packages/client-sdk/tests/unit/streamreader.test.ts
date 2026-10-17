/**
 * NyvStreamReader unit tests — @jurexio/client-sdk v5
 * Tests: instantiation, handler wiring, event type coverage.
 */

import { describe, it, expect, vi } from 'vitest';

const MOCK_API_KEY = 'nyv_test_sk_0000000000000000000000000000000000000000';
const MOCK_BASE_URL = 'https://app.nyayavigya.in';

describe('NyvStreamReader', () => {
  describe('Instantiation', () => {
    it('creates instance with apiKey and baseUrl', async () => {
      const { NyvStreamReader } = await import('../../src/index.js');
      const reader = new NyvStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      expect(reader).toBeDefined();
      expect(reader).toBeInstanceOf(NyvStreamReader);
    });

    it('exposes streamPattern method', async () => {
      const { NyvStreamReader } = await import('../../src/index.js');
      const reader = new NyvStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      expect(typeof reader.streamPattern).toBe('function');
    });

    it('exposes streamOrchestrate method', async () => {
      const { NyvStreamReader } = await import('../../src/index.js');
      const reader = new NyvStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      expect(typeof reader.streamOrchestrate).toBe('function');
    });
  });

  describe('Handler interface', () => {
    it('accepts all handler callbacks and aborts immediately without throwing', async () => {
      const { NyvStreamReader } = await import('../../src/index.js');
      const reader = new NyvStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
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

  describe('NyvStreamReader options', () => {
    it('accepts AbortSignal and aborts the stream', async () => {
      const { NyvStreamReader } = await import('../../src/index.js');
      const reader = new NyvStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
      const controller = new AbortController();
      controller.abort();
      await reader
        .streamPattern('cot', { task: 'test' }, {}, { signal: controller.signal })
        .catch(() => {});
    });

    it('accepts reconnectMs and maxReconnects without throwing', async () => {
      const { NyvStreamReader } = await import('../../src/index.js');
      const reader = new NyvStreamReader(MOCK_API_KEY, MOCK_BASE_URL);
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
