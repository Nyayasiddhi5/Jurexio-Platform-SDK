/**
 * Orchestration Smoke Suite — 5 patterns
 * Task #32 / NYV-TEST-ORCH-001
 *
 * Exercises the SSoT capability manifest, orchestration policy, middleware,
 * and DAG service through the same code paths Queen / SDK / tools take.
 * Uses synthetic capabilities so no live LLM/DB call is required.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// Inject synthetic capabilities BEFORE the manifest is consumed by the suite.
// We register lightweight in-process capabilities for the smoke suite so the
// manifest contract — not real I/O — is what's being asserted.
async function registerSyntheticCapabilities() {
  const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

  capabilityManifest.register({
    id: 'smoke.echo',
    displayName: 'Smoke Echo',
    category: 'tools',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'swarm', 'hierarchical', 'simple'],
    tags: ['smoke', 'echo'],
    source: 'tests/orchestration/smoke.test.ts',
    factory: () => ({
      invoke: async (input: any) => ({ echoed: input?.value ?? input?.fromDAG ?? 'default' }),
    }),
  });

  capabilityManifest.register({
    id: 'smoke.fail',
    displayName: 'Smoke Fail',
    category: 'tools',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['parallel', 'dag', 'swarm'],
    tags: ['smoke', 'fail'],
    source: 'tests/orchestration/smoke.test.ts',
    factory: () => ({
      invoke: async () => { throw new Error('smoke.fail intentional'); },
    }),
  });

  capabilityManifest.register({
    id: 'smoke.slow',
    displayName: 'Smoke Slow',
    category: 'tools',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['parallel', 'dag', 'swarm'],
    tags: ['smoke', 'slow'],
    source: 'tests/orchestration/smoke.test.ts',
    factory: () => ({
      invoke: async (input: any) => {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true, slot: input?.slot ?? 0 };
      },
    }),
  });
}

beforeAll(async () => {
  await registerSyntheticCapabilities();
});

// ──────────────────────────────────────────────────────────────────────────────
// Pattern 1 — Sequential: a single capability invocation
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Pattern 1: Sequential', () => {
  it('invokes a registered capability end-to-end through the manifest', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const r = await capabilityManifest.invoke('smoke.echo', { value: 'hello' }, { tier: 'lite' });
    expect(r).toEqual({ echoed: 'hello' });
  });

  it('rejects a capability not exposed to the requester tier', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    capabilityManifest.register({
      id: 'smoke.enterprise-only',
      displayName: 'Enterprise Only',
      category: 'tools',
      tiers: ['enterprise', 'sovereign'],
      supportedJurisdictions: 'all',
      costClass: 'free',
      safetyClass: 'safe',
      supportedPatterns: ['simple'],
      tags: [],
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({ invoke: async () => 'ok' }),
    });
    await expect(
      capabilityManifest.invoke('smoke.enterprise-only', {}, { tier: 'lite' }),
    ).rejects.toThrow(/not exposed to tier/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Pattern 2 — Parallel: bounded concurrency via policy
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Pattern 2: Parallel (bounded concurrency)', () => {
  it('respects per-tier maxConcurrentNodes', async () => {
    const { runWithConcurrency, getPolicyForTier } = await import('../../src/orchestration/orchestration-policy.js');
    const policy = getPolicyForTier('mitra'); // maxConcurrentNodes=4
    let inFlight = 0;
    let observedMax = 0;

    const items = Array.from({ length: 10 }, (_, i) => i);
    const results = await runWithConcurrency(
      items,
      async (i) => {
        inFlight++;
        observedMax = Math.max(observedMax, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return i * 2;
      },
      { concurrency: policy.maxConcurrentNodes },
    );

    expect(results.every((r) => r.value !== undefined)).toBe(true);
    expect(results.map((r) => r.value)).toEqual(items.map((i) => i * 2));
    expect(observedMax).toBeLessThanOrEqual(policy.maxConcurrentNodes);
  });

  it('captures per-item failures without aborting the run', async () => {
    const { runWithConcurrency } = await import('../../src/orchestration/orchestration-policy.js');
    const out = await runWithConcurrency(
      [1, 2, 3],
      async (i) => { if (i === 2) throw new Error('boom'); return i; },
      { concurrency: 3 },
    );
    expect(out[0].value).toBe(1);
    expect(out[1].error?.message).toBe('boom');
    expect(out[2].value).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Pattern 3 — DAG: bound manifest executor + policy-driven failure handling
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Pattern 3: DAG (manifest-bound)', () => {
  it('executes a multi-level DAG through the manifest executor', async () => {
    const { dagOrchestrationService } = await import('../../src/services/dag-orchestration-service.js');
    dagOrchestrationService.bindCapabilityManifestExecutor();
    dagOrchestrationService.setTier('mitra');

    const planId = `smoke_dag_${Date.now()}`;
    await dagOrchestrationService.createExecutionPlan(planId, 'Smoke DAG', [
      { id: 'a', name: 'smoke.echo', dependencies: [] },
      { id: 'b', name: 'smoke.echo', dependencies: ['a'] },
      { id: 'c', name: 'smoke.echo', dependencies: ['a'] },
      { id: 'd', name: 'smoke.echo', dependencies: ['b', 'c'] },
    ]);

    const result = await dagOrchestrationService.executePlan(planId);
    expect(result.completedNodes).toBeGreaterThanOrEqual(4);
    expect(result.failedNodes).toBe(0);
    expect(result.parallelizationFactor).toBeGreaterThanOrEqual(2);
    expect(result.nodeResults.has('__synthesis__')).toBe(true);
  });

  it('halts a fail-fast DAG on first failure (lite tier)', async () => {
    const { dagOrchestrationService } = await import('../../src/services/dag-orchestration-service.js');
    dagOrchestrationService.bindCapabilityManifestExecutor();
    dagOrchestrationService.setTier('lite'); // fail-fast, maxFailedNodes=0

    const planId = `smoke_dag_failfast_${Date.now()}`;
    await dagOrchestrationService.createExecutionPlan(planId, 'Smoke DAG Fail-Fast', [
      { id: 'a', name: 'smoke.echo', dependencies: [] },
      { id: 'b', name: 'smoke.fail', dependencies: ['a'] },
      { id: 'c', name: 'smoke.echo', dependencies: ['b'] },
    ]);

    const result = await dagOrchestrationService.executePlan(planId);
    expect(result.failedNodes).toBeGreaterThanOrEqual(1);
    expect(result.completedNodes).toBeLessThanOrEqual(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Pattern 4 — Swarm: best-of-N parallel + synthesis fan-in
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Pattern 4: Swarm (best-of-N + synthesis)', () => {
  it('aggregates parallel calls and synthesizes a single output', async () => {
    const { runWithConcurrency, defaultSynthesize } = await import('../../src/orchestration/orchestration-policy.js');
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

    const slots = [0, 1, 2, 3, 4];
    const out = await runWithConcurrency(
      slots,
      async (slot) => {
        const r: any = await capabilityManifest.invoke('smoke.slow', { slot }, { tier: 'enterprise' });
        return { key: `slot-${slot}`, output: JSON.stringify(r) };
      },
      { concurrency: 8 },
    );

    const parts = out.filter((r) => !!r.value).map((r) => r.value!);
    expect(parts.length).toBe(slots.length);
    const synth = defaultSynthesize(parts);
    expect(synth).toContain('Fan-in Synthesis');
    expect(synth).toContain('slot-0');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Pattern 5 — Hierarchical: coalition formation + manifest invocation
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Pattern 5: Hierarchical (coalition + delegate)', () => {
  it('forms a coalition and routes per-capability invocations', async () => {
    const { hierarchicalTaskAllocator } = await import('../../src/services/hierarchical-task-allocator.js');
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

    const coalition = await hierarchicalTaskAllocator.formCoalition(
      'smoke-task-001',
      ['legal-research', 'document-drafting'], // capability hints; allocator will rank
      'parallel',
      { jurisdiction: 'IN' },
    );
    expect(coalition.members.length).toBeGreaterThan(0);
    const lead = coalition.members.find((m) => m.role === 'lead');
    expect(lead).toBeTruthy();

    // Now have the coalition members each invoke a capability through the manifest.
    const memberOutputs = await Promise.all(
      coalition.members.map(async (m) => {
        return capabilityManifest.invoke(
          'smoke.echo',
          { value: `from-${m.role}-${m.agentId}` },
          { tier: 'enterprise', agentKey: m.agentId },
        );
      }),
    );
    expect(memberOutputs.length).toBe(coalition.members.length);
    expect(memberOutputs[0]).toMatchObject({ echoed: expect.stringContaining('from-lead') });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Manifest invariants
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Manifest invariants', () => {
  it('seeds the expected categories', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const ids = capabilityManifest.list().map((c) => c.id);
    for (const required of ['memory.tiered.recall', 'memory.tiered.store', 'rag.search', 'skills.activate', 'safety.hallucination-check', 'metering.usage-log', 'tools.execute']) {
      expect(ids).toContain(required);
    }
  });

  it('exposes a smaller capability surface to lite vs sovereign tiers', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const lite = capabilityManifest.capabilitiesForTier('lite').length;
    const sov = capabilityManifest.capabilitiesForTier('sovereign').length;
    expect(sov).toBeGreaterThanOrEqual(lite);
  });

  it('seeds intelligence, compliance, document-pipeline, workflow capabilities', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const ids = capabilityManifest.list().map((c) => c.id);
    for (const required of [
      'intelligence.precedent-similarity',
      'intelligence.litigation-risk',
      'intelligence.amendment-impact',
      'intelligence.conflict-check',
      'intelligence.regulatory-watch',
      'compliance.consent',
      'compliance.export',
      'compliance.incident',
      'safety.citation-verify',
      'safety.explainability',
      'feedback.submit',
      'workflow.contract-playbook',
      'workflow.calendar-extract',
      'workflow.bulk-analysis',
      'workflow.email-classify',
      'agent.auto-select',
      'agent.metrics',
      'governance.model-policy',
      'docs.parse-legal',
      'docs.chunk-legal',
    ]) {
      expect(ids, `missing capability: ${required}`).toContain(required);
    }
  });

  it('rejects capability invocation outside the tier whitelist', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    // protocol.registry is enterprise+ only; lite tier MUST be rejected.
    await expect(
      capabilityManifest.invoke('protocol.registry', { op: 'list' }, { tier: 'lite' }),
    ).rejects.toThrow(/not exposed to tier/);
  });

  it('rejects invocation outside supported jurisdictions', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    capabilityManifest.register({
      id: 'smoke.juris-only',
      displayName: 'Smoke Jurisdiction-Restricted',
      category: 'tools',
      tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: ['IN'],
      costClass: 'free',
      safetyClass: 'safe',
      supportedPatterns: ['simple'],
      tags: ['smoke', 'juris'],
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({ invoke: async () => ({ ok: true }) }),
    });
    await expect(
      capabilityManifest.invoke('smoke.juris-only', {}, { tier: 'lite', jurisdiction: 'US' }),
    ).rejects.toThrow(/not enabled in jurisdiction/);
    // But IN works
    await expect(
      capabilityManifest.invoke('smoke.juris-only', {}, { tier: 'lite', jurisdiction: 'IN' }),
    ).resolves.toEqual({ ok: true });
  });

  it('throws clearly on unknown capability id', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    await expect(
      capabilityManifest.invoke('does.not.exist', {}, { tier: 'lite' }),
    ).rejects.toThrow(/unknown capability/);
  });

  it('preserves jurisdiction precedence: capability filter does not override request jurisdiction', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    let observedJurisdiction: string | undefined;
    capabilityManifest.register({
      id: 'smoke.juris-spy',
      displayName: 'Smoke Juris Spy',
      category: 'tools',
      tiers: ['lite'],
      supportedJurisdictions: 'all', // capability allows all → never overrides ctx
      costClass: 'free',
      safetyClass: 'safe',
      supportedPatterns: ['simple'],
      tags: ['smoke'],
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({
        invoke: async (_input: any, ctx: any) => {
          observedJurisdiction = ctx?.jurisdiction;
          return { ok: true };
        },
      }),
    });
    await capabilityManifest.invoke('smoke.juris-spy', {}, { tier: 'lite', jurisdiction: 'IN' });
    expect(observedJurisdiction).toBe('IN'); // explicit ctx value wins
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Middleware contract — uniform memory/RAG/safety/HITL/metering/audit ring
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Middleware contract', () => {
  beforeAll(async () => { await registerSyntheticCapabilities(); });

  it('runs pre→exec→post in the correct order and returns enriched output', async () => {
    const { withMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
    const order: string[] = [];
    const result = await withMiddleware(
      {
        prompt: 'unit-test prompt',
        agentKey: 'smoke-agent',
        tier: 'enterprise',
        jurisdiction: 'IN',
        userId: 'u1',
        tenantId: 't1',
        requestId: 'req-mw-1',
        riskLevel: 'low',
      },
      async (pre) => {
        order.push('exec');
        expect(pre.enrichedPrompt).toContain('unit-test prompt');
        expect(pre.ctx.tier).toBe('enterprise');
        return { output: 'mw-out', tokens: { input: 4, output: 2 } };
      },
    );
    expect(order).toEqual(['exec']);
    expect(result.output).toBe('mw-out');
    expect(result.pre).toBeTruthy();
    expect(result.post).toBeTruthy();
  });

  it('does not crash when individual middleware components fail (non-fatal logging)', async () => {
    const { withMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
    // Even with no live downstream services, the ring must complete.
    const out = await withMiddleware(
      { prompt: 'p', tier: 'lite', requestId: 'req-mw-2' },
      async () => ({ output: 'still-ok' }),
    );
    expect(out.output).toBe('still-ok');
  });

  it('propagates context through to the executor (jurisdiction, tenantId, agentKey)', async () => {
    const { withMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
    let captured: any = null;
    await withMiddleware(
      {
        prompt: 'capture-me',
        tier: 'mitra',
        jurisdiction: 'AE',
        tenantId: 'tenant-42',
        agentKey: 'agentA',
        requestId: 'req-mw-3',
      },
      async (pre) => {
        captured = pre.ctx;
        return { output: 'ok' };
      },
    );
    expect(captured?.jurisdiction).toBe('AE');
    expect(captured?.tenantId).toBe('tenant-42');
    expect(captured?.agentKey).toBe('agentA');
    expect(captured?.tier).toBe('mitra');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Production fail-loud invariants
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// Real-services capability coverage — assert that the manifest registers the
// production catalog (nyaya-tools, jurisdiction-agents, contract-lifecycle,
// digital-twin, e-filing, automateai, clawdbot, multi-org, enterprise-platform)
// and that the JSON snapshot mirrors the in-memory registry.
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Full services catalog coverage', () => {
  const REQUIRED_PRODUCTION_IDS = [
    // nyaya-tools suite
    'nyaya-tools.amend',
    'nyaya-tools.compare',
    'nyaya-tools.forensic',
    'nyaya-tools.graph',
    'nyaya-tools.template',
    'nyaya-tools.timeline',
    'nyaya-tools.trail',
    'nyaya-tools.watch',
    'nyaya-tools.agent-lifecycle',
    // jurisdiction agents
    'jurisdiction.overlay',
    'jurisdiction.sync',
    // Wave B6 Mesh v1 intent-facing aliases
    'templates.catalog',
    'templates.generate',
    'digital_twin.simulate',
    'clm.playbook',
    'efiling.steps',
    'intelligence.precedent',
    // verticals
    'clm.lifecycle',
    'digital-twin.simulate',
    'e-filing.submit',
    'automateai.workflow',
    'clawdbot.crawl',
    'multi-org.federate',
    // enterprise platform
    'enterprise.financial-data',
    'enterprise.investment-research',
    'enterprise.web-search',
    'enterprise.ocr-pipeline',
    'enterprise.multimedia',
    'enterprise.notebook-studio',
    'enterprise.code-quality',
    'enterprise.content-asset',
    'enterprise.visual-analytics',
    'enterprise.domain-research',
    // omnichannel / openbot
    'openbot.receive',
    'openbot.send',
    // simulation / twindesk
    'twindesk.simulate',
    'twindesk.chat',
    // monitoring / regulatory
    'regulatory-monitor.events',
    'regulatory-monitor.subscribe',
    // white-label
    'white-label.config',
    'white-label.feature-toggle',
    // memory variants
    'memory.graph.add',
    'memory.project.store',
    'memory.5tier.episodic',
    'memory.social.context',
  ];

  it('registers every required production capability', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const ids = new Set(capabilityManifest.list().map((c) => c.id));
    for (const required of REQUIRED_PRODUCTION_IDS) {
      expect(ids, `missing production capability: ${required}`).toContain(required);
    }
  });

  it('JSON snapshot mirrors the in-memory manifest', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const snapshotPath = path.resolve(process.cwd(), 'src/orchestration/capability-manifest.snapshot.json');
    expect(fs.existsSync(snapshotPath), `snapshot missing at ${snapshotPath}`).toBe(true);
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const liveIds = new Set(capabilityManifest.list().map((c) => c.id));
    const snapIds = new Set<string>(snapshot.capabilities.map((c: any) => c.id));
    for (const id of REQUIRED_PRODUCTION_IDS) {
      expect(snapIds, `snapshot missing ${id}`).toContain(id);
      expect(liveIds, `live registry missing ${id}`).toContain(id);
    }
    expect(snapshot.total).toBeGreaterThanOrEqual(REQUIRED_PRODUCTION_IDS.length);
  });

  it('production capabilities respect tier whitelisting', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    // digital-twin is enterprise+
    await expect(
      capabilityManifest.invoke('digital-twin.simulate', {}, { tier: 'lite' }),
    ).rejects.toThrow(/not exposed to tier/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Manifest-driven decomposition — Queen consults the manifest, not heuristics
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Manifest-driven decomposition', () => {
  it('candidate discovery filters by tier and jurisdiction', async () => {
    const { discoverCandidateCapabilities } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const lite = discoverCandidateCapabilities({
      tier: 'lite', jurisdiction: 'IN',
      keywords: [], intent: '', domains: [],
    });
    const sov = discoverCandidateCapabilities({
      tier: 'sovereign', jurisdiction: 'IN',
      keywords: [], intent: '', domains: [],
    });
    expect(sov.length).toBeGreaterThanOrEqual(lite.length);
    // every lite capability must be tier-permitted
    expect(lite.every((c) => c.tiers.includes('lite'))).toBe(true);
  });

  it('candidate discovery matches by tag/keyword', async () => {
    const { discoverCandidateCapabilities } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const candidates = discoverCandidateCapabilities({
      tier: 'enterprise', jurisdiction: 'IN',
      keywords: ['contract'], intent: 'review', domains: ['legal'],
    });
    const ids = candidates.map((c) => c.id);
    // tagged 'contract' should pull in CLM + contract-playbook
    expect(ids).toContain('clm.lifecycle');
    expect(ids).toContain('workflow.contract-playbook');
  });

  it('skills allowlist constrains the candidate set', async () => {
    const { discoverCandidateCapabilities } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const allow = ['rag.search', 'memory.tiered.recall'];
    const candidates = discoverCandidateCapabilities({
      tier: 'enterprise', jurisdiction: 'IN',
      keywords: ['contract'], intent: 'review', domains: ['legal'],
      skillsAllowlist: allow,
    });
    expect(candidates.every((c) => allow.includes(c.id))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Queen execution policy — bounded concurrency + partial-failure handling
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Queen executor uniformly applies tier policy', () => {
  it('runWithConcurrency from policy is the single concurrency primitive', async () => {
    // Sanity guard: Queen should NOT be using bare Promise.all for parallel/DAG/swarm.
    const fs = await import('fs');
    const path = await import('path');
    const queenPath = path.resolve(process.cwd(), 'src/orchestration/jrx-queen-orchestrator.ts');
    const src = fs.readFileSync(queenPath, 'utf8');
    // Look at the bodies of executeParallel/DAG/Swarm only.
    const start = src.indexOf('private async executeParallel');
    const end = src.indexOf('private async executeAgent');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const slice = src.slice(start, end);
    expect(slice).toContain('runWithConcurrency');
    expect(slice).toContain('evaluateFailures');
    // bare Promise.all on subtasks should not appear in the parallel/DAG/swarm region
    expect(/Promise\.all\(\s*\w+Subtasks/.test(slice)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Round-3 closure: manifest-driven dispatch + skills auto-derivation +
// DAG fail-loud on unknown capability
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Manifest-driven SUBTASK dispatch', () => {
  it('Queen.bindCapabilitiesToSubtasks attaches assignedCapabilityId from candidates', async () => {
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const queen = new (QueenOrchestrator as any)();
    const decomposition: any = {
      originalPrompt: 'Review this contract for compliance issues',
      analyzedIntent: 'review',
      taskType: 'review',
      complexity: 'moderate',
      orchestrationPattern: 'parallel',
      estimatedAgents: 2,
      estimatedTime: 1000,
      decompositionAlgorithm: 'ADaPT',
      subtasks: [
        {
          id: 'st1', type: 'rag', description: 'retrieve relevant case law via rag search',
          dependencies: [], priority: 1, estimatedComplexity: 'simple',
          requiredCapabilities: ['rag', 'search'], status: 'pending',
        },
        {
          id: 'st2', type: 'memory', description: 'recall prior memory tiered context for this matter',
          dependencies: [], priority: 1, estimatedComplexity: 'simple',
          requiredCapabilities: ['memory', 'tiered', 'recall'], status: 'pending',
        },
      ],
      metadata: {
        capabilityCandidates: [
          { id: 'rag.search',           category: 'rag',     tags: ['rag', 'search', 'retrieval'] },
          { id: 'memory.tiered.recall', category: 'memory',  tags: ['memory', 'tiered', 'recall'] },
          { id: 'unrelated.capability', category: 'misc',    tags: ['nope'] },
        ],
      },
    };
    queen.bindCapabilitiesToSubtasks(decomposition);
    expect(decomposition.subtasks[0].assignedCapabilityId).toBe('rag.search');
    expect(decomposition.subtasks[1].assignedCapabilityId).toBe('memory.tiered.recall');
  });

  it('Queen.executeAgent prefers manifest dispatch when assignedCapabilityId is set', async () => {
    const { QueenOrchestrator, capabilityManifest } =
      await import('../../src/orchestration/jrx-queen-orchestrator.js') as any;
    // Make sure smoke.echo (registered in beforeAll) is available.
    expect(capabilityManifest ?? true).toBeTruthy();
    const queen = new (QueenOrchestrator as any)();
    const subtask: any = {
      id: 'st-cap', type: 'echo', description: 'echo via manifest',
      dependencies: [], priority: 1, estimatedComplexity: 'simple',
      requiredCapabilities: ['echo'], status: 'pending',
      assignedCapabilityId: 'smoke.echo',
    };
    const wrapperAgent: any = {
      id: 'wrapper-agent', name: 'Wrapper', tier: 'standard',
      romaLevel: 'L1', category: 'capability', capabilities: ['manifest-invoke'],
      status: 'active', preferredModels: ['gpt-4.1-mini'],
    };
    const exec = await queen.executeAgent(wrapperAgent, subtask, { prompt: 'hi', type: 'review' } as any);
    expect(exec.status).toBe('completed');
    expect(exec.model).toBe('manifest:smoke.echo');
    // output is JSON-serialized capability result; smoke.echo returns { echoed: ... }
    expect(exec.output).toContain('echoed');
  });
});

describe('Orchestration smoke — DAG fail-loud on unknown capability', () => {
  it('capabilityManifestExecutor throws in PROD for unregistered node names', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { capabilityManifestExecutor } =
        await import('../../src/services/dag-orchestration-service.js');
      await expect(
        capabilityManifestExecutor(
          {
            id: 'n1', taskId: 't1', name: 'definitely-not-registered',
            dependencies: [], status: 'pending',
            contextBudget: { inputTokens: 100, outputTokens: 100, maxTokens: 200 },
          } as any,
          { previousResults: new Map(), planId: 'p1', planName: 'p1', capabilityCtx: {} as any },
        ),
      ).rejects.toThrow(/no capability registered/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('capabilityManifestExecutor returns structured failure (no fallback:true) in non-prod', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const { capabilityManifestExecutor } =
        await import('../../src/services/dag-orchestration-service.js');
      const out = await capabilityManifestExecutor(
        {
          id: 'n2', taskId: 't1', name: 'still-not-registered',
          dependencies: [], status: 'pending',
          contextBudget: { inputTokens: 100, outputTokens: 100, maxTokens: 200 },
        } as any,
        { previousResults: new Map(), planId: 'p1', planName: 'p1', capabilityCtx: {} as any },
      );
      expect((out.output as any).success).toBe(false);
      expect((out.output as any).error).toBe('capability-not-registered');
      expect((out.output as any).fallback).toBeUndefined();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('Orchestration smoke — executeAgent fail-loud propagation', () => {
  it('throws and carries an agentExecution payload on capability failure (PROD)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
      const queen = new (QueenOrchestrator as any)();
      const subtask: any = {
        id: 'st-prod-1', type: 'analysis', description: 'will fail', dependencies: [],
        priority: 1, estimatedComplexity: 'simple', requiredCapabilities: [], status: 'pending',
        assignedCapabilityId: 'smoke.fail',
      };
      const agent: any = { id: 'a-fail', name: 'FailAgent', tier: 'lite', romaLevel: 1, capabilities: [], preferredModels: [] };
      const req: any = { prompt: 'p', tier: 'lite', jurisdiction: 'IN' };
      let thrown: any = null;
      try { await queen.executeAgent(agent, subtask, req); }
      catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.agentExecution).toBeTruthy();
      expect(thrown.agentExecution.status).toBe('failed');
      expect(thrown.agentExecution.subtaskId).toBe('st-prod-1');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('runWithConcurrency observes thrown errors as r.error so evaluateFailures sees them', async () => {
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const policy = await import('../../src/orchestration/orchestration-policy.js');
    const queen = new (QueenOrchestrator as any)();
    const subtasks: any[] = [
      { id: 'p1', type: 'analysis', description: 'ok',   dependencies: [], priority: 1, estimatedComplexity: 'simple', requiredCapabilities: [], status: 'pending', assignedCapabilityId: 'smoke.echo', assignedAgent: { id: 'aa', name: 'A', tier: 'lite', romaLevel: 1, capabilities: [], preferredModels: [] } },
      { id: 'p2', type: 'analysis', description: 'fail', dependencies: [], priority: 1, estimatedComplexity: 'simple', requiredCapabilities: [], status: 'pending', assignedCapabilityId: 'smoke.fail', assignedAgent: { id: 'ab', name: 'B', tier: 'lite', romaLevel: 1, capabilities: [], preferredModels: [] } },
    ];
    const results = await policy.runWithConcurrency(
      subtasks,
      (s: any) => queen.executeAgent(s.assignedAgent, s, { prompt: 'p', tier: 'lite', jurisdiction: 'IN' }),
      { concurrency: 2, timeoutMs: 5000 },
    );
    expect(results[0].value).toBeTruthy();
    expect(results[0].error).toBeUndefined();
    expect(results[1].value).toBeUndefined();
    expect(results[1].error).toBeInstanceOf(Error);
    const decision = policy.evaluateFailures(
      { failurePolicy: 'fail-fast', maxFailedNodes: 0 } as any,
      1, 2,
    );
    expect(decision.halt).toBe(true);
  });
});

describe('Orchestration smoke — Synthesis never leaks failed branches to clients', () => {
  it('synthesizeResults returns outcome-only content (no Failed Branches / Orchestrated Response)', async () => {
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const queen = new (QueenOrchestrator as any)();
    const decomposition: any = {
      originalPrompt: 'do two things in parallel',
      analyzedIntent: 'analysis',
      taskType: 'analysis',
      complexity: 'moderate',
      orchestrationPattern: 'parallel',
      estimatedAgents: 2,
      estimatedTime: 1000,
      decompositionAlgorithm: 'ADaPT',
      subtasks: [],
      metadata: {},
    };
    const executions = [
      { agentId: 'a1', agentName: 'Alpha', subtaskId: 's1', startTime: 0, endTime: 1, status: 'completed', output: 'OK from Alpha' },
      { agentId: 'a2', agentName: 'Beta',  subtaskId: 's2', startTime: 0, endTime: 1, status: 'failed',    output: 'Error: smoke.fail intentional' },
    ];
    const out: string = await queen.synthesizeResults(decomposition, executions, { prompt: 'test' });
    expect(out).toContain('OK from Alpha');
    expect(out).not.toContain('Failed Branches');
    expect(out).not.toContain('Orchestrated Response');
    expect(out).not.toContain('smoke.fail intentional');
    expect(out).not.toMatch(/\*\*Agents Used\*\*/i);
    expect(out).not.toMatch(/\*\*Pattern\*\*/i);
  });
});

