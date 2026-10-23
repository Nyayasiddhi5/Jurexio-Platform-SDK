/**
 * Platform docparse — /api/jrx/v1/sdk/docparse/*
 * Legal-first engine (@jurexio/docparse-sdk) with async jobs for large PDFs/scans.
 */

import type { JrxHttpClient } from '../JrxClient.js';
import type { DocparseMetaPartner } from '../types/JrxLegalDocparse.js';

export interface DocparseJobSubmitBody {
  base64?: string;
  fileName?: string;
  mimeType?: string;
  documents?: Array<{ base64: string; fileName?: string; mimeType?: string }>;
  domainPackId?: string;
  forceOcr?: boolean;
  preferOcr?: boolean;
  maxPagesPerDoc?: number;
}

export interface DocparseJobAccepted {
  jobId: string;
  status: string;
  batchId: string;
}

export interface DocparseJobStatusResponse {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  progress?: { pageNo: number; pageTotal: number; documentId: string };
  error?: string;
  result?: unknown;
}

export interface DomainPackCatalogEntry {
  id: string;
  label: string;
  version: string;
  jurisdiction: string;
  source: 'builtin' | 'json';
}

export class DocparseApi {
  constructor(private readonly http: JrxHttpClient) {}

  listPacks(): Promise<{ packs: DomainPackCatalogEntry[] }> {
    return this.http.get('/api/jrx/v1/sdk/docparse/packs') as Promise<{ packs: DomainPackCatalogEntry[] }>;
  }

  submitJob(body: DocparseJobSubmitBody): Promise<DocparseJobAccepted> {
    return this.http.post('/api/jrx/v1/sdk/docparse/jobs', body) as Promise<DocparseJobAccepted>;
  }

  getJob(jobId: string): Promise<DocparseJobStatusResponse> {
    return this.http.get(`/api/jrx/v1/sdk/docparse/jobs/${encodeURIComponent(jobId)}`) as Promise<DocparseJobStatusResponse>;
  }

  /**
   * NSP-only gap recovery (requires X-JRX-Platform: nsp on the HTTP client).
   * Call when local docparse left empty pages or could not map autofill fields.
   */
  nspAgentRecover(body: DocparseJobSubmitBody & {
    localParse?: Record<string, unknown>;
    options?: { partialLlm?: boolean; extractiveSummary?: boolean; humanReviewPagesOnly?: boolean };
  }): Promise<Record<string, unknown>> {
    return this.http.post('/api/jrx/v1/sdk/docparse/nsp/agent-recover', body) as Promise<Record<string, unknown>>;
  }

  /** NSP-only vision depiction for case photos / medical imaging (requires X-JRX-Platform: nsp). */
  nspEvidenceDepict(body: DocparseJobSubmitBody & {
    localVisibleText?: string;
    userQuestion?: string;
    pageNo?: number;
  }): Promise<Record<string, unknown>> {
    return this.http.post('/api/jrx/v1/sdk/docparse/nsp/evidence-depict', body) as Promise<Record<string, unknown>>;
  }

  /** NSP Pro onboarding — PAN / Bar Council / firm cert → autofill JSON (OCR on JRX). */
  nspOnboardingExtract(body: DocparseJobSubmitBody & {
    ingestRole?: string;
    documentHint?: 'panCard' | 'barCert' | 'firmCert' | 'auto';
  }): Promise<Record<string, unknown>> {
    return this.http.post('/api/jrx/v1/sdk/docparse/nsp/onboarding-extract', body) as Promise<
      Record<string, unknown>
    >;
  }

  /** NSP draft/chat — prompt-only understanding when local parse is partial (no re-OCR). */
  nspAttachUnderstand(body: {
    userPrompt?: string;
    prompt?: string;
    attachContext?: Record<string, unknown>;
    jurisdiction?: string;
    matterSummary?: string;
  }): Promise<Record<string, unknown>> {
    return this.http.post('/api/jrx/v1/sdk/docparse/nsp/attach-understand', body) as Promise<Record<string, unknown>>;
  }
}

/** Shape returned on analyze/ingest when Platform SDK participated. */
export type PartnerDocparseMeta = DocparseMetaPartner;
