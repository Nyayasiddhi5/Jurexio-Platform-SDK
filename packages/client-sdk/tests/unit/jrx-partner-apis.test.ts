/**
 * NSP partner API unit tests — mock HTTP client, no live gateway.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JrxHttpClient } from '../../src/JrxClient.js';
import { OrchestrateApi } from '../../src/api/OrchestrateApi.js';
import { GatewayApi } from '../../src/api/GatewayApi.js';
import { PartnerIntelligenceApi } from '../../src/api/PartnerIntelligenceApi.js';
import { DocsPipelineApi } from '../../src/api/DocsPipelineApi.js';
import { LlmRouterApi } from '../../src/api/LlmRouterApi.js';
import { CamApi } from '../../src/api/CamApi.js';
import { SwarmApi } from '../../src/api/SwarmApi.js';
import { LegalSdkApi } from '../../src/api/LegalSdkApi.js';
import { EcosystemDocumentsApi } from '../../src/api/EcosystemDocumentsApi.js';
import { KnowledgeApi } from '../../src/api/KnowledgeApi.js';
import { LegalWorkApi } from '../../src/api/LegalWorkApi.js';

function mockHttp(): JrxHttpClient & { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn().mockResolvedValue({ ok: true }),
    post: vi.fn().mockResolvedValue({ ok: true }),
    postForm: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getBytes: vi.fn(),
  };
}

describe('NSP partner API modules', () => {
  let http: ReturnType<typeof mockHttp>;

  beforeEach(() => {
    http = mockHttp();
  });

  describe('OrchestrateApi', () => {
    it('POST /api/jrx/orchestrate', async () => {
      const api = new OrchestrateApi(http, 'nyv_test_sk_x', 'https://example.test');
      await api.run({ prompt: 'test', jurisdiction: 'IN' });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/orchestrate', { prompt: 'test', jurisdiction: 'IN' });
    });

    it('exposes stream helper', () => {
      const api = new OrchestrateApi(http, 'nyv_test_sk_x', 'https://example.test');
      expect(typeof api.stream).toBe('function');
    });
  });

  describe('GatewayApi', () => {
    it('researchQuery hits gateway research path', async () => {
      const api = new GatewayApi(http);
      await api.researchQuery({ query: 'consideration', jurisdiction: 'IN' });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/gateway/research/query', {
        query: 'consideration',
        jurisdiction: 'IN',
      });
    });

    it('getPracticeAreas', async () => {
      const api = new GatewayApi(http);
      await api.getPracticeAreas();
      expect(http.get).toHaveBeenCalledWith('/api/jrx/gateway/practice-areas');
    });

    it('translate extension paths', async () => {
      const api = new GatewayApi(http);
      await api.translateDetect({ text: 'hello' });
      await api.translateBatch({ items: [] });
      await api.transliterate({ text: 'namaste', script: 'devanagari' });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/gateway/translate/detect-language', { text: 'hello' });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/gateway/translate/batch', { items: [] });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/gateway/translate/transliterate', {
        text: 'namaste',
        script: 'devanagari',
      });
    });

    it('ocrProcess and usageTokens', async () => {
      const api = new GatewayApi(http);
      await api.ocrProcess({ imageUrl: 'https://example.com/doc.png' });
      await api.getUsageTokens();
      expect(http.post).toHaveBeenCalledWith('/api/jrx/gateway/ocr/process', { imageUrl: 'https://example.com/doc.png' });
      expect(http.get).toHaveBeenCalledWith('/api/jrx/gateway/usage/tokens');
    });
  });

  describe('PartnerIntelligenceApi', () => {
    it('classifyDocument E6 path', async () => {
      const api = new PartnerIntelligenceApi(http);
      await api.classifyDocument({ text: 'Agreement', jurisdiction: 'IN', org_id: 'org-1' });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/v1/sdk/intelligence/classify-document', {
        text: 'Agreement',
        jurisdiction: 'IN',
        org_id: 'org-1',
      });
    });

    it('clientHealth D7 path', async () => {
      const api = new PartnerIntelligenceApi(http);
      await api.clientHealth('client-42');
      expect(http.get).toHaveBeenCalledWith('/api/jrx/v1/sdk/intelligence/client-health/client-42');
    });
  });

  describe('DocsPipelineApi', () => {
    it('summarize path', async () => {
      const api = new DocsPipelineApi(http);
      await api.summarize({ documentText: 'contract', jurisdiction: 'IN' });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/sdk/docs-pipeline/documents/summarize', {
        documentText: 'contract',
        jurisdiction: 'IN',
      });
    });
  });

  describe('LlmRouterApi', () => {
    it('catalog and routerExplain', async () => {
      const api = new LlmRouterApi(http);
      await api.catalog({ tier: 'standard' });
      await api.routerExplain({ modelId: 'bedrock-claude', task: 'draft' });
      expect(http.get).toHaveBeenCalledWith('/api/jrx/v1/sdk/llm/catalog?tier=standard');
      expect(http.post).toHaveBeenCalledWith('/api/jrx/v1/sdk/llm/router/explain', {
        modelId: 'bedrock-claude',
        task: 'draft',
      });
    });
  });

  describe('CamApi', () => {
    it('dashboard path', async () => {
      const api = new CamApi(http);
      await api.dashboard();
      expect(http.get).toHaveBeenCalledWith('/api/jrx/v1/sdk/cam/dashboard');
    });
  });

  describe('SwarmApi', () => {
    it('listTopologies', async () => {
      const api = new SwarmApi(http);
      await api.listTopologies({ limit: 5 });
      expect(http.get).toHaveBeenCalledWith('/api/jrx/swarm/topologies?limit=5');
    });
  });

  describe('LegalSdkApi', () => {
    it('caseAnalysis path', async () => {
      const api = new LegalSdkApi(http);
      await api.caseAnalysis({ facts: 'breach of contract', jurisdiction: 'IN' });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/sdk/legal/case-analysis', {
        facts: 'breach of contract',
        jurisdiction: 'IN',
      });
    });
  });

  describe('EcosystemDocumentsApi', () => {
    it('processNspSharedDoc path', async () => {
      http.post.mockResolvedValue({
        data: { jobId: 'j1', taskId: 't1', status: 'queued', statusUrl: '/s', resultUrl: '/r', pollIntervalMs: 3000, expiresAt: 'x' },
      });
      const api = new EcosystemDocumentsApi(http);
      const res = await api.processNspSharedDoc({
        storageKey: 'k',
        orgId: '1',
        docId: '2',
      });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/shared-docs/process', {
        storageKey: 'k',
        orgId: '1',
        docId: '2',
      });
      expect(res.pollUrl).toBe('/s');
    });
  });

  describe('KnowledgeApi / LegalWorkApi', () => {
    it('searchArchive normalizes query→q and drops archive=all', async () => {
      const api = new KnowledgeApi(http);
      await api.searchArchive({ query: 'bail', archive: 'all', limit: 5 });
      expect(http.post).toHaveBeenCalledWith('/api/jrx/knowledge/documents/search', {
        q: 'bail',
        limit: 5,
      });
    });

    it('planeHealth and listTasks', async () => {
      const knowledge = new KnowledgeApi(http);
      const legal = new LegalWorkApi(http);
      await knowledge.planeHealth();
      await legal.listTasks({ jurisdiction: 'IN' });
      expect(http.get).toHaveBeenCalledWith('/api/jrx/knowledge/plane/health');
      expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/api/jrx/legal-work/tasks'));
    });
  });
});
