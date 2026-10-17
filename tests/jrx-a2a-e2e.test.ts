/**
 * A2A (Agent-to-Agent) Collaboration Bus — E2E Test Suite
 *
 * Tests the full lifecycle of A2A message passing:
 *   - Agent registration
 *   - Message routing (request, response, notification)
 *   - Escalation protocol
 *   - Handoff delegation
 *   - Performance metrics + event emission
 *
 * @file tests/jrx-a2a-e2e.test.ts
 * @version 3.1.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// MOCK: suppress logger output in tests
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../src/utils/logger.js', () => ({
  createLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// In-memory storage stub satisfying IStorage interface
// ─────────────────────────────────────────────────────────────────────────────
function makeStorage() {
  const store = new Map<string, unknown>();
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: unknown) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal A2AMessage factory
// ─────────────────────────────────────────────────────────────────────────────
function makeMessage(
  id: string,
  type: 'request' | 'response' | 'notification' | 'negotiation' | 'handoff' | 'escalation',
  fromAgent: string,
  toAgent: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  return {
    id,
    type,
    fromAgent,
    toAgent,
    payload: { action, data },
    metadata: {
      priority: 'normal' as const,
      category: 'legal',
      tags: ['test'],
      correlationId: id,
      requestId: id,
      expectedResponseTime: 5000,
    },
    routing: {
      path: [],
      hops: 0,
      maxHops: 5,
      broadcast: false,
      multicast: false,
      failover: true,
      retryPolicy: { maxRetries: 3, backoffMs: 100, exponential: false },
    },
    security: {
      authenticated: true,
      authorized: true,
      encryptionLevel: 'basic' as const,
      accessLevel: 'internal' as const,
    },
    timestamp: new Date(),
    ttl: 30000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import under fake timers so setInterval doesn't block
// ─────────────────────────────────────────────────────────────────────────────
let A2ACollaborationBus: typeof import('../src/packages/protocols/a2a-collaboration-bus.js').A2ACollaborationBus;

describe('A2A Collaboration Bus — E2E', () => {
  let bus: InstanceType<typeof A2ACollaborationBus>;

  beforeEach(async () => {
    vi.useFakeTimers();
    ({ A2ACollaborationBus } = await import('../src/packages/protocols/a2a-collaboration-bus.js'));

    const storage = makeStorage();
    const coreConfig = {
      agents: [
        { id: 'advocate-001', name: 'Advocate Agent', type: 'legal', capabilities: ['research', 'drafting'] },
        { id: 'compliance-001', name: 'Compliance Agent', type: 'compliance', capabilities: ['audit', 'risk-check'] },
        { id: 'escalation-001', name: 'Escalation Agent', type: 'supervisor', capabilities: ['escalate', 'mediate'] },
      ],
    };
    bus = new A2ACollaborationBus({ coreConfig, storage });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  // ── 1. Bus construction ────────────────────────────────────────────────────
  describe('Bus initialisation', () => {
    it('creates a bus instance with EventEmitter inheritance', () => {
      expect(bus).toBeTruthy();
      expect(typeof bus.on).toBe('function');
      expect(typeof bus.emit).toBe('function');
      expect(typeof bus.registerAgent).toBe('function');
      expect(typeof bus.sendMessage).toBe('function');
    });
  });

  // ── 2. Agent registration ─────────────────────────────────────────────────
  describe('Agent registration', () => {
    it('registers an advocate agent and returns a registration record', async () => {
      const reg = await bus.registerAgent({
        id: 'advocate-001',
        name: 'Advocate Agent',
        type: 'legal',
        capabilities: ['research', 'drafting'],
      });

      expect(reg.agentId).toBe('advocate-001');
      expect(reg.name).toBe('Advocate Agent');
      expect(reg.type).toBe('legal');
      expect(reg.reputation).toBeDefined();
      expect(reg.availability).toBeDefined();
      expect(reg.performance).toBeDefined();
      expect(reg.registrationTime).toBeInstanceOf(Date);
    });

    it('registers a compliance agent with custom capabilities', async () => {
      const reg = await bus.registerAgent(
        { id: 'compliance-001', name: 'Compliance Agent', type: 'compliance', capabilities: ['audit'] },
        {
          supported: ['audit', 'risk-check', 'dpdpa-verify'],
          preferred: ['audit'],
          restricted: [],
          requiredAuth: ['bearer'],
          protocols: ['a2a-v9'],
        } as any,
      );

      expect(reg.agentId).toBe('compliance-001');
      expect(reg.capabilities.supported).toContain('audit');
    });

    it('emits agent-registered event on successful registration', async () => {
      const listener = vi.fn();
      bus.on('agent-registered', listener);

      await bus.registerAgent({
        id: 'advocate-001',
        name: 'Advocate Agent',
        type: 'legal',
        capabilities: ['research'],
      });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].agentId).toBe('advocate-001');
    });

    it('registers multiple agents without conflict', async () => {
      await bus.registerAgent({ id: 'advocate-001', name: 'Advocate', type: 'legal', capabilities: [] });
      await bus.registerAgent({ id: 'compliance-001', name: 'Compliance', type: 'compliance', capabilities: [] });

      const events: string[] = [];
      bus.on('agent-registered', (r: any) => events.push(r.agentId));

      await bus.registerAgent({ id: 'escalation-001', name: 'Escalation', type: 'supervisor', capabilities: [] });

      expect(events).toContain('escalation-001');
    });
  });

  // ── 3. Message routing ────────────────────────────────────────────────────
  describe('Message routing — request / response', () => {
    beforeEach(async () => {
      await bus.registerAgent({ id: 'advocate-001', name: 'Advocate', type: 'legal', capabilities: ['research'] });
      await bus.registerAgent({ id: 'compliance-001', name: 'Compliance', type: 'compliance', capabilities: ['audit'] });
    });

    it('routes a standard REQUEST message and returns delivered status', async () => {
      const msg = makeMessage('MSG-001', 'request', 'advocate-001', 'compliance-001', 'check-compliance', {
        document: 'Shareholder Agreement v2',
        jurisdiction: 'IN',
      });

      const result = await bus.sendMessage(msg as any);

      expect(result).toBeTruthy();
      expect(result.messageId).toBe('MSG-001');
      expect(result.status).toBe('delivered');
      expect(result.routing).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('routes a NOTIFICATION message', async () => {
      const msg = makeMessage('MSG-002', 'notification', 'compliance-001', 'advocate-001', 'risk-threshold-exceeded', {
        riskScore: 73,
        riskTier: 'RED',
      });

      const result = await bus.sendMessage(msg as any);
      expect(result.status).toBe('delivered');
      expect(result.messageId).toBe('MSG-002');
    });

    it('emits message-processed event after delivery', async () => {
      const processed = vi.fn();
      bus.on('message-processed', processed);

      const msg = makeMessage('MSG-003', 'request', 'advocate-001', 'compliance-001', 'validate-clause');
      await bus.sendMessage(msg as any);

      expect(processed).toHaveBeenCalledOnce();
    });

    it('metrics are returned in the message result', async () => {
      const msg = makeMessage('MSG-004', 'request', 'advocate-001', 'compliance-001', 'fetch-statute', { act: 'BNS 2023' });
      const result = await bus.sendMessage(msg as any);

      expect(result.metrics).toBeDefined();
    });
  });

  // ── 4. Escalation ─────────────────────────────────────────────────────────
  describe('Escalation protocol', () => {
    beforeEach(async () => {
      await bus.registerAgent({ id: 'advocate-001', name: 'Advocate', type: 'legal', capabilities: [] });
      await bus.registerAgent({ id: 'escalation-001', name: 'Escalation Supervisor', type: 'supervisor', capabilities: [] });
    });

    it('routes an ESCALATION message successfully', async () => {
      const msg = makeMessage('ESC-001', 'escalation', 'advocate-001', 'escalation-001', 'risk-too-high', {
        caseId: 'CASE-A2A-001',
        reason: 'AI risk score exceeded threshold (82/100)',
        urgency: 'immediate',
      });

      const result = await bus.sendMessage(msg as any);
      expect(result.status).toBe('delivered');
      expect(result.messageId).toBe('ESC-001');
    });
  });

  // ── 5. Handoff delegation ─────────────────────────────────────────────────
  describe('Task handoff delegation', () => {
    beforeEach(async () => {
      await bus.registerAgent({ id: 'advocate-001', name: 'Advocate', type: 'legal', capabilities: ['research'] });
      await bus.registerAgent({ id: 'compliance-001', name: 'Compliance', type: 'compliance', capabilities: ['audit'] });
    });

    it('routes a HANDOFF message and confirms delivery', async () => {
      const msg = makeMessage('HAND-001', 'handoff', 'advocate-001', 'compliance-001', 'delegate-audit', {
        taskId: 'TASK-HAND-001',
        context: { caseRef: 'M&A-2026-042', stage: 'due-diligence' },
        deadline: new Date(Date.now() + 86400000).toISOString(),
      });

      const result = await bus.sendMessage(msg as any);
      expect(result.status).toBe('delivered');
    });
  });

  // ── 6. Negotiation ────────────────────────────────────────────────────────
  describe('Negotiation flow', () => {
    beforeEach(async () => {
      await bus.registerAgent({ id: 'advocate-001', name: 'Advocate', type: 'legal', capabilities: [] });
      await bus.registerAgent({ id: 'compliance-001', name: 'Compliance', type: 'compliance', capabilities: [] });
    });

    it('routes a NEGOTIATION message', async () => {
      const msg = makeMessage('NEG-001', 'negotiation', 'advocate-001', 'compliance-001', 'agree-risk-threshold', {
        proposal: { riskThreshold: 60, latencyBudgetMs: 500 },
      });

      const result = await bus.sendMessage(msg as any);
      expect(result.status).toBe('delivered');
      expect(result.messageId).toBe('NEG-001');
    });
  });

  // ── 7. Multi-agent broadcast ───────────────────────────────────────────────
  describe('Multi-agent coordination', () => {
    it('registers 149 ROMA L5 agents without throwing', async () => {
      const agents = Array.from({ length: 149 }, (_, i) => ({
        id: `roma-l5-${String(i + 1).padStart(3, '0')}`,
        name: `ROMA L5 Agent ${i + 1}`,
        type: 'legal-ai',
        capabilities: ['research', 'reasoning', 'drafting'],
      }));

      const registrations = await Promise.all(agents.map((a) => bus.registerAgent(a)));
      expect(registrations).toHaveLength(149);
      expect(registrations.every((r) => r.agentId.startsWith('roma-l5-'))).toBe(true);
    });

    it('sends 22 pattern messages concurrently without error', async () => {
      await bus.registerAgent({ id: 'sender-001', name: 'Sender', type: 'legal', capabilities: [] });
      await bus.registerAgent({ id: 'receiver-001', name: 'Receiver', type: 'legal', capabilities: [] });

      const patterns = [
        'react', 'reflect', 'plan-act', 'rag', 'mcp', 'multi-agent',
        'router', 'evaluator', 'grpo', 'a2a', 'orchestrator', 'voice',
        'doc', 'contract', 'litigation', 'compliance', 'arbitration',
        'due-diligence', 'ip-trademark', 'employment', 'tax', 'crossborder',
      ];

      const results = await Promise.all(
        patterns.map((p, i) =>
          bus.sendMessage(makeMessage(`PAT-${i}`, 'request', 'sender-001', 'receiver-001', p) as any),
        ),
      );

      expect(results).toHaveLength(22);
      expect(results.every((r) => r.status === 'delivered')).toBe(true);
    });
  });
});