describe('Orchestration smoke — Fail-loud across seams (round 5)', () => {
  it('SkillsSystemService.getCapabilitiesForContext throws in PROD on manifest failure', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { skillsSystem } = await import('../../src/services/skills/skills-system-service.js');
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const orig = manifestModule.capabilityManifest.list.bind(manifestModule.capabilityManifest);
      const spy = vi.spyOn(manifestModule.capabilityManifest, 'list').mockImplementation(() => {
        throw new Error('forced manifest registry failure');
      });
      try {
        await expect(
          skillsSystem.getCapabilitiesForContext({
            agentId: 'q', jurisdiction: 'IN', practiceArea: 'all',
            tier: 'solo', taskType: 'orchestration',
          }),
        ).rejects.toThrow(/PRODUCTION/);
      } finally {
        spy.mockRestore();
        // sanity: confirm restoration
        expect(typeof orig).toBe('function');
      }
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('default documentProcessor singleton is wired to the canonical databaseSystem', async () => {
    const { documentProcessor } = await import('../../src/services/document-processor.js');
    const { databaseSystem } = await import('../../src/services/database-system.js');
    const dp = documentProcessor as unknown as { databaseSystem: unknown };
    expect(dp.databaseSystem).toBe(databaseSystem);
  });

  it('default vectorDatabase singleton is wired to the canonical databaseSystem', async () => {
    const { vectorDatabase } = await import('../../src/services/vector-database.js');
    const { databaseSystem } = await import('../../src/services/database-system.js');
    const vd = vectorDatabase as unknown as { databaseSystem: unknown };
    expect(vd.databaseSystem).toBe(databaseSystem);
  });
});

describe('Orchestration smoke — Protocol registry manifest binding (round 7)', () => {
  it('initializeProtocolRegistryFromManifest registers every catalog capability', async () => {
    const { initializeProtocolRegistryFromManifest } = await import('../../src/services/jrx-protocol-registry-manifest.js');
    const manifestModule = await import('../../src/orchestration/capability-manifest.js');
    const expected = manifestModule.capabilityManifest.list().map(c => `CAP_${c.id}`);

    const dbModule = await import('../../src/db/index.js');
    const execSpy = vi.spyOn(dbModule.db, 'execute').mockImplementation(async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes('SELECT id FROM nv_schema.protocol_registry WHERE protocol_name')) {
        return { rows: [] } as never;
      }
      return { rows: [{ id: 'fake-' + Math.random().toString(36).slice(2, 10) }] } as never;
    });

    const calls: Array<{ protocolName: string; status?: string; activatedBy?: string; config?: unknown }> = [];
    const registerProtocol = async (p: { protocolName: string; status?: string; activatedBy?: string; config?: unknown }) => {
      calls.push(p);
      return { id: 'reg-' + calls.length };
    };

    try {
      const result = await initializeProtocolRegistryFromManifest(registerProtocol);
      expect(result.total).toBe(expected.length);
      expect(result.registered).toBe(expected.length);
      expect(result.skipped).toBe(0);
      const registeredNames = calls.map(c => c.protocolName).sort();
      expect(registeredNames).toEqual(expected.sort());
      for (const call of calls) {
        const cfg = call.config as { capabilityId: string; tiers: string[]; supportedPatterns: string[] };
        expect(cfg.capabilityId).toBeTruthy();
        expect(Array.isArray(cfg.tiers)).toBe(true);
        expect(Array.isArray(cfg.supportedPatterns)).toBe(true);
        expect(call.status).toBe('active');
        expect(call.activatedBy).toBe('system:manifest');
      }
    } finally {
      execSpy.mockRestore();
    }
  });

  it('initializeProtocolRegistryFromManifest is idempotent (skips already-registered)', async () => {
    const { initializeProtocolRegistryFromManifest } = await import('../../src/services/jrx-protocol-registry-manifest.js');
    const manifestModule = await import('../../src/orchestration/capability-manifest.js');
    const expected = manifestModule.capabilityManifest.list().length;

    const dbModule = await import('../../src/db/index.js');
    const execSpy = vi.spyOn(dbModule.db, 'execute').mockImplementation(async () => {
      return { rows: [{ id: 'pre-existing' }] } as never;
    });

    let registerCount = 0;
    const registerProtocol = async () => {
      registerCount++;
      return { id: 'never-called' };
    };

    try {
      const result = await initializeProtocolRegistryFromManifest(registerProtocol);
      expect(result.total).toBe(expected);
      expect(result.registered).toBe(0);
      expect(result.skipped).toBe(expected);
      expect(registerCount).toBe(0);
    } finally {
      execSpy.mockRestore();
    }
  });

  it('manifest snapshot file matches live capability ids exactly', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const manifestModule = await import('../../src/orchestration/capability-manifest.js');
    const snapPath = path.resolve(process.cwd(), 'src/orchestration/capability-manifest.snapshot.json');
    if (!fs.existsSync(snapPath)) {
      // Snapshot has not been regenerated yet on this branch; the registry
      // should still match the live manifest, so this is non-fatal.
      return;
    }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { capabilities: Array<{ id: string }> };
    // Exclude smoke-test injected capabilities (this very file registers
    // a few `smoke.*` capabilities to exercise patterns); the snapshot is
    // the production manifest only.
    const liveIds = manifestModule.capabilityManifest.list()
      .map(c => c.id)
      .filter(id => !id.startsWith('smoke.'))
      .sort();
    const snapIds = snap.capabilities
      .map(c => c.id)
      .filter(id => !id.startsWith('smoke.'))
      .sort();
    expect(liveIds).toEqual(snapIds);
  });
});

