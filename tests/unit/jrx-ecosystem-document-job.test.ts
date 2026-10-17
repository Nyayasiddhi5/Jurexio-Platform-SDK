import { describe, it, expect } from 'vitest';
import {
  legacySharedDocsToEdj,
  formatEdjStatusResponse,
  canAccessEdjJob,
  EDJ_RAW_CONTENT_PREVIEW_CHARS,
  type EdjWorkerPayload,
  type EdjRawContent,
  type EdjResultEnvelope,
} from '../../src/services/jrx-ecosystem-document-job-contract.js';

describe('./jrx-ecosystem-document-job', () => {
  it('legacySharedDocsToEdj maps NSP body to EDJ request', () => {
    const req = legacySharedDocsToEdj({
      storageKey: 'orgs/3/nsp/users/1/documents/contract.pdf',
      orgId: 3,
      docId: 456,
      jurisdiction: 'IN',
      documentType: 'commercial_contract',
    });
    expect(req.correlationId).toBe('456');
    expect(req.storageRef.type).toBe('nyv_shared_key');
    expect(req.storageRef.storageKey).toContain('contract.pdf');
    /*
     * NV-EDJ-DEFAULT-PROFILE-TEST-001 (2026-08-19) — this asserted `full_intelligence` and had
     * failed since the initial snapshot. The default was deliberately changed to `extraction`
     * ("EDJ default profile: defaults to extraction (not full_intelligence) to align with the
     * G2 gate poll window", CHANGELOG). The test predates that decision, so it was pinning a
     * contract the platform had intentionally moved away from — stale test, not a regression.
     *
     * Asserting the real default is what makes an accidental flip visible: silently upgrading
     * every partner document to full intelligence would blow the poll window and the cost
     * envelope, which is precisely why the default was lowered.
     */
    expect(req.outputProfile).toBe('extraction');
    expect(req.delivery?.callbackMetadata?.shared_storage_key).toBeTruthy();
  });

  it('upgrades to full_intelligence only when the caller opts in', () => {
    /* The opt-in is the half that carries partner-visible quality, so it is pinned explicitly
     * rather than left implied by the default above. */
    for (const optIn of [
      { outputProfile: 'full_intelligence' },
      { enableIntelligence: true },
      { fullIntelligence: true },
    ]) {
      const req = legacySharedDocsToEdj({
        storageKey: 'orgs/3/nsp/users/1/documents/contract.pdf',
        orgId: 3,
        docId: 456,
        ...optIn,
      });
      expect(req.outputProfile, JSON.stringify(optIn)).toBe('full_intelligence');
      /* Full intelligence implies the deeper pipeline, not just a louder label. */
      expect(req.outputOptions?.depth, JSON.stringify(optIn)).toBe('comprehensive');
      expect(req.outputOptions?.enableRagIndex, JSON.stringify(optIn)).toBe(true);
    }
  });

  it('formatEdjStatusResponse exposes taskId alias and progress', () => {
    const payload: EdjWorkerPayload = {
      jobId: 'edj_abc123',
      correlationId: 'doc-1',
      orgId: '3',
      platformCode: 'NSP',
      storageRef: { type: 'nyv_shared_key', storageKey: 'k' },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const row = {
      job_id: 'edj_abc123',
      status: 'processing',
      input: payload,
      output: { _progress: { phase: 'parsing', progress: 20 } },
      started_at: new Date().toISOString(),
      completed_at: null,
      error_message: null,
    };
    const formatted = formatEdjStatusResponse(row as Record<string, unknown>);
    expect(formatted.taskId).toBe('edj_abc123');
    expect(formatted.phase).toBe('parsing');
    expect(formatted.progress).toBe(20);
    expect(formatted.statusUrl).toContain('edj_abc123');
  });

  it('formatEdjStatusResponse marks expired jobs', () => {
    const payload: EdjWorkerPayload = {
      jobId: 'edj_expired',
      correlationId: 'x',
      orgId: '1',
      platformCode: 'NSP',
      storageRef: { type: 'nyv_shared_key', storageKey: 'k' },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const formatted = formatEdjStatusResponse({
      status: 'processing',
      input: payload,
      output: { _progress: { phase: 'parsing', progress: 10 } },
    } as Record<string, unknown>);
    expect(formatted.status).toBe('expired');
    expect(formatted.error?.code).toBe('JOB_EXPIRED');
  });

  it('EdjResultEnvelope rawContent structure with preview truncation', () => {
    const longText = 'A'.repeat(5000);
    const preview = longText.slice(0, EDJ_RAW_CONTENT_PREVIEW_CHARS);

    const rawContent: EdjRawContent = {
      preview,
      charCount: longText.length,
      wordCount: 1,
      pageCount: 2,
      contentUrl: '/api/jrx/v1/sdk/ecosystem-documents/jobs/edj_test/content',
      mimeType: 'text/plain',
      encoding: 'utf-8',
    };

    const envelope: EdjResultEnvelope = {
      jobId: 'edj_test',
      platformCode: 'NSP',
      correlationId: 'corr-1',
      rawContent,
      ingest: {
        nyvDocId: 'doc_1',
        chunksIndexed: 12,
        embeddingsGenerated: 12,
        graphNodesAdded: 5,
        ragReady: true,
        storagePath: 'orgs/1/nsp/documents/doc_1/file.pdf',
      },
    };

    expect(envelope.rawContent).toBeDefined();
    expect(envelope.rawContent!.preview.length).toBe(EDJ_RAW_CONTENT_PREVIEW_CHARS);
    expect(envelope.rawContent!.charCount).toBe(5000);
    expect(envelope.rawContent!.contentUrl).toContain('/content');
    expect(envelope.rawContent!.mimeType).toBe('text/plain');
    expect(envelope.rawContent!.encoding).toBe('utf-8');
  });

  it('formatEdjStatusResponse includes rawContent in completed result', () => {
    const payload: EdjWorkerPayload = {
      jobId: 'edj_withcontent',
      correlationId: 'doc-raw',
      orgId: '5',
      platformCode: 'NSI',
      storageRef: { type: 'nyv_shared_key', storageKey: 'test/doc.pdf' },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const result: EdjResultEnvelope = {
      jobId: 'edj_withcontent',
      platformCode: 'NSI',
      correlationId: 'doc-raw',
      rawContent: {
        preview: 'First 2000 chars of document...',
        charCount: 45000,
        wordCount: 8200,
        pageCount: 15,
        contentUrl: '/api/jrx/v1/sdk/ecosystem-documents/jobs/edj_withcontent/content',
        mimeType: 'text/plain',
        encoding: 'utf-8',
      },
      ingest: {
        nyvDocId: 'doc_x',
        chunksIndexed: 30,
        embeddingsGenerated: 30,
        graphNodesAdded: 12,
        ragReady: true,
        storagePath: 'orgs/5/nsi/documents/doc_x/doc.pdf',
      },
    };
    const formatted = formatEdjStatusResponse({
      status: 'completed',
      input: payload,
      output: result,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error_message: null,
    } as Record<string, unknown>);

    expect(formatted.status).toBe('completed');
    expect(formatted.resultInline).toBeDefined();
    expect((formatted.resultInline as EdjResultEnvelope)?.rawContent?.charCount).toBe(45000);
    expect((formatted.resultInline as EdjResultEnvelope)?.rawContent?.contentUrl).toContain('/content');
  });

  it('canAccessEdjJob enforces applicationId and platform isolation', () => {
    const payload: EdjWorkerPayload = {
      jobId: 'edj_acl',
      correlationId: 'c1',
      orgId: '3',
      platformCode: 'NSP',
      applicationId: 101,
      appType: 'nyayasiddhi-professional',
      storageRef: { type: 'nyv_shared_key', storageKey: 'k' },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const row = { input: payload, user_id: 'u1' };

    expect(canAccessEdjJob(row, { applicationId: 101, appType: 'nyayasiddhi-professional' })).toBe(true);
    expect(canAccessEdjJob(row, { applicationId: 202, appType: 'nsi' })).toBe(false);
    expect(canAccessEdjJob(row, { appType: 'nsi' })).toBe(false);
    expect(canAccessEdjJob(row, { appType: 'nyayasiddhi-professional' })).toBe(true);
    expect(canAccessEdjJob(row, { isPlatformAdmin: true, applicationId: 999 })).toBe(true);
    expect(canAccessEdjJob(row, { userId: 'u1' })).toBe(true);
    expect(canAccessEdjJob(row, { userId: 'other' })).toBe(false);
  });
});
