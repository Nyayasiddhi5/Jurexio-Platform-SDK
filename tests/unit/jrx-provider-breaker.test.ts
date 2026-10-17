/**
 * NV-LLM-BREAKER-SHARED-001 — shared provider gate (breaker + unified quarantine).
 *
 * These tests exercise the per-pod fallback path (no `JRX_REDIS_TCP_URL`), which
 * is the path that must behave correctly when Redis is unavailable: a Redis
 * outage has to degrade to "at least as good as the old in-process Map", never
 * to "no protection at all".
 *
 * The invariant that matters most: AgentZero is the never-fail terminal rung and
 * must be ungateable, otherwise a breaker trip could empty the cascade.
 *
 * The `redis-tcp-url.js` mock works around a pre-existing stray compiled build
 * artifact (`src/utils/redis-tcp-url.js` sits next to its `.ts` source and wins
 * vitest module resolution) — same workaround as the lm-cache test suite. It
 * also pins the breaker to its per-pod fallback path, which is what we want to
 * assert here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/utils/redis-tcp-url.js', () => ({
  resolveRedisTcpUrl: () => ({ enabled: false, url: '', reason: 'disabled for unit test' }),
  resolveRedisReadUrl: () => ({ enabled: false, url: '' }),
  getResolvedRedisVarName: () => null,
}));

import {
  __resetProviderBreaker,
  getProviderBreakerSnapshot,
  isHardProviderFault,
  loadProviderGates,
  recordProviderFailure,
  recordProviderSuccess,
  tryHalfOpenProbe,
} from '../../src/services/intelligent-router/jrx-provider-breaker.js';

const SAVED_ENV = { ...process.env };

beforeEach(async () => {
  // Force the per-pod path and make the thresholds fast enough to test.
  delete process.env.JRX_REDIS_TCP_URL;
  delete process.env.REDIS_URL;
  process.env.JRX_LLM_BREAKER_FAILURES = '4';
  await __resetProviderBreaker();
});

afterEach(async () => {
  process.env = { ...SAVED_ENV };
  await __resetProviderBreaker();
});

describe('./jrx-provider-breaker: hard-fault classification', () => {
  it('recognises the deterministic provider faults seen in production logs', () => {
    expect(isHardProviderFault('402 insufficient credits')).toBe(true);
    expect(isHardProviderFault('OpenRouter: insufficient credits')).toBe(true);
    expect(isHardProviderFault('API key not valid')).toBe(true);
    expect(isHardProviderFault('401 unauthorized')).toBe(true);
    expect(isHardProviderFault('is not a valid model id')).toBe(true);
    expect(isHardProviderFault("on-demand throughput isn't supported")).toBe(true);
  });

  it('does not treat transient failures as hard faults', () => {
    expect(isHardProviderFault('503 Service Unavailable')).toBe(false);
    expect(isHardProviderFault('ECONNRESET')).toBe(false);
    expect(isHardProviderFault('429 rate limit')).toBe(false);
  });
});

describe('./jrx-provider-breaker: quarantine is shared across sync and stream', () => {
  it('a 402 recorded once blocks the provider for subsequent gate loads', async () => {
    let gates = await loadProviderGates(['openrouter']);
    expect(gates.get('openrouter')?.allowed).toBe(true);

    // This is what the sync cascade records; the stream path reads the SAME gate.
    recordProviderFailure('openrouter', {
      message: '402 insufficient credits',
      retryable: false,
    });

    gates = await loadProviderGates(['openrouter']);
    expect(gates.get('openrouter')?.state).toBe('quarantined');
    expect(gates.get('openrouter')?.allowed).toBe(false);
  });

  it('a hard-quarantined provider is never offered a half-open probe', async () => {
    recordProviderFailure('openrouter', { message: '402 insufficient credits', retryable: false });
    // Probing cannot fix a billing/credential fault, so it must be refused.
    expect(await tryHalfOpenProbe('openrouter')).toBe(false);
  });
});

describe('./jrx-provider-breaker: circuit opens on repeated transient failure', () => {
  it('stays closed below the threshold and opens at it', async () => {
    for (let i = 0; i < 3; i += 1) {
      recordProviderFailure('google', { message: '503 Service Unavailable', retryable: true });
    }
    let gates = await loadProviderGates(['google']);
    expect(gates.get('google')?.state).toBe('closed');

    recordProviderFailure('google', { message: '503 Service Unavailable', retryable: true });
    gates = await loadProviderGates(['google']);
    expect(gates.get('google')?.state).toBe('open');
    expect(gates.get('google')?.allowed).toBe(false);
  });

  it('a success closes the circuit immediately — the half-open contract', async () => {
    for (let i = 0; i < 5; i += 1) {
      recordProviderFailure('google', { message: '503 Service Unavailable', retryable: true });
    }
    expect((await loadProviderGates(['google'])).get('google')?.state).toBe('open');

    recordProviderSuccess('google');
    expect((await loadProviderGates(['google'])).get('google')?.state).toBe('closed');
    expect((await loadProviderGates(['google'])).get('google')?.allowed).toBe(true);
  });

  it('rate-limits half-open probes so pods do not stampede a recovering provider', async () => {
    for (let i = 0; i < 5; i += 1) {
      recordProviderFailure('bedrock', { message: '503 Service Unavailable', retryable: true });
    }
    expect(await tryHalfOpenProbe('bedrock')).toBe(true);
    // Second caller inside the probe interval must be refused.
    expect(await tryHalfOpenProbe('bedrock')).toBe(false);
  });
});

describe('./jrx-provider-breaker: NV-NEVER-EMPTY-001', () => {
  it('never gates the sovereign terminal rungs', async () => {
    for (const provider of ['agentzero', 'simulation']) {
      for (let i = 0; i < 20; i += 1) {
        recordProviderFailure(provider, { message: '402 insufficient credits', retryable: false });
      }
      const gates = await loadProviderGates([provider]);
      expect(gates.get(provider)?.allowed, provider).toBe(true);
      expect(gates.get(provider)?.state, provider).toBe('closed');
      expect(await tryHalfOpenProbe(provider), provider).toBe(true);
    }
  });
});

describe('./jrx-provider-breaker: batching + observability', () => {
  it('loads every cascade provider in one call and never returns secrets', async () => {
    const providers = ['bedrock', 'google', 'openrouter', 'anthropic', 'agentzero'];
    const gates = await loadProviderGates(providers);
    expect([...gates.keys()].sort()).toEqual([...providers].sort());

    recordProviderFailure('openrouter', { message: '402 insufficient credits', retryable: false });
    const snapshot = getProviderBreakerSnapshot();
    const entry = snapshot.find((s) => s.provider === 'openrouter');
    expect(entry?.state).toBe('quarantined');
    expect(JSON.stringify(snapshot)).not.toMatch(/sk-|Bearer |AKIA/);
  });
});