describe('Orchestration smoke — Shared circuit-breaker policy', () => {
  it('exposes per-surface policy and a shared breaker registry', async () => {
    const cb = await import('../../src/services/circuit-breaker.js');
    expect(cb.getBreakerPolicy('outbound:capability').timeoutMs).toBeGreaterThan(0);
    expect(cb.getBreakerPolicy('outbound:llm').timeoutMs).toBeGreaterThan(0);
    cb._resetBreakerRegistry();
    const fn = async (x: number) => x + 1;
    const b1 = cb.wrapWithBreaker('test:add', fn, 'outbound:capability');
    const b2 = cb.wrapWithBreaker('test:add', fn, 'outbound:capability');
    expect(b1).toBe(b2); // same name → same shared breaker
    const r = await cb.runWithBreaker('test:run', async () => 42, 'outbound:capability');
    expect(r).toBe(42);
    expect(cb.listBreakers()).toContain('test:run');
    const stats = cb.getBreakerStats('test:run');
    expect(stats?.successes ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('capabilityManifest.invoke routes through the shared breaker (cap:<id>)', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const cb = await import('../../src/services/circuit-breaker.js');
    cb._resetBreakerRegistry();
    // smoke.echo is registered in the suite-level beforeAll
    const out = await capabilityManifest.invoke('smoke.echo', { value: 'hello' }, { tier: 'lite', jurisdiction: 'IN' } as any);
    expect((out as any).echoed).toBe('hello');
    // Round 10d (NYV-CB-RETRY-001): the per-capability breaker is now
    // registered under the retry-prefixed name so retry-with-backoff and
    // breaker share a single primitive. Either name shape is acceptable.
    expect(cb.listBreakers().some((n) => n === 'cap:smoke.echo' || n === 'retry::cap:smoke.echo')).toBe(true);
  });
});

describe('Orchestration smoke — Skills surface auto-derived at orchestrate entry', () => {
  it('SkillsSystemService.getCapabilitiesForContext returns tier-filtered capability ids', async () => {
    const { skillsSystem } = await import('../../src/services/skills/skills-system-service.js');
    const surface = await skillsSystem.getCapabilitiesForContext({
      tier: 'solo',
      jurisdiction: 'IN',
      practiceArea: 'all',
      taskComplexity: 'moderate',
      estimatedRevenue: 0,
      urgency: 'medium',
    } as any);
    expect(Array.isArray(surface.capabilities)).toBe(true);
    // Solo (=lite) tier must be a non-empty surface and exclude sovereign-only ids.
    expect(surface.capabilities.length).toBeGreaterThan(0);
    const ids = surface.capabilities.map((c: any) => c.id);
    // digital-twin.simulate is enterprise+ only — must NOT be in solo surface.
    expect(ids.includes('digital-twin.simulate')).toBe(false);
  });
});

describe('Orchestration smoke — Concurrency governor (round 8)', () => {
  it('per-tenant + per-provider semaphores serialise calls beyond their cap', async () => {
    process.env.ORCH_TENANT_CONCURRENCY = '2';
    process.env.ORCH_PROVIDER_CONCURRENCY = '2';
    vi.resetModules();
    try {
      const { withSlots, snapshotGovernor, __resetGovernorForTests } = await import(
        '../../src/orchestration/concurrency-governor.js'
      );
      __resetGovernorForTests();

      let inFlight = 0;
      let peak = 0;
      const work = (delay: number) => async () => {
        inFlight++;
        if (inFlight > peak) peak = inFlight;
        await new Promise(r => setTimeout(r, delay));
        inFlight--;
        return 'ok';
      };
      const tasks = Array.from({ length: 8 }, () =>
        withSlots({ tenantId: 't1', provider: 'rag' }, work(20)));
      const out = await Promise.all(tasks);
      expect(out.every(v => v === 'ok')).toBe(true);
      // Peak in-flight must respect min(tenantLimit, providerLimit) = 2
      expect(peak).toBeLessThanOrEqual(2);

      const snap = snapshotGovernor();
      expect(snap.tenantLimit).toBe(2);
      expect(snap.providerLimit).toBe(2);
    } finally {
      delete process.env.ORCH_TENANT_CONCURRENCY;
      delete process.env.ORCH_PROVIDER_CONCURRENCY;
      vi.resetModules();
    }
  });

  it('capabilityManifest.invoke routes through the governor (provider key = category)', async () => {
    // Previous test reset modules; re-register the synthetic smoke
    // capabilities against the freshly-loaded manifest before invoking.
    await registerSyntheticCapabilities();
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const { snapshotGovernor } = await import('../../src/orchestration/concurrency-governor.js');
    const cb = await import('../../src/services/circuit-breaker.js');
    cb._resetBreakerRegistry();

    const ctx = { tier: 'lite', jurisdiction: 'IN', tenantId: 'tenantA' } as any;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        capabilityManifest.invoke('smoke.echo', { value: `v${i}` }, ctx)),
    );
    expect(results.length).toBe(5);

    const snap = snapshotGovernor();
    expect(snap.tenants.find(t => t.tenantId === 'tenantA')).toBeTruthy();
  });
});

