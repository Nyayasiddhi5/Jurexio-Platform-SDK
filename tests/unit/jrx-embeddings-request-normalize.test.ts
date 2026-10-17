/**
 * NV-NSP-EMBED-INPUT-001 — gateway embeddings payload normalization tests.
 */
import { describe, it, expect } from 'vitest';
import { normalizeGatewayEmbeddingsTexts } from '../../src/utils/jrx-embeddings-request-normalize.js';

describe('NV-NSP-EMBED-INPUT-001', () => {
  it('accepts canonical texts[]', () => {
    expect(normalizeGatewayEmbeddingsTexts({ texts: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('accepts documented content string', () => {
    expect(normalizeGatewayEmbeddingsTexts({ content: 'legal clause text' })).toEqual(['legal clause text']);
  });

  it('accepts docs-pipeline documents[{ id, content }]', () => {
    expect(
      normalizeGatewayEmbeddingsTexts({
        documents: [{ id: 'd1', content: 'Section 302 IPC' }, { id: 'd2', content: ' bail provision' }],
      }),
    ).toEqual(['Section 302 IPC', 'bail provision']);
  });

  it('rejects empty documents and missing fields', () => {
    expect(normalizeGatewayEmbeddingsTexts({ documents: [{ id: 'd1', content: '  ' }] })).toBeNull();
    expect(normalizeGatewayEmbeddingsTexts({})).toBeNull();
    expect(normalizeGatewayEmbeddingsTexts(null)).toBeNull();
  });
});
