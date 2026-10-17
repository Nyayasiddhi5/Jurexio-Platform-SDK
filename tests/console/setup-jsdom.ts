/**
 * Vitest jsdom setup for client/Console dashboard tests.
 *
 * Loaded via a per-file `// @vitest-environment jsdom` pragma OR via the
 * separate vitest project config that targets `tests/console/**`. Matches
 * the baseline node-env mocks in `tests/setup.ts` while also providing
 * the browser-side jest-dom matchers and a fetch stub so React Query
 * code paths don't blow up on `fetch is not defined`.
 *
 * NV-OPT+UAT-2026-05-08 (T2 — Track-1.5 console test harness).
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
  ) as unknown as typeof fetch;
}

if (typeof globalThis.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error - jsdom has no ResizeObserver; many radix/recharts components need it.
globalThis.ResizeObserver ||= ResizeObserverStub;