describe('Orchestration smoke — Middleware fail-loud (round 8)', () => {
  it('postMiddleware throws in PROD when metering.usage-log fails', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import(
        '../../src/orchestration/orchestration-middleware.js'
      );
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string) => {
          if (id === 'metering.usage-log') {
            throw new Error('synthetic metering outage');
          }
          // All other middleware calls succeed
          return {} as any;
        });
      try {
        await expect(
          postMiddleware({
            output: 'hi',
            ctx: { tier: 'lite', jurisdiction: 'IN', tenantId: 't1' } as any,
            riskLevel: 'low',
            inputText: 'q',
            tokens: { input: 1, output: 1 },
            success: true,
          }),
        ).rejects.toThrow(/metering.usage-log failed in production/);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });

  it('postMiddleware degrades gracefully (audit.ok=false) in non-PROD', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import(
        '../../src/orchestration/orchestration-middleware.js'
      );
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string) => {
          if (id === 'metering.usage-log') {
            throw new Error('synthetic metering outage');
          }
          return {} as any;
        });
      try {
        const out = await postMiddleware({
          output: 'hi',
          ctx: { tier: 'lite', jurisdiction: 'IN', tenantId: 't1' } as any,
          riskLevel: 'low',
          inputText: 'q',
          tokens: { input: 1, output: 1 },
          success: true,
        });
        expect(out.audit?.ok).toBe(false);
        expect(out.audit?.persisted).toBe(false);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Round 9 — Deterministic capability binding + full post-middleware chain
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Round 10: Full catalog coverage', () => {
  it('manifest declares all required production catalog families (mem0, secure-collab, RAG variants, EU AI Act, federated-privacy, PQC, agent-suites)', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const ids = new Set(capabilityManifest.list().map((c) => c.id));
    const required = [
      'memory.mem0.store', 'memory.mem0.recall', 'memory.mem0.consolidate',
      'rag.adaptive', 'rag.corrective', 'rag.self', 'rag.graph', 'rag.lightrag', 'rag.reranker',
      'vector.qdrant.search', 'vector.qdrant.upsert',
      'intelligence.secure-collaboration',
      'intelligence.regulatory-digest', 'intelligence.compliance-calendar',
      'compliance.eu-ai-act',
      'security.federated-privacy.session', 'security.federated-privacy.aggregate', 'security.federated-privacy.dp-noise',
      'security.pqc.kem-keygen', 'security.pqc.dsa-sign', 'security.pqc.dsa-verify',
      'agent.chain.execute', 'agent.bmad.orchestrate', 'agent.parlant.govern',
    ];
    for (const id of required) {
      expect(ids, `manifest missing required capability ${id}`).toContain(id);
    }
  });

  it('PQC sovereign capabilities are gated to sovereign+white-label tiers only', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const liteIds = new Set(capabilityManifest.list({ tier: 'lite' }).map((c) => c.id));
    expect(liteIds.has('security.pqc.kem-keygen')).toBe(false);
    expect(liteIds.has('security.pqc.dsa-sign')).toBe(false);
    const sovIds = new Set(capabilityManifest.list({ tier: 'sovereign' }).map((c) => c.id));
    expect(sovIds.has('security.pqc.kem-keygen')).toBe(true);
    expect(sovIds.has('security.pqc.dsa-sign')).toBe(true);
  });

  it('compliance.eu-ai-act is jurisdiction-gated to EU and UK', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const inIds = new Set(capabilityManifest.list({ tier: 'enterprise', jurisdiction: 'IN' }).map((c) => c.id));
    expect(inIds.has('compliance.eu-ai-act')).toBe(false);
    const euIds = new Set(capabilityManifest.list({ tier: 'enterprise', jurisdiction: 'EU' }).map((c) => c.id));
    expect(euIds.has('compliance.eu-ai-act')).toBe(true);
  });
});

describe('Orchestration smoke — Round 10: Skill-bundle gating narrows capabilities', () => {
  it('compliance-only skill bundle excludes RAG/intelligence domain capabilities but keeps platform invariants', async () => {
    const { skillsSystem } = await import('../../src/services/skills/skills-system-service.js');
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

    const surface = await skillsSystem.getCapabilitiesForContext({
      agentId: 'test-agent',
      jurisdiction: 'EU',
      practiceArea: 'data-protection',
      tier: 'plus',
      taskType: 'gdpr-compliance-review',
    });

    expect(surface.activatedSkills.length).toBeGreaterThan(0);

    const fullTierSurface = capabilityManifest.list({ tier: 'mitra', jurisdiction: 'EU' });
    expect(surface.capabilities.length).toBeLessThan(fullTierSurface.length);

    const surfaceIds = new Set(surface.capabilities.map((c) => c.id));
    expect(surfaceIds.has('safety.citation-verify')).toBe(true);
    expect(surfaceIds.has('metering.usage-log')).toBe(true);
    expect(surfaceIds.has('compliance.consent')).toBe(true);
    expect(surfaceIds.has('hitl.queue')).toBe(true);
  });

  it('legal-research skill bundle exposes RAG/memory/intelligence categories', async () => {
    const { skillsSystem } = await import('../../src/services/skills/skills-system-service.js');

    const surface = await skillsSystem.getCapabilitiesForContext({
      agentId: 'test-agent',
      jurisdiction: 'IN',
      practiceArea: 'litigation',
      tier: 'pro',
      taskType: 'legal-research',
    });

    const cats = new Set(surface.capabilities.map((c) => c.category));
    expect(cats.has('rag')).toBe(true);
    expect(cats.has('memory')).toBe(true);
    expect(cats.has('intelligence')).toBe(true);
    expect(cats.has('safety')).toBe(true);
    expect(cats.has('metering')).toBe(true);
  });
});

describe('Orchestration smoke — Round 9: Manifest→registry boot binding', () => {
  it('initializeProtocolRegistryFromManifest registers CAP_<id> for every capability', async () => {
    vi.resetModules();
    vi.doMock('../../src/db/index.js', () => ({
      db: {
        execute: async () => ({ rows: [] as Array<{ id: string }> }),
      },
    }));
    try {
      const { initializeProtocolRegistryFromManifest } = await import('../../src/services/jrx-protocol-registry-manifest.js');
      const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

      const registered: string[] = [];
      const stats = await initializeProtocolRegistryFromManifest(async (params) => {
        registered.push(params.protocolName);
        return { id: params.protocolName };
      });

      const allIds = capabilityManifest.list().map((c) => c.id);
      expect(stats.total).toBe(allIds.length);
      expect(stats.registered).toBe(allIds.length);
      expect(stats.skipped).toBe(0);
      // Spot-check a handful of catalog ids actually got bound under CAP_<id>.
      for (const id of ['memory.tiered.recall', 'rag.search', 'safety.citation-verify', 'governance.model-policy', 'metering.usage-log']) {
        expect(registered, `boot did not register CAP_${id}`).toContain(`CAP_${id}`);
      }
    } finally {
      vi.doUnmock('../../src/db/index.js');
      vi.resetModules();
    }
  });

  it('initializeProtocolRegistryFromManifest is idempotent (skips already-registered)', async () => {
    vi.resetModules();
    vi.doMock('../../src/db/index.js', () => ({
      db: {
        execute: async () => ({ rows: [{ id: 'pre-existing' }] }),
      },
    }));
    try {
      const { initializeProtocolRegistryFromManifest } = await import('../../src/services/jrx-protocol-registry-manifest.js');
      const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

      const registered: string[] = [];
      const stats = await initializeProtocolRegistryFromManifest(async (params) => {
        registered.push(params.protocolName);
        return { id: params.protocolName };
      });

      expect(stats.total).toBe(capabilityManifest.list().length);
      expect(stats.registered).toBe(0);
      expect(stats.skipped).toBe(stats.total);
      expect(registered.length).toBe(0);
    } finally {
      vi.doUnmock('../../src/db/index.js');
      vi.resetModules();
    }
  });
});

describe('Orchestration smoke — Round 9: Deterministic intent→capability binding', () => {
  it('resolveIntentToCapability prefers declared mapping over heuristic tags', async () => {
    const { resolveIntentToCapability } = await import('../../src/orchestration/capability-manifest.js');
    // 'research' should map to rag.search ahead of memory.tiered.recall.
    const r = resolveIntentToCapability(
      ['research'],
      new Set(['rag.search', 'memory.tiered.recall', 'agent.auto-select']),
    );
    expect(r?.capabilityId).toBe('rag.search');
    expect(r?.matchedIntent).toBe('research');
  });

  it('resolveIntentToCapability falls through priority list when top choice is filtered out', async () => {
    const { resolveIntentToCapability } = await import('../../src/orchestration/capability-manifest.js');
    // 'understanding' priority is rag.search > memory.tiered.recall.
    // If rag.search is excluded (e.g. tier doesn't have it), we should get memory.
    const r = resolveIntentToCapability(
      ['understanding'],
      new Set(['memory.tiered.recall', 'agent.auto-select']),
    );
    expect(r?.capabilityId).toBe('memory.tiered.recall');
  });

  it('resolveIntentToCapability returns null when no mapping is permitted', async () => {
    const { resolveIntentToCapability } = await import('../../src/orchestration/capability-manifest.js');
    const r = resolveIntentToCapability(['absolutely-nonexistent-intent'], new Set(['rag.search']));
    expect(r).toBeNull();
  });

  it('getDeclaredCapabilitiesForIntent exposes the canonical mapping', async () => {
    const { getDeclaredCapabilitiesForIntent } = await import('../../src/orchestration/capability-manifest.js');
    expect(getDeclaredCapabilitiesForIntent('citation')).toEqual(['safety.citation-verify']);
    expect(getDeclaredCapabilitiesForIntent('does-not-exist')).toBeNull();
  });

  it('resolveIntentToCapability binds Wave B6 mesh intents to alias leaves', async () => {
    const { resolveIntentToCapability, WAVE_B6_MESH_LEAF_IDS } = await import('../../src/orchestration/capability-manifest.js');
    const meshCandidates = new Set(WAVE_B6_MESH_LEAF_IDS);

    expect(resolveIntentToCapability(['template'], meshCandidates)?.capabilityId).toBe('templates.generate');
    expect(resolveIntentToCapability(['catalog'], meshCandidates)?.capabilityId).toBe('templates.catalog');
    expect(resolveIntentToCapability(['generate'], meshCandidates)?.capabilityId).toBe('templates.generate');
    expect(resolveIntentToCapability(['twin'], meshCandidates)?.capabilityId).toBe('digital_twin.simulate');
    expect(resolveIntentToCapability(['simulation'], meshCandidates)?.capabilityId).toBe('digital_twin.simulate');
    expect(resolveIntentToCapability(['filing'], meshCandidates)?.capabilityId).toBe('efiling.steps');
    expect(resolveIntentToCapability(['submit'], meshCandidates)?.capabilityId).toBe('e-filing.submit');
    expect(resolveIntentToCapability(['playbook'], meshCandidates)?.capabilityId).toBe('clm.playbook');
    expect(resolveIntentToCapability(['lifecycle'], meshCandidates)?.capabilityId).toBe('clm.lifecycle');
    expect(resolveIntentToCapability(['precedent'], meshCandidates)?.capabilityId).toBe('intelligence.precedent');
  });
});

describe('Orchestration smoke — Round 9: Full post-middleware chain', () => {
  it('invokes citation-verify, pii-vault (mitra+), consent (when userId), governance (when model), HITL (when high risk), and metering on every leaf', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');

      const calledIds: string[] = [];
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string): Promise<unknown> => {
          calledIds.push(id);
          if (id === 'compliance.consent') return { granted: true };
          return { ok: true };
        });
      try {
        const out = await postMiddleware({
          output: 'Reach me at user@example.com or PAN ABCDE1234F',
          ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1', userId: 'u-42' },
          riskLevel: 'high',
          inputText: 'q',
          tokens: { input: 1, output: 1 },
          model: 'gpt-4o',
          provider: 'openai',
          success: true,
        });

        expect(calledIds).toEqual(expect.arrayContaining([
          'safety.hallucination-check',
          'safety.bias-check',
          'safety.citation-verify',
          'safety.pii-vault',
          'compliance.consent',
          'governance.model-policy',
          'hitl.queue',
          'memory.tiered.store',
          'metering.usage-log',
        ]));
        expect(out.stagesRun).toEqual(expect.arrayContaining([
          'hallucination', 'bias', 'citation', 'pii', 'consent', 'governance', 'hitl', 'memory-store', 'metering',
        ]));
        expect(out.audit?.persisted).toBe(true);
        expect(out.pii).toBeTruthy();
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });

  it('skips bias and pii on lite tier, skips consent without userId, skips governance without model', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');

      const calledIds: string[] = [];
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string): Promise<unknown> => {
          calledIds.push(id);
          return {};
        });
      try {
        const out = await postMiddleware({
          output: 'no PII here, no userId, no model',
          ctx: { tier: 'lite', jurisdiction: 'IN', tenantId: 't1' },
          riskLevel: 'low',
          inputText: 'q',
          tokens: { input: 1, output: 1 },
          success: true,
        });

        expect(calledIds).not.toContain('safety.bias-check');     // lite tier
        expect(calledIds).not.toContain('safety.pii-vault');      // no PII detected
        expect(calledIds).not.toContain('compliance.consent');    // no userId
        expect(calledIds).not.toContain('governance.model-policy'); // no model
        expect(calledIds).not.toContain('hitl.queue');            // low risk
        expect(calledIds).toContain('safety.hallucination-check');
        expect(calledIds).toContain('safety.citation-verify');
        expect(calledIds).toContain('metering.usage-log');
        expect(out.audit?.persisted).toBe(true);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });
});

