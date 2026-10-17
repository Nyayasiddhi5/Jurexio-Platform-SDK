/**
 * MatterVaultApi — /api/jrx/matter-vault/* (Harvey-style matter review scaffolding).
 */

import type { NyvHttpClient } from '../NyvClient.js';

export class MatterVaultApi {
  constructor(private readonly http: NyvHttpClient) {}

  health(): Promise<unknown> {
    return this.http.get('/api/jrx/matter-vault/health');
  }

  listMatters(): Promise<unknown> {
    return this.http.get('/api/jrx/matter-vault/matters');
  }

  createMatter(body: {
    name: string;
    matterRef?: string;
    description?: string;
    jurisdiction?: string;
    defaultDepth?: 'concise' | 'detailed' | 'comprehensive';
    depth?: 'concise' | 'detailed' | 'comprehensive';
  }): Promise<unknown> {
    return this.http.post('/api/jrx/matter-vault/matters', body);
  }

  getMatter(vaultId: string): Promise<unknown> {
    return this.http.get(`/api/jrx/matter-vault/matters/${encodeURIComponent(vaultId)}`);
  }

  uploadBatch(
    vaultId: string,
    documents: Array<{
      fileName: string;
      contentBase64: string;
      mimeType?: string;
      outputProfile?: string;
      depth?: 'concise' | 'detailed' | 'comprehensive';
    }>,
  ): Promise<unknown> {
    return this.http.post(
      `/api/jrx/matter-vault/matters/${encodeURIComponent(vaultId)}/upload-batch`,
      { documents },
    );
  }

  runPlaybook(
    vaultId: string,
    body: {
      playbookId: string;
      documentText?: string;
      probeRag?: boolean;
      ragQuery?: string;
      depth?: 'concise' | 'detailed' | 'comprehensive';
    },
  ): Promise<unknown> {
    return this.http.post(
      `/api/jrx/matter-vault/matters/${encodeURIComponent(vaultId)}/run-playbook`,
      body,
    );
  }

  /** Pack aliases (Wave-C NSP) — same backing store as matters. */
  listPacks(): Promise<unknown> {
    return this.http.get('/api/jrx/matter-vault/packs');
  }

  createPack(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/matter-vault/packs', body);
  }

  getPack(packId: string): Promise<unknown> {
    return this.http.get(`/api/jrx/matter-vault/packs/${encodeURIComponent(packId)}`);
  }

  attachPackDocuments(packId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.http.post(
      `/api/jrx/matter-vault/packs/${encodeURIComponent(packId)}/documents`,
      body,
    );
  }
}
