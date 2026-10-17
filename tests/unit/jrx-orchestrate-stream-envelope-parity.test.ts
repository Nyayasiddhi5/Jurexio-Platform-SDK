import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * NV-ORCH-STREAM-ENVELOPE-001 — Queen stream run_completed carries the same
 * unified contract fields as POST /orchestrate (trust, cost, sessionId, etc.).
 */
describe('NV-ORCH-STREAM-ENVELOPE-001 — stream/sync envelope parity', () => {
  const ROUTES = readFileSync(
    join(process.cwd(), 'src/routes/jrx-orchestration-routes.ts'),
    'utf8',
  );

  it('creates a quality envelope on the stream route before Queen dispatch', () => {
    expect(ROUTES).toContain('NV-ORCH-STREAM-ENVELOPE-001');
    expect(ROUTES).toContain('const streamQualityEnv: QualityEnvelopeState = createQualityEnvelope');
    expect(ROUTES).toContain("markIngressGates(streamQualityEnv, 'dualSdkOrJwt+consent+adaptive-stream')");
  });

  it('Queen stream run_completed uses buildUnifiedOrchestrationContract', () => {
    expect(ROUTES).toContain('const streamUnified = buildUnifiedOrchestrationContract');
    expect(ROUTES).toContain('...streamUnified');
  });

  it('run_started echoes sessionId and orchestrationId for multi-turn continuity', () => {
    expect(ROUTES).toMatch(
      /run_started.*sessionId.*orchestrationId/s,
    );
  });
});