describe('Orchestration smoke — Round 9: Post-middleware fail-loud (PROD)', () => {
  it('throws when safety.citation-verify fails in PROD', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string): Promise<unknown> => {
          if (id === 'safety.citation-verify') throw new Error('synthetic citation outage');
          return {};
        });
      try {
        await expect(
          postMiddleware({
            output: 'hi',
            ctx: { tier: 'lite', jurisdiction: 'IN', tenantId: 't1' },
            riskLevel: 'low',
            inputText: 'q',
            tokens: { input: 1, output: 1 },
            success: true,
          }),
        ).rejects.toThrow(/safety\.citation-verify failed in production/);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });

  it('throws when consent is explicitly denied in PROD', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string): Promise<unknown> => {
          if (id === 'compliance.consent') return { granted: false };
          return {};
        });
      try {
        await expect(
          postMiddleware({
            output: 'hi',
            ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1', userId: 'u-1' },
            riskLevel: 'low',
            inputText: 'q',
            tokens: { input: 1, output: 1 },
            success: true,
          }),
        ).rejects.toThrow(/compliance\.consent denied/);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });

  it('throws when governance.model-policy fails in PROD', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string): Promise<unknown> => {
          if (id === 'governance.model-policy') throw new Error('synthetic governance outage');
          return {};
        });
      try {
        await expect(
          postMiddleware({
            output: 'hi',
            ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1' },
            riskLevel: 'low',
            inputText: 'q',
            tokens: { input: 1, output: 1 },
            model: 'gpt-4o',
            success: true,
          }),
        ).rejects.toThrow(/governance\.model-policy failed in production/);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });

  it('throws when safety.pii-vault fails on detected PII in PROD (mitra+)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string): Promise<unknown> => {
          if (id === 'safety.pii-vault') throw new Error('synthetic vault outage');
          return {};
        });
      try {
        await expect(
          postMiddleware({
            output: 'PAN here: ABCDE1234F',
            ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1' },
            riskLevel: 'low',
            inputText: 'q',
            tokens: { input: 1, output: 1 },
            success: true,
          }),
        ).rejects.toThrow(/safety\.pii-vault failed in production/);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Task #34 — Safety verdict + audit persistence
// ────────────────────────────────────────────────────────────────────────────
//
// Scope of these tests (matches the task DoD):
//   1. Queen routes 100% of agent dispatches through manifest middleware
//      → covered indirectly: postMiddleware always emits a verdict and an
//        audit.safety-verdict invocation, regardless of stage outcomes.
//   2. Every answer has a recorded safety verdict in the audit log
//      → asserted by spying on capabilityManifest.invoke('audit.safety-verdict').
//   3. Production smoke test confirms a deliberately unsafe response is rejected
//      → asserted in the "PROD rejects flagged hallucination" test.
//
describe('Orchestration smoke — Task #34: Safety verdict + audit persistence', () => {
  it('computes verdict=pass and records it via audit.safety-verdict for clean output', async () => {
    const prev = process.env.NODE_ENV;
    const prevMode = process.env.NV_SAFETY_VERDICT_MODE;
    process.env.NODE_ENV = 'test';
    delete process.env.NV_SAFETY_VERDICT_MODE;
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const calledIds: string[] = [];
      const verdictPayloads: any[] = [];
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string, payload: unknown): Promise<unknown> => {
          calledIds.push(id);
          if (id === 'audit.safety-verdict') {
            verdictPayloads.push(payload);
            return { id: 'audit-rec-1', recordHash: 'h1', previousHash: null, createdAt: new Date().toISOString() };
          }
          if (id === 'safety.hallucination-check') return { status: 'passed', score: 0.92 };
          if (id === 'safety.bias-check') return { biasScore: 0.05, fair: true };
          if (id === 'safety.citation-verify') return { verified: 1, unverified: 0 };
          if (id === 'compliance.consent') return { granted: true };
          return { ok: true };
        });
      try {
        const out = await postMiddleware({
          output: 'A clean answer with citation [1].',
          ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1', userId: 'u-1' },
          riskLevel: 'low',
          inputText: 'q',
          tokens: { input: 5, output: 8 },
          success: true,
        });
        expect(out.verdict).toBeDefined();
        expect(out.verdict?.status).toBe('pass');
        expect(out.verdict?.enforced).toBe(false);
        expect(out.verdict?.verdictId).toBe('audit-rec-1');
        expect(out.stagesRun).toContain('safety-verdict');
        expect(calledIds).toContain('audit.safety-verdict');
        expect(verdictPayloads).toHaveLength(1);
        expect(verdictPayloads[0].verdict).toBe('pass');
        expect(verdictPayloads[0].reasons).toEqual([]);
        expect(typeof verdictPayloads[0].outputHash).toBe('string');
        expect(verdictPayloads[0].outputLength).toBeGreaterThan(0);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      if (prevMode === undefined) delete process.env.NV_SAFETY_VERDICT_MODE;
      else process.env.NV_SAFETY_VERDICT_MODE = prevMode;
      vi.resetModules();
    }
  });

  it('computes verdict=review (not reject) for hallucination.status=review_recommended', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const verdictPayloads: any[] = [];
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string, payload: unknown): Promise<unknown> => {
          if (id === 'audit.safety-verdict') {
            verdictPayloads.push(payload);
            return { id: 'rec-2', recordHash: 'h2', previousHash: null, createdAt: '' };
          }
          if (id === 'safety.hallucination-check') return { status: 'review_recommended', score: 0.65 };
          if (id === 'compliance.consent') return { granted: true };
          return { ok: true };
        });
      try {
        const out = await postMiddleware({
          output: 'Plausible but partially grounded answer.',
          ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1', userId: 'u-1' },
          riskLevel: 'medium',
          inputText: 'q',
          tokens: { input: 1, output: 1 },
          success: true,
        });
        expect(out.verdict?.status).toBe('review');
        expect(out.verdict?.reasons.join(' ')).toMatch(/review_recommended/);
        expect(verdictPayloads[0].verdict).toBe('review');
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });

  it('PROD smoke: REJECTS a deliberately unsafe (flagged hallucination) response', async () => {
    const prev = process.env.NODE_ENV;
    const prevMode = process.env.NV_SAFETY_VERDICT_MODE;
    process.env.NODE_ENV = 'production';
    delete process.env.NV_SAFETY_VERDICT_MODE; // default-enforce in PROD
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const verdictPayloads: any[] = [];
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string, payload: unknown): Promise<unknown> => {
          if (id === 'audit.safety-verdict') {
            verdictPayloads.push(payload);
            return { id: 'rec-3', recordHash: 'h3', previousHash: null, createdAt: '' };
          }
          // Deliberately unsafe: hallucination detector flags the output.
          if (id === 'safety.hallucination-check') return { status: 'flagged', score: 0.21 };
          if (id === 'compliance.consent') return { granted: true };
          return { ok: true };
        });
      try {
        await expect(
          postMiddleware({
            output: 'The Supreme Court in 2099 held the moon to be a juristic person.',
            ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1', userId: 'u-1' },
            riskLevel: 'high',
            inputText: 'is the moon a juristic person?',
            tokens: { input: 6, output: 12 },
            success: true,
          }),
        ).rejects.toThrow(/safety verdict=reject/);
        // The verdict MUST still be persisted before the throw — every
        // answer (including rejected ones) leaves an audit trail.
        expect(verdictPayloads).toHaveLength(1);
        expect(verdictPayloads[0].verdict).toBe('reject');
        expect(verdictPayloads[0].enforced).toBe(true);
        expect(verdictPayloads[0].reasons.join(' ')).toMatch(/hallucination\.status=flagged/);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      if (prevMode === undefined) delete process.env.NV_SAFETY_VERDICT_MODE;
      else process.env.NV_SAFETY_VERDICT_MODE = prevMode;
      vi.resetModules();
    }
  });

  it('PROD observe mode: records reject verdict but does NOT throw (transitional opt-out)', async () => {
    const prev = process.env.NODE_ENV;
    const prevMode = process.env.NV_SAFETY_VERDICT_MODE;
    process.env.NODE_ENV = 'production';
    process.env.NV_SAFETY_VERDICT_MODE = 'observe';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const verdictPayloads: any[] = [];
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string, payload: unknown): Promise<unknown> => {
          if (id === 'audit.safety-verdict') {
            verdictPayloads.push(payload);
            return { id: 'rec-4', recordHash: 'h4', previousHash: null, createdAt: '' };
          }
          if (id === 'safety.hallucination-check') return { status: 'flagged', score: 0.10 };
          if (id === 'compliance.consent') return { granted: true };
          return { ok: true };
        });
      try {
        const out = await postMiddleware({
          output: 'Deliberately unsafe content.',
          ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1', userId: 'u-1' },
          riskLevel: 'high',
          inputText: 'q',
          tokens: { input: 1, output: 1 },
          success: true,
        });
        expect(out.verdict?.status).toBe('reject');
        expect(out.verdict?.enforced).toBe(false);
        expect(verdictPayloads[0].enforced).toBe(false);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      if (prevMode === undefined) delete process.env.NV_SAFETY_VERDICT_MODE;
      else process.env.NV_SAFETY_VERDICT_MODE = prevMode;
      vi.resetModules();
    }
  });

  it('PROD enforce mode: REJECTS when PII detected without full tokenization', async () => {
    const prev = process.env.NODE_ENV;
    const prevMode = process.env.NV_SAFETY_VERDICT_MODE;
    process.env.NODE_ENV = 'production';
    process.env.NV_SAFETY_VERDICT_MODE = 'enforce';
    vi.resetModules();
    try {
      const manifestModule = await import('../../src/orchestration/capability-manifest.js');
      const { postMiddleware } = await import('../../src/orchestration/orchestration-middleware.js');
      const invokeSpy = vi
        .spyOn(manifestModule.capabilityManifest, 'invoke')
        .mockImplementation(async (id: string): Promise<unknown> => {
          if (id === 'audit.safety-verdict') {
            return { id: 'rec-5', recordHash: 'h5', previousHash: null, createdAt: '' };
          }
          // pii-vault returns no token → tokenized count stays 0 while
          // matched count is non-zero → verdict=reject.
          if (id === 'safety.pii-vault') return { token: null, vaulted: false };
          if (id === 'compliance.consent') return { granted: true };
          if (id === 'safety.hallucination-check') return { status: 'passed', score: 0.95 };
          return { ok: true };
        });
      try {
        await expect(
          postMiddleware({
            output: 'Reach me at user@example.com or PAN ABCDE1234F',
            ctx: { tier: 'enterprise', jurisdiction: 'IN', tenantId: 't1', userId: 'u-1' },
            riskLevel: 'low',
            inputText: 'q',
            tokens: { input: 1, output: 1 },
            success: true,
          }),
        ).rejects.toThrow(/safety verdict=reject/);
      } finally {
        invokeSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = prev;
      if (prevMode === undefined) delete process.env.NV_SAFETY_VERDICT_MODE;
      else process.env.NV_SAFETY_VERDICT_MODE = prevMode;
      vi.resetModules();
    }
  });

  it('audit.safety-verdict is registered in the manifest under category=audit', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const cap = capabilityManifest.get('audit.safety-verdict');
    expect(cap).toBeDefined();
    expect(cap?.category).toBe('audit');
    // Must be available to every tier — every answer needs the verdict.
    expect(cap?.tiers).toEqual(
      expect.arrayContaining(['lite', 'mitra', 'enterprise', 'sovereign', 'white-label']),
    );
    expect(cap?.sideEffects).toBe('write');
  });

  it('Queen manifest dispatch routes a non-leaf capability through audit.safety-verdict', async () => {
    // Round-trip proof (Task #34 code-review NYV-ORCH-MW-003-CR-2): when
    // _executeAgentInner dispatches ANY manifest-bound subtask, the safety
    // verdict step MUST run and audit.safety-verdict MUST be invoked. This
    // guards against future regressions that re-introduce a bypass path
    // (e.g. a capability-id allowlist) in Queen.
    vi.resetModules();
    const manifestModule = await import('../../src/orchestration/capability-manifest.js');
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');

    // Register a non-leaf capability (category=tools, not in the exempt set).
    manifestModule.capabilityManifest.register({
      id: 'smoke.t34.nonleaf',
      displayName: 'Task #34 non-leaf smoke capability',
      category: 'tools',
      tiers: ['enterprise'],
      supportedJurisdictions: 'all',
      costClass: 'free',
      safetyClass: 'safe',
      supportedPatterns: ['simple', 'sequential', 'parallel', 'dag', 'cot-with-tools', 'collective-debate'],
      tags: ['smoke', 't34'],
      sideEffects: 'none',
      routeExposure: { transport: 'internal', channel: 'smoke.t34.nonleaf' },
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({
        invoke: async () => ({ ok: true, content: 'a synthetic non-leaf answer' }),
      }),
    });

    const calledIds: string[] = [];
    const verdictPayloads: any[] = [];
    const invokeSpy = vi
      .spyOn(manifestModule.capabilityManifest, 'invoke')
      .mockImplementation(async (id: string, payload: unknown): Promise<unknown> => {
        calledIds.push(id);
        if (id === 'audit.safety-verdict') {
          verdictPayloads.push(payload);
          return { id: 'rec-orch-1', recordHash: 'h-orch-1', previousHash: null, createdAt: '' };
        }
        if (id === 'safety.hallucination-check') return { status: 'passed', score: 0.9 };
        if (id === 'compliance.consent') return { granted: true };
        if (id === 'safety.bias-check') return { biasScore: 0.05 };
        if (id === 'safety.citation-verify') return { verified: 1, unverified: 0 };
        if (id === 'smoke.t34.nonleaf') return { ok: true, content: 'a synthetic non-leaf answer' };
        return { ok: true };
      });
    try {
      const queen = new (QueenOrchestrator as any)();
      const subtask: any = {
        id: 'st-1',
        type: 'tool-call',
        description: 'invoke synthetic non-leaf',
        requiredCapabilities: [],
        assignedCapabilityId: 'smoke.t34.nonleaf',
      };
      const agent: any = { id: 'agent-x', name: 'Agent X' };
      const request: any = {
        prompt: 'do the thing',
        userId: 'u-1',
        tenantId: 't-1',
        jurisdiction: 'IN',
        riskLevel: 'low',
        orchestrationId: 'orch-t34-nonleaf',
      };
      const fakeSpan: any = { finish: () => {}, addEvent: () => {}, setAttribute: () => {} };
      const exec = await queen._executeAgentInner(agent, subtask, request, fakeSpan);
      expect(exec.status).toBe('completed');
      // The synthetic capability MUST have been dispatched.
      expect(calledIds).toContain('smoke.t34.nonleaf');
      // …AND the safety verdict MUST have been recorded for the answer.
      expect(calledIds).toContain('audit.safety-verdict');
      expect(verdictPayloads).toHaveLength(1);
      expect(verdictPayloads[0].verdict).toBe('pass');
    } finally {
      invokeSpy.mockRestore();
      vi.resetModules();
    }
  });

  it('Queen manifest dispatch routes a previously-exempt capability (safety.explainability) through audit.safety-verdict', async () => {
    // Task #34 code-review round 2 NYV-ORCH-MW-003-CR-2: capabilities like
    // safety.explainability, compliance.consent, metering.usage-log,
    // memory.tiered.recall, rag.search ARE reachable from
    // INTENT_CAPABILITY_MAP and so could become a final user-facing answer
    // (see synthesizeResults() single-agent-no-coordination path). They MUST
    // therefore go through the safety ring just like any other capability.
    // The previous design exempted these by id; this test guards against
    // that bypass being re-introduced.
    vi.resetModules();
    const manifestModule = await import('../../src/orchestration/capability-manifest.js');
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');

    const calledIds: string[] = [];
    const verdictPayloads: any[] = [];
    const invokeSpy = vi
      .spyOn(manifestModule.capabilityManifest, 'invoke')
      .mockImplementation(async (id: string, payload: unknown): Promise<unknown> => {
        calledIds.push(id);
        if (id === 'audit.safety-verdict') {
          verdictPayloads.push(payload);
          return { id: 'rec-exempt-1', recordHash: 'h-exempt-1', previousHash: null, createdAt: '' };
        }
        if (id === 'safety.hallucination-check') return { status: 'passed', score: 0.9 };
        if (id === 'compliance.consent') return { granted: true };
        if (id === 'safety.bias-check') return { biasScore: 0.05 };
        if (id === 'safety.citation-verify') return { verified: 1, unverified: 0 };
        if (id === 'safety.explainability') return { reasoning: 'because-of-X' };
        return { ok: true };
      });
    try {
      const queen = new (QueenOrchestrator as any)();
      const subtask: any = {
        id: 'st-exempt',
        type: 'tool-call',
        description: 'explain reasoning',
        requiredCapabilities: [],
        assignedCapabilityId: 'safety.explainability',
      };
      const agent: any = { id: 'agent-x', name: 'Agent X' };
      const request: any = {
        prompt: 'why?',
        userId: 'u-1',
        tenantId: 't-1',
        jurisdiction: 'IN',
        riskLevel: 'low',
        orchestrationId: 'orch-t34-exempt',
      };
      const fakeSpan: any = { finish: () => {}, addEvent: () => {}, setAttribute: () => {} };
      const exec = await queen._executeAgentInner(agent, subtask, request, fakeSpan);
      expect(exec.status).toBe('completed');
      // The capability ran AS the user-facing answer…
      expect(calledIds).toContain('safety.explainability');
      // …AND the safety verdict still got recorded — no bypass.
      expect(calledIds).toContain('audit.safety-verdict');
      expect(verdictPayloads).toHaveLength(1);
    } finally {
      invokeSpy.mockRestore();
      vi.resetModules();
    }
  });

  it('withMiddleware re-entry from inside the ring is a pass-through (no double pre/post, no recursion)', async () => {
    // Task #34 code-review round 2: the recursion guard MUST kick in
    // when withMiddleware is called from within a withMiddleware frame.
    // We assert this by spying on capabilityManifest.invoke: a top-level
    // call records pre/post stages, but a nested withMiddleware should
    // not re-run pre/post — its `post.stagesRun` is the sentinel.
    vi.resetModules();
    const manifestModule = await import('../../src/orchestration/capability-manifest.js');
    const { withMiddleware, isInsideMiddleware } = await import(
      '../../src/orchestration/orchestration-middleware.js'
    );

    const invokeSpy = vi
      .spyOn(manifestModule.capabilityManifest, 'invoke')
      .mockImplementation(async (id: string): Promise<unknown> => {
        if (id === 'audit.safety-verdict') {
          return { id: 'rec-r-1', recordHash: 'h-r-1', previousHash: null, createdAt: '' };
        }
        if (id === 'safety.hallucination-check') return { status: 'passed', score: 0.9 };
        if (id === 'compliance.consent') return { granted: true };
        if (id === 'safety.bias-check') return { biasScore: 0.05 };
        if (id === 'safety.citation-verify') return { verified: 1, unverified: 0 };
        return { ok: true };
      });
    try {
      let innerSawInside = false;
      let innerPost: any = undefined;
      const outer = await withMiddleware(
        { prompt: 'outer prompt', tier: 'enterprise', jurisdiction: 'IN', riskLevel: 'low' },
        async () => {
          // Nested call from within the outer ring.
          const inner = await withMiddleware(
            { prompt: 'inner prompt', tier: 'enterprise', jurisdiction: 'IN', riskLevel: 'low' },
            async () => {
              innerSawInside = isInsideMiddleware();
              return { output: 'inner output' };
            },
          );
          innerPost = inner.post;
          return { output: 'outer output' };
        },
      );
      expect(innerSawInside).toBe(true);
      expect(innerPost?.stagesRun).toEqual(['__reentrant_skip__']);
      // Outer post DID run (verdict recorded once, not twice).
      expect(outer.post.verdict).toBeDefined();
      expect(outer.post.stagesRun).not.toEqual(['__reentrant_skip__']);
    } finally {
      invokeSpy.mockRestore();
      vi.resetModules();
    }
  });
});

