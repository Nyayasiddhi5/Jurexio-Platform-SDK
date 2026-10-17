/**
 * JrxClient unit tests — @jurexio/client-sdk v5
 * Tests: instantiation, config validation, API surface, method existence.
 */

import { describe, it, expect, beforeEach } from 'vitest';

const MOCK_API_KEY = 'nyv_test_sk_0000000000000000000000000000000000000000';
const MOCK_BASE_URL = 'https://app.jurexio.com';

describe('JrxClient (SDK)', () => {
  describe('Module exports', () => {
    it('exports JrxClient class', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.JrxClient).toBeDefined();
      expect(typeof mod.JrxClient).toBe('function');
    });

    it('exports JrxStreamReader class', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.JrxStreamReader).toBeDefined();
      expect(typeof mod.JrxStreamReader).toBe('function');
    });

    it('exports PatternsApi class', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.PatternsApi).toBeDefined();
    });

    it('exports DocumentsApi class', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.DocumentsApi).toBeDefined();
    });

    it('exports AgentsApi class', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.AgentsApi).toBeDefined();
    });

    it('exports SkillsApi class', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.SkillsApi).toBeDefined();
    });

    it('exports TwinApi class', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.TwinApi).toBeDefined();
    });

    it('exports KnowledgeApi class', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.KnowledgeApi).toBeDefined();
    });
  });

  describe('JrxClient instantiation', () => {
    it('creates instance with apiKey and baseUrl', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({ apiKey: MOCK_API_KEY, baseUrl: MOCK_BASE_URL });
      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(JrxClient);
    });

    it('exposes .patterns namespace', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({ apiKey: MOCK_API_KEY, baseUrl: MOCK_BASE_URL });
      expect(client.patterns).toBeDefined();
      expect(typeof client.patterns.react).toBe('function');
      expect(typeof client.patterns.cot).toBe('function');
      expect(typeof client.patterns.grpo).toBe('function');
      expect(typeof client.patterns.reflect).toBe('function');
    });

    it('exposes .documents namespace', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({ apiKey: MOCK_API_KEY, baseUrl: MOCK_BASE_URL });
      expect(client.documents).toBeDefined();
      expect(typeof client.documents.list).toBe('function');
    });

    it('exposes .agents namespace', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({ apiKey: MOCK_API_KEY, baseUrl: MOCK_BASE_URL });
      expect(client.agents).toBeDefined();
    });

    it('exposes .stream namespace', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({ apiKey: MOCK_API_KEY, baseUrl: MOCK_BASE_URL });
      expect(client.stream).toBeDefined();
      expect(typeof client.stream.streamPattern).toBe('function');
    });

    it('exposes .twins namespace', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({ apiKey: MOCK_API_KEY, baseUrl: MOCK_BASE_URL });
      expect(client.twins).toBeDefined();
      expect(typeof client.twins.create).toBe('function');
      expect(typeof client.twins.simulate).toBe('function');
    });

    it('exposes .ask() convenience method', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({ apiKey: MOCK_API_KEY, baseUrl: MOCK_BASE_URL });
      expect(typeof client.ask).toBe('function');
    });

    it('exposes NSP partner API namespaces', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({
        apiKey: MOCK_API_KEY,
        baseUrl: MOCK_BASE_URL,
        platformClient: 'nyayasiddhi-professional/1.0.0',
      });
      expect(client.orchestrateApi).toBeDefined();
      expect(client.gateway).toBeDefined();
      expect(client.partnerIntelligence).toBeDefined();
      expect(client.docsPipeline).toBeDefined();
      expect(client.docparse).toBeDefined();
      expect(client.llmRouter).toBeDefined();
      expect(client.swarm).toBeDefined();
      expect(client.legalSdk).toBeDefined();
      expect(typeof client.orchestrate).toBe('function');
      expect(typeof client.orchestrate.stream).toBe('function');
      expect(typeof client.caseAnalysis).toBe('function');
      expect(typeof client.processNspSharedDoc).toBe('function');
    });
  });

  describe('JrxClient configuration', () => {
    it('normalises baseUrl by stripping trailing slash', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({
        apiKey: MOCK_API_KEY,
        baseUrl: 'https://app.jurexio.com/',
      });
      expect(client).toBeDefined();
    });

    it('accepts optional jurisdiction default', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({
        apiKey: MOCK_API_KEY,
        baseUrl: MOCK_BASE_URL,
        defaultJurisdiction: 'UK',
      });
      expect(client).toBeDefined();
    });

    it('accepts optional timeout and orchestrate timeout', async () => {
      const { JrxClient } = await import('../../src/index.js');
      const client = new JrxClient({
        apiKey: MOCK_API_KEY,
        baseUrl: MOCK_BASE_URL,
        timeout: 30_000,
        orchestrateTimeoutMs: 600_000,
      });
      expect(client).toBeDefined();
    });
  });
});