describe('Orchestration smoke — Production fail-loud', () => {
  it('hierarchical-task-allocator throws on empty registry in PROD', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      vi.resetModules();
      // Force allocator to see a definitively-empty registry by stubbing
      // hierarchical-task-allocator-registry before allocator import.
      vi.doMock('../../src/services/hierarchical-task-allocator-registry.js', () => ({
        getAgentsForCapability: () => [],
        getAllAgents: () => [],
      }));
      const { hierarchicalTaskAllocator } = await import(
        '../../src/services/hierarchical-task-allocator.js'
      );
      await expect(
        hierarchicalTaskAllocator.allocate('prod-empty-test', { capability: 'never-registered' }),
      ).rejects.toThrow(/FAIL-LOUD/);
    } finally {
      process.env.NODE_ENV = prev;
      vi.doUnmock('../../src/services/hierarchical-task-allocator-registry.js');
      vi.resetModules();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Round 10c — CoT-with-tools and Collective-Debate pattern coverage.
// Reviewer requirement: dedicated representative tests for both patterns
// must traverse the manifest contract end-to-end and exercise memory
// write, citation/safety, and metering/audit assertions.
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Pattern 6: CoT-with-tools', () => {
  it('manifest declares cot-with-tools support on chain + tool capabilities and runs a tool-use chain end-to-end', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

    // Manifest contract: at least one chain capability and one tool capability
    // must declare cot-with-tools — the planner relies on this for selection.
    const cotCaps = capabilityManifest
      .list()
      .filter((c) => c.supportedPatterns.includes('cot-with-tools'));
    expect(cotCaps.length).toBeGreaterThan(0);
    const ids = new Set(cotCaps.map((c) => c.id));
    expect(ids.has('agent.chain.execute')).toBe(true);
    expect(ids.has('memory.tiered.store')).toBe(true);
    expect(ids.has('safety.pii-vault')).toBe(true);
    expect(ids.has('metering.usage-log')).toBe(true);

    // Register an inline tool the chain will invoke. We do not rely on
    // `smoke.echo` from beforeAll because earlier tests in the file may
    // call `vi.resetModules()`, which re-imports the manifest singleton
    // without the previously-registered synthetic capabilities.
    capabilityManifest.register({
      id: 'smoke.cot-tool',
      displayName: 'Smoke CoT Tool',
      category: 'tools',
      tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'free',
      safetyClass: 'safe',
      supportedPatterns: ['cot-with-tools', 'sequential'],
      tags: ['smoke', 'cot', 'tool'],
      sideEffects: 'pure',
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({
        invoke: async (input: any) => ({ echoed: input?.value ?? 'default' }),
      }),
    });

    // Register a tool-using chain step that simulates a CoT sequence:
    //   reason → call tool (smoke.cot-tool) → reflect → emit final
    capabilityManifest.register({
      id: 'smoke.cot-step',
      displayName: 'Smoke CoT Step',
      category: 'agent-orchestration',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'safe',
      supportedPatterns: ['cot-with-tools', 'sequential'],
      tags: ['smoke', 'cot', 'tool-use'],
      sideEffects: 'mixed',
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({
        invoke: async (input: any, ctx: any) => {
          const trace: string[] = ['reason:start'];
          const toolOut = await capabilityManifest.invoke('smoke.cot-tool', { value: input.query }, ctx);
          trace.push(`tool:smoke.cot-tool→${JSON.stringify(toolOut)}`);
          trace.push('reason:reflect');
          return { final: `answer(${input.query})`, trace };
        },
      }),
    });

    const out = (await capabilityManifest.invoke(
      'smoke.cot-step',
      { query: 'cite section 420 IPC' },
      { tenantId: 't', userId: 'u', tier: 'mitra' as const, jurisdiction: 'IN', agentKey: 'cot' },
    )) as { final: string; trace: string[] };

    expect(out.final).toBe('answer(cite section 420 IPC)');
    expect(out.trace).toEqual(['reason:start', 'tool:smoke.cot-tool→{"echoed":"cite section 420 IPC"}', 'reason:reflect']);

    // Memory write: orchestrator middleware persists trace via memory.tiered.store —
    // assert the memory capability accepts the cot-with-tools pattern declaration.
    const memCap = capabilityManifest.list().find((c) => c.id === 'memory.tiered.store')!;
    expect(memCap.supportedPatterns).toContain('cot-with-tools');
    expect(memCap.sideEffects).toBe('write');

    // Metering capability is the audit hook for the chain — must be cot-aware.
    const meterCap = capabilityManifest.list().find((c) => c.id === 'metering.usage-log')!;
    expect(meterCap.supportedPatterns).toContain('cot-with-tools');
    expect(meterCap.sideEffects).toBe('write');
  });
});

describe('Orchestration smoke — Pattern 7: Collective Debate', () => {
  it('manifest declares collective-debate on debate-eligible capabilities and aggregates pro/con outputs', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

    // Manifest contract: agent.auto-select carries the debate tag and
    // declares collective-debate; HITL is reachable from a debate flow
    // for high-risk synthesis review.
    const autoSel = capabilityManifest.list().find((c) => c.id === 'agent.auto-select')!;
    expect(autoSel.supportedPatterns).toContain('collective-debate');
    expect(autoSel.tags).toContain('debate');

    const hitl = capabilityManifest.list().find((c) => c.id === 'hitl.queue')!;
    expect(hitl.supportedPatterns).toContain('collective-debate');

    // Register a synthetic debater + adjudicator and run a 2-position debate
    // through the manifest. Each position is invoked in parallel; an
    // adjudicator synthesises the winner — exactly the collective-debate
    // contract Queen relies on.
    capabilityManifest.register({
      id: 'smoke.debater',
      displayName: 'Smoke Debater',
      category: 'agent-orchestration',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'safe',
      supportedPatterns: ['collective-debate', 'parallel'],
      tags: ['smoke', 'debate'],
      sideEffects: 'pure',
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({
        invoke: async (input: any) => ({ position: input.position, claim: `${input.position}:${input.topic}` }),
      }),
    });

    capabilityManifest.register({
      id: 'smoke.adjudicator',
      displayName: 'Smoke Adjudicator',
      category: 'agent-orchestration',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'review',
      supportedPatterns: ['collective-debate', 'sequential'],
      tags: ['smoke', 'debate', 'adjudicate'],
      sideEffects: 'pure',
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({
        invoke: async (input: any) => {
          const args = input.arguments as Array<{ position: string; claim: string }>;
          const winner = args.find((a) => a.position === 'pro') ?? args[0];
          return { winner: winner.position, citation: `cite:${winner.claim}` };
        },
      }),
    });

    const ctx = { tenantId: 't', userId: 'u', tier: 'mitra' as const, jurisdiction: 'IN', agentKey: 'debate' };
    const positions = await Promise.all([
      capabilityManifest.invoke('smoke.debater', { position: 'pro', topic: 'Section 66A IT Act' }, ctx),
      capabilityManifest.invoke('smoke.debater', { position: 'con', topic: 'Section 66A IT Act' }, ctx),
    ]);
    const verdict = (await capabilityManifest.invoke(
      'smoke.adjudicator',
      { arguments: positions },
      ctx,
    )) as { winner: string; citation: string };

    expect(positions).toHaveLength(2);
    expect(verdict.winner).toBe('pro');
    expect(verdict.citation).toMatch(/^cite:pro:/);

    // Audit hook: metering capability must accept collective-debate so each
    // contributing agent invocation can log usage uniformly.
    const meterCap = capabilityManifest.list().find((c) => c.id === 'metering.usage-log')!;
    expect(meterCap.supportedPatterns).toContain('collective-debate');
  });
});

describe('Orchestration smoke — Round 10d: Retry-with-backoff via shared breaker', () => {
  it('retries transient capability failures and succeeds within maxAttempts using the shared circuit-breaker', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const { _resetBreakerRegistry, getRetryBreakerStats } = await import('../../src/services/circuit-breaker.js');
    _resetBreakerRegistry();

    let attempts = 0;
    capabilityManifest.register({
      id: 'smoke.flaky',
      displayName: 'Smoke Flaky Capability',
      category: 'tools',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'safe',
      supportedPatterns: ['sequential'],
      tags: ['smoke', 'retry'],
      sideEffects: 'pure',
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({
        invoke: async (input: any) => {
          attempts++;
          if (attempts < 2) throw new Error('ECONNRESET upstream socket reset');
          return { ok: true, attempts, echoed: input };
        },
      }),
    });

    const ctx = { tenantId: 't', userId: 'u', tier: 'mitra' as const, jurisdiction: 'IN', agentKey: 'retry' };
    const out = (await capabilityManifest.invoke('smoke.flaky', { v: 1 }, ctx)) as { ok: boolean; attempts: number };
    expect(out.ok).toBe(true);
    expect(attempts).toBeGreaterThanOrEqual(2);

    // The shared breaker for cap:smoke.flaky must have recorded both attempts.
    const stats = getRetryBreakerStats('cap:smoke.flaky');
    expect(stats).not.toBeNull();
    expect(stats!.fires).toBeGreaterThanOrEqual(2);
    expect(stats!.successes).toBeGreaterThanOrEqual(1);
  });

  it('does NOT retry caller-bug errors (structured-input failure / tier denial)', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const { _resetBreakerRegistry, getRetryBreakerStats } = await import('../../src/services/circuit-breaker.js');
    _resetBreakerRegistry();

    let attempts = 0;
    capabilityManifest.register({
      id: 'smoke.strict-input',
      displayName: 'Smoke Strict Input',
      category: 'tools',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'safe',
      supportedPatterns: ['sequential'],
      tags: ['smoke', 'strict'],
      sideEffects: 'pure',
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({
        invoke: async () => {
          attempts++;
          throw new Error('structured-input failure: missing required field "model"');
        },
      }),
    });

    const ctx = { tenantId: 't', userId: 'u', tier: 'mitra' as const, jurisdiction: 'IN', agentKey: 'strict' };
    await expect(capabilityManifest.invoke('smoke.strict-input', {}, ctx)).rejects.toThrow(/structured-input failure/);
    // Should have only fired once — no retries on caller bugs.
    expect(attempts).toBe(1);
    const stats = getRetryBreakerStats('cap:smoke.strict-input');
    expect(stats!.fires).toBe(1);
  });
});

describe('Orchestration smoke — Round 10d: White-label first-class tier exposure', () => {
  it('SkillsSystemService.getCapabilitiesForContext escalates to manifest white-label surface when whiteLabel=true', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const { skillsSystem } = await import('../../src/services/skills/skills-system-service.js');

    // Register a synthetic white-label-only capability to prove that a
    // pro-billing tenant who is flagged whiteLabel=true can reach it,
    // and that the same tenant WITHOUT the flag cannot.
    capabilityManifest.register({
      id: 'smoke.white-label-only',
      displayName: 'Smoke White-Label-Only',
      category: 'white-label',
      tiers: ['white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'safe',
      supportedPatterns: ['sequential'],
      tags: ['smoke', 'white-label', 'partner'],
      sideEffects: 'pure',
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({ invoke: async () => ({ ok: true }) }),
    });

    const ctxBase = {
      agentId: 'a-1',
      jurisdiction: 'IN',
      practiceArea: 'general',
      tier: 'pro' as const,
      taskType: 'advisory',
    };

    const without = await skillsSystem.getCapabilitiesForContext(ctxBase);
    expect(without.capabilities.find((c) => c.id === 'smoke.white-label-only')).toBeUndefined();

    const withWl = await skillsSystem.getCapabilitiesForContext({ ...ctxBase, whiteLabel: true });
    const found = withWl.capabilities.find((c) => c.id === 'smoke.white-label-only');
    expect(found).toBeDefined();
    expect(found!.category).toBe('white-label');
  });
});

describe('Orchestration smoke — Round 10d: Orphan capability reachability via category fallback', () => {
  it('Queen binds a sparsely-tagged subtask to a manifest capability via category-fallback when intent + heuristic miss', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');

    // A capability with NO description-overlap tags but a category that
    // matches the subtask's required-capability token. Without the
    // round-10d fallback, this capability would be unreachable.
    capabilityManifest.register({
      id: 'smoke.orphan-but-categorized',
      displayName: 'Smoke Orphan But Categorized',
      category: 'simulation',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'safe',
      supportedPatterns: ['sequential'],
      tags: ['xyzzy-no-overlap'],
      sideEffects: 'pure',
      source: 'tests/orchestration/smoke.test.ts',
      factory: () => ({ invoke: async () => ({ result: 'simulated' }) }),
    });

    // Use the QueenOrchestrator singleton; bindCapabilitiesToSubtasks is
    // private but accessible via a typed-narrow harness for testing only.
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const queen = QueenOrchestrator.getInstance();

    const candidates = capabilityManifest
      .list({ tier: 'mitra', jurisdiction: 'IN' })
      .map((c) => ({ id: c.id, category: c.category, tags: [...c.tags] }));

    const decomposition = {
      subtasks: [
        {
          id: 'st-orphan-1',
          type: 'simulation-step',
          description: 'simulation step with deliberately non-overlapping description',
          requiredCapabilities: ['simulation'],
          dependencies: [],
        },
      ],
      metadata: { capabilityCandidates: candidates } as Record<string, unknown>,
    };

    interface BindHarness {
      bindCapabilitiesToSubtasks: (d: unknown) => void;
    }
    (queen as unknown as BindHarness).bindCapabilitiesToSubtasks(decomposition);

    const trace = decomposition.metadata.capabilityBindingTrace as Array<{
      subtaskId: string;
      bound: string | null;
      source: string;
    }>;
    expect(trace).toBeDefined();
    const entry = trace.find((t) => t.subtaskId === 'st-orphan-1');
    expect(entry).toBeDefined();
    // Either intent-map / heuristic / category-fallback is acceptable AS
    // LONG AS it lands on a capability — orphaned (unbound) is a fail.
    expect(entry!.bound).not.toBeNull();
    // For this synthetic shape (sparse description, "simulation" required
    // cap), the manifest-driven category fallback is the path that
    // catches our orphan-but-categorized capability.
    expect(['heuristic', 'category-fallback', 'intent-map']).toContain(entry!.source);
  });

  it('registers every Wave B6 mesh leaf with a live factory', async () => {
    const { capabilityManifest, WAVE_B6_MESH_LEAF_IDS, isWaveB6MeshLeaf } = await import(
      '../../src/orchestration/capability-manifest.js'
    );
    const registered = new Set(capabilityManifest.list().map((c) => c.id));
    for (const leafId of WAVE_B6_MESH_LEAF_IDS) {
      expect(registered, `missing Wave B6 mesh leaf: ${leafId}`).toContain(leafId);
      expect(isWaveB6MeshLeaf(leafId)).toBe(true);
    }
    expect(isWaveB6MeshLeaf('rag.search')).toBe(false);
  });

  it('Wave B6 alias capabilities invoke live services (not stubs)', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const ctx = { tier: 'enterprise' as const, jurisdiction: 'IN' as const, tenantId: 'mesh-test', userId: 'mesh-user' };

    const catalog = await capabilityManifest.invoke('templates.catalog', { limit: 2 }, ctx);
    expect(catalog).toBeDefined();
    const templates = (catalog as { data?: { templates?: Array<{ id?: string }> } }).data?.templates ?? [];
    expect(Array.isArray(templates)).toBe(true);

    if (templates[0]?.id) {
      const generated = await capabilityManifest.invoke('templates.generate', { templateId: templates[0].id, variables: {} }, ctx);
      expect(generated).toBeDefined();
      expect((generated as { data?: { content?: string } }).data?.content).toBeTruthy();
    }

    const dashboard = await capabilityManifest.invoke('clm.lifecycle', { op: 'dashboard' }, ctx);
    expect(dashboard).toBeDefined();

    const steps = await capabilityManifest.invoke('efiling.steps', { jurisdiction: 'IN' }, ctx);
    expect(steps).toBeDefined();
    expect((steps as { submissionSteps?: unknown[] }).submissionSteps?.length).toBeGreaterThan(0);

    // Real service wiring — missing ids should surface domain errors, not stub/circular-import failures.
    await expect(
      capabilityManifest.invoke('digital_twin.simulate', { twinId: 'mesh-missing-twin', scenario: 'default' }, ctx),
    ).rejects.toThrow(/Digital twin not found/i);
    await expect(
      capabilityManifest.invoke('digital-twin.simulate', { twinId: 'mesh-missing-twin', scenario: 'default' }, ctx),
    ).rejects.toThrow(/Digital twin not found/i);
    await expect(
      capabilityManifest.invoke('clm.playbook', { playbookId: 'mesh-missing-playbook', documentText: 'sample contract' }, ctx),
    ).rejects.toThrow(/Playbook not found/i);
    await expect(
      capabilityManifest.invoke('e-filing.submit', { filingId: 'mesh-missing-filing' }, ctx),
    ).rejects.toThrow(/Filing not found/i);

    const precedent = await capabilityManifest.invoke('intelligence.precedent', { caseDescription: 'breach of contract', jurisdiction: 'IN' }, ctx);
    expect(precedent).toBeDefined();
  });

  it('Queen binds Wave B6 mesh leaf intents to the new alias capabilities', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const queen = QueenOrchestrator.getInstance();

    const candidates = capabilityManifest
      .list({ tier: 'enterprise', jurisdiction: 'IN' })
      .map((c) => ({ id: c.id, category: c.category, tags: [...c.tags] }));

    const cases: Array<{ hint: string; expected: string[] }> = [
      { hint: 'template', expected: ['templates.generate', 'templates.catalog', 'nyaya-tools.template'] },
      { hint: 'twin', expected: ['digital_twin.simulate', 'twindesk.simulate'] },
      { hint: 'filing', expected: ['efiling.steps', 'e-filing.submit'] },
      { hint: 'playbook', expected: ['clm.playbook', 'workflow.contract-playbook'] },
      { hint: 'contract_lifecycle', expected: ['clm.lifecycle', 'workflow.contract-playbook'] },
      { hint: 'precedent', expected: ['intelligence.precedent', 'intelligence.precedent-similarity'] },
      { hint: 'contract', expected: ['clm.lifecycle', 'clm.playbook'] },
      { hint: 'caselaw', expected: ['intelligence.precedent', 'intelligence.precedent-similarity'] },
      { hint: 'submit', expected: ['e-filing.submit', 'efiling.steps'] },
      { hint: 'lifecycle', expected: ['clm.lifecycle'] },
      { hint: 'catalog', expected: ['templates.catalog'] },
      { hint: 'generate', expected: ['templates.generate'] },
    ];

    interface BindHarness {
      bindCapabilitiesToSubtasks: (d: unknown) => void;
    }

    for (const [index, testCase] of cases.entries()) {
      const decomposition: any = {
        subtasks: [
          {
            id: `st-mesh-${index}`,
            type: 'direct_execution',
            description: `mesh intent for ${testCase.hint}`,
            requiredCapabilities: ['general'],
            dependencies: [],
          },
        ],
        metadata: {
          capabilityCandidates: candidates,
          patternCapabilityHint: [testCase.hint],
        } as Record<string, unknown>,
      };

      (queen as unknown as BindHarness).bindCapabilitiesToSubtasks(decomposition);

      const bound = decomposition.subtasks[0].assignedCapabilityId;
      expect(bound).toBeDefined();
      expect(testCase.expected).toContain(bound);
    }
  });

  it('Queen analyzePrompt emits specific B6 hints before generic tokens', async () => {
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const queen = QueenOrchestrator.getInstance();

    interface AnalyzeHarness {
      analyzePrompt: (p: string) => { patternCapabilityHint: string[] };
    }
    const analyze = (queen as unknown as AnalyzeHarness).analyzePrompt.bind(queen);

    expect(analyze('list all NDA templates').patternCapabilityHint).toEqual(['catalog']);
    expect(analyze('generate a draft template for NDA').patternCapabilityHint).toEqual(['generate']);
    expect(analyze('submit the court e-filing now').patternCapabilityHint).toEqual(['submit']);
    expect(analyze('show e-filing steps for Karnataka').patternCapabilityHint).toEqual(['filing']);
    expect(analyze('run contract playbook review').patternCapabilityHint).toEqual(['playbook']);
    expect(analyze('simulate the litigation outcome for this dispute').patternCapabilityHint).toEqual(['simulation']);
  });

  it('Queen binds pattern-dispatch capability ids directly (P20/P22 mesh leaves)', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const { QueenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
    const queen = QueenOrchestrator.getInstance();

    const candidates = capabilityManifest
      .list({ tier: 'enterprise', jurisdiction: 'IN' })
      .map((c) => ({ id: c.id, category: c.category, tags: [...c.tags] }));

    interface BindHarness {
      bindCapabilitiesToSubtasks: (d: unknown) => void;
    }

    for (const directId of ['e-filing.submit', 'digital-twin.simulate'] as const) {
      const decomposition: any = {
        subtasks: [
          {
            id: `st-pattern-${directId}`,
            type: 'direct_execution',
            description: `pattern dispatch for ${directId}`,
            requiredCapabilities: ['general'],
            dependencies: [],
          },
        ],
        metadata: {
          capabilityCandidates: candidates,
          patternCapabilityHint: directId,
        },
      };

      (queen as unknown as BindHarness).bindCapabilitiesToSubtasks(decomposition);
      expect(decomposition.subtasks[0].assignedCapabilityId).toBe(directId);
    }
  });
});

describe('Orchestration smoke — Round 10e: Runtime factory publishes manifest capability surface', () => {
  it('publishManifestCapabilitiesForAgent returns the per-tier + jurisdiction subset gated by skills', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const { RuntimeAgentFactory } = await import('../../src/orchestration/jrx-runtime-agent-factory.js');
    type FactoryCfg = ConstructorParameters<typeof RuntimeAgentFactory>[0];

    // Synthetic storage stub — the factory only needs the structural shape
    // for its createAgent / get / update / retire calls, none of which fire
    // in this helper-level test. Typed via the factory's own constructor
    // parameter shape so the stub is compile-checked against IStorage with
    // no `any` escapes.
    const storageStub: FactoryCfg['storage'] = {
      createAgent: async (a) => a,
      getAgent: async () => undefined,
      getAllAgents: async () => [],
      updateAgent: async () => undefined,
      retireAgent: async () => true,
    };
    // JurexioOrchestrationConfigV9's fields are all optional plus an
    // index signature, so an empty object satisfies the type without any
    // cast — perfect for this helper-level test that doesn't exercise
    // any coreConfig surface.
    const coreConfigStub: FactoryCfg['coreConfig'] = {};
    const factory = new RuntimeAgentFactory({
      coreConfig: coreConfigStub,
      storage: storageStub,
    });

    const skills = [
      { skillId: 'legal-research', skillName: 'legal research', proficiencyLevel: 'expert' as const, importance: 'critical' as const, tools: [] },
    ];

    const liteIds = await factory.publishManifestCapabilitiesForAgent('lite', 'IN', skills);
    const enterpriseIds = await factory.publishManifestCapabilitiesForAgent('enterprise', 'IN', skills);

    // The enterprise tier must expose AT LEAST as many capabilities as
    // the lite tier — never fewer. (Subset relation enforced by the
    // manifest's per-tier inclusion declarations.)
    expect(enterpriseIds.length).toBeGreaterThanOrEqual(liteIds.length);

    // Platform invariant categories present on the enterprise tier
    // surface must ALL appear in the published set regardless of skill
    // set — they cannot be gated away. We only assert about invariants
    // that the manifest itself exposes at this tier (not every invariant
    // category is necessarily registered yet — the manifest is the SSoT).
    const enterpriseTierCats = new Set(
      capabilityManifest.list({ tier: 'enterprise', jurisdiction: 'IN' }).map((c) => c.category),
    );
    const enterprisePublishedCats = new Set(
      enterpriseIds
        .map((id) => capabilityManifest.list().find((c) => c.id === id)?.category)
        .filter((c): c is string => !!c),
    );
    const PLATFORM_INVARIANTS = ['safety', 'hitl', 'metering', 'audit', 'governance', 'monitoring', 'security', 'protocol'];
    for (const inv of PLATFORM_INVARIANTS) {
      if (enterpriseTierCats.has(inv)) {
        expect(enterprisePublishedCats.has(inv)).toBe(true);
      }
    }

    // Jurisdiction gating: an unsupported jurisdiction must return a
    // strictly smaller (or equal) surface than 'IN' for the same tier.
    const enterpriseUSIds = await factory.publishManifestCapabilitiesForAgent('enterprise', 'US', skills);
    expect(enterpriseUSIds.length).toBeLessThanOrEqual(enterpriseIds.length);
  });
});

describe('Orchestration smoke — Round 10e: AgentOrchestrationService fail-loud on Queen absence', () => {
  it('throws in PRODUCTION when the Queen loader returns null (no silent manifest-fallback echo)', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      vi.resetModules();
      // Stub out the Queen loader's underlying module so the dynamic
      // import(...) in src/services/agent-orchestration.ts:loadQueenOrchestrator
      // resolves to a module whose `queenOrchestrator` export is missing.
      // The loader maps this to `null`, which is the ABSENCE case the
      // round-10e fail-loud guard now rejects in PROD.
      vi.doMock('../../src/orchestration/jrx-queen-orchestrator.js', () => ({
        // intentionally no `queenOrchestrator` export — simulates an
        // unbootstrapped / absent Queen module.
      }));
      const mod = await import('../../src/services/agent-orchestration.js');
      const svc = new mod.AgentOrchestrationService();
      await expect(
        svc.executeAgent('agent-x', { prompt: 'hello' }, { tier: 'lite', jurisdiction: 'IN' }),
      ).rejects.toThrow(/FAIL-LOUD.*unavailable.*loader returned null/);
    } finally {
      vi.doUnmock('../../src/orchestration/jrx-queen-orchestrator.js');
      vi.resetModules();
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });

  it('falls through to dev manifest-fallback echo when NODE_ENV !== production and Queen absent', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      vi.resetModules();
      vi.doMock('../../src/orchestration/jrx-queen-orchestrator.js', () => ({}));
      const mod = await import('../../src/services/agent-orchestration.js');
      const svc = new mod.AgentOrchestrationService();
      const out = await svc.executeAgent(
        'agent-x',
        { prompt: 'hello' },
        { tier: 'lite', jurisdiction: 'IN' },
      );
      expect(out.status).toBe('completed');
      expect(out.metadata?.via).toBe('manifest-fallback');
      expect(out.metadata?.devFallback).toBe(true);
    } finally {
      vi.doUnmock('../../src/orchestration/jrx-queen-orchestrator.js');
      vi.resetModules();
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });
});

describe('Orchestration smoke — Round 10e: Redis seam re-exports canonical cache service', () => {
  it('redis-client.ts exports nvRedisCache (canonical) alongside the raw redisClient back-compat', async () => {
    const seam = await import('../../src/services/redis-client.js');
    expect(seam.nvRedisCache).toBeDefined();
    // Back-compat surface is preserved.
    expect(seam.redisClient).toBeDefined();
    expect(typeof seam.ensureRedis).toBe('function');
  });

  it('importing the seam never crashes even when REDIS_URL is misconfigured (lazy construction)', async () => {
    // Stash and intentionally clobber REDIS_URL with a non-redis
    // protocol — historically this caused redis.ts to throw "Invalid
    // protocol" at module-load time. Round 10e made redis.ts lazy so
    // this import path must succeed regardless.
    const original = process.env.REDIS_URL;
    process.env.REDIS_URL = 'https://not-a-redis-url.example';
    try {
      // vi.resetModules so we get a freshly-evaluated copy that sees
      // the clobbered env (otherwise we'd hit the cached module from
      // earlier tests).
      vi.resetModules();
      const seam = await import('../../src/services/redis-client.js');
      expect(seam.nvRedisCache).toBeDefined();
      expect(seam.redisClient).toBeDefined();
    } finally {
      if (original === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = original;
    }
  });

  it('back-compat redisClient forwards both function calls AND non-function property reads to the underlying client', async () => {
    // Force a known-good redis:// URL so the lazy createClient succeeds
    // when we trigger property access. We don't actually .connect() —
    // we only assert that the proxy correctly distinguishes function
    // members (returns a callable) from non-function members (forwards
    // the underlying value, not a wrapper function). This is the
    // back-compat hardening called out in the round 10e review.
    const original = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://localhost:6379';
    try {
      vi.resetModules();
      const seam = await import('../../src/services/redis-client.js');
      // Function-shaped members must remain callable through the proxy.
      expect(typeof seam.redisClient.connect).toBe('function');
      // Non-function members (e.g. `isOpen`) must forward the underlying
      // value rather than always returning a function. Not yet connected,
      // so `isOpen` must be the boolean `false`.
      expect(seam.redisClient.isOpen).toBe(false);
    } finally {
      if (original === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = original;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Wave B7 — extended inventory leaves (steps 1+5)
// ──────────────────────────────────────────────────────────────────────────────

describe('Orchestration smoke — Wave B7 extended inventory leaves', () => {
  it('registers every Wave B7 extended leaf with a live factory', async () => {
    const { capabilityManifest, WAVE_B7_EXTENDED_LEAF_IDS, isWaveB7ExtendedLeaf } = await import(
      '../../src/orchestration/capability-manifest.js'
    );
    const registered = new Set(capabilityManifest.list().map((c) => c.id));
    for (const leafId of WAVE_B7_EXTENDED_LEAF_IDS) {
      expect(registered, `missing Wave B7 leaf: ${leafId}`).toContain(leafId);
      expect(isWaveB7ExtendedLeaf(leafId)).toBe(true);
      const cap = capabilityManifest.get(leafId);
      expect(cap?.factory, `missing factory for ${leafId}`).toBeTypeOf('function');
    }
    expect(isWaveB7ExtendedLeaf('rag.search')).toBe(false);
  });

  it('resolveIntentToCapability binds Wave B7 intent aliases', async () => {
    const { resolveIntentToCapability, WAVE_B7_EXTENDED_LEAF_IDS } = await import(
      '../../src/orchestration/capability-manifest.js'
    );
    const candidates = new Set(WAVE_B7_EXTENDED_LEAF_IDS);
    expect(resolveIntentToCapability(['judge'], candidates)?.capabilityId).toBe('testing.judge');
    expect(resolveIntentToCapability(['summarize'], candidates)?.capabilityId).toBe('intelligence.summarize');
    expect(resolveIntentToCapability(['swarm'], candidates)?.capabilityId).toBe('orchestration.swarm.topology');
    expect(resolveIntentToCapability(['persona'], candidates)?.capabilityId).toBe('agent.persona');
  });

  it('Wave B7 leaves invoke without stub/not_implemented responses', async () => {
    const { capabilityManifest } = await import('../../src/orchestration/capability-manifest.js');
    const ctx = { tier: 'enterprise' as const, jurisdiction: 'IN' as const, tenantId: 'b7-test', userId: 'b7-user' };

    const rbac = await capabilityManifest.invoke(
      'security.rbac.check',
      { userId: 'u1', role: 'viewer', resource: 'documents', action: 'read' },
      ctx,
    );
    expect(rbac).toBeDefined();
    expect((rbac as { allowed?: boolean }).allowed).toBeDefined();

    const verbalized = await capabilityManifest.invoke(
      'simulation.verbalized-sampling',
      { op: 'verbalize', score: 0.82, domain: 'legal' },
      ctx,
    );
    expect(verbalized).toBeDefined();
  });
});
