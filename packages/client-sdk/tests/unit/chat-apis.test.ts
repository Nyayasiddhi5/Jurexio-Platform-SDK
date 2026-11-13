/**
 * Legal Chat and Universal Chat — routes added in @jurexio/client-sdk 5.0.0.
 * Mock HTTP for path contracts; one fetch stub for auth headers and URL joining.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JrxHttpClient } from '../../src/JrxClient.js';
import { JrxClient, LegalChatApi, UniversalChatApi } from '../../src/index.js';

const API_KEY = 'nyv_test_sk_0000000000000000000000000000000000000000';

function mockHttp(): JrxHttpClient & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  postForm: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue({ ok: true }),
    post: vi.fn().mockResolvedValue({ ok: true }),
    postForm: vi.fn().mockResolvedValue({ ok: true }),
    patch: vi.fn(),
    delete: vi.fn(),
    getBytes: vi.fn(),
  };
}

describe('LegalChatApi', () => {
  let http: ReturnType<typeof mockHttp>;

  beforeEach(() => {
    http = mockHttp();
  });

  it('calls console legal-chat routes and encodes session ids', async () => {
    const api = new LegalChatApi(http);
    const sessionId = 'sess/a b?x';
    const encoded = encodeURIComponent(sessionId);
    const form = new FormData();
    const sendBody = { prompt: 'Explain consideration', jurisdictions: ['IN'] };

    await api.createSession({ jurisdiction: 'IN' });
    await api.listSessions();
    await api.getSession(sessionId);
    await api.listAgents();
    await api.listModels();
    await api.upload(form);
    await api.submitFeedback({ sessionId, rating: 1 });
    await api.send(sendBody);

    expect(http.post).toHaveBeenCalledWith('/api/jrx/legal-chat/sessions', { jurisdiction: 'IN' });
    expect(http.get).toHaveBeenCalledWith('/api/jrx/legal-chat/sessions');
    expect(http.get).toHaveBeenCalledWith(`/api/jrx/legal-chat/sessions/${encoded}`);
    expect(http.get).toHaveBeenCalledWith('/api/jrx/legal-chat/agents');
    expect(http.get).toHaveBeenCalledWith('/api/jrx/legal-chat/models');
    expect(http.postForm).toHaveBeenCalledWith('/api/jrx/legal-chat/upload', form);
    expect(http.post).toHaveBeenCalledWith('/api/jrx/legal-chat/feedback', { sessionId, rating: 1 });
    expect(http.post).toHaveBeenCalledWith('/api/jrx/legal-chat/send', sendBody);
  });
});

describe('UniversalChatApi', () => {
  let http: ReturnType<typeof mockHttp>;

  beforeEach(() => {
    http = mockHttp();
  });

  it('calls /api/chat routes and encodes session ids on get, send, and upload', async () => {
    const api = new UniversalChatApi(http);
    const sessionId = 'sess/a b?x';
    const encoded = encodeURIComponent(sessionId);
    const form = new FormData();
    const message = { content: 'hello', useWorkflow: false };

    await api.listAgentGroups();
    await api.listLanguages();
    await api.createSession({ agentGroupId: 'g1', language: 'en' });
    await api.getSession(sessionId);
    await api.sendMessage(sessionId, message);
    await api.upload(sessionId, form);

    expect(http.get).toHaveBeenCalledWith('/api/chat/agent-groups');
    expect(http.get).toHaveBeenCalledWith('/api/chat/languages');
    expect(http.post).toHaveBeenCalledWith('/api/chat/sessions', { agentGroupId: 'g1', language: 'en' });
    expect(http.get).toHaveBeenCalledWith(`/api/chat/sessions/${encoded}`);
    expect(http.post).toHaveBeenCalledWith(`/api/chat/sessions/${encoded}/messages`, message);
    expect(http.postForm).toHaveBeenCalledWith(`/api/chat/sessions/${encoded}/upload`, form);
  });
});

describe('JrxClient chat transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes chat namespaces from the package entry', () => {
    const client = new JrxClient({ apiKey: API_KEY, baseUrl: 'https://app.jurexio.com' });
    expect(client.legalChat).toBeInstanceOf(LegalChatApi);
    expect(client.universalChat).toBeInstanceOf(UniversalChatApi);
    expect(typeof client.http.get).toBe('function');
  });

  it('joins an origin-only baseUrl, leaves apiPathPrefix unused, and sends both key headers', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: 's1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new JrxClient({
      apiKey: API_KEY,
      baseUrl: 'https://app.jurexio.com/',
      apiPathPrefix: '/api/jrx',
    });

    const session = await client.legalChat.getSession('sess/a b');

    expect(session).toEqual({ id: 's1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://app.jurexio.com/api/jrx/legal-chat/sessions/sess%2Fa%20b');
    expect(init.method).toBe('GET');
    expect(headers['X-API-Key']).toBe(API_KEY);
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['X-JRX-SDK-Version']).toBe('5.0.0');
  });

  it('upload drops the JSON content-type so the multipart boundary can be set', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { fileId: 'f1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new JrxClient({ apiKey: API_KEY, baseUrl: 'https://app.jurexio.com' });
    const form = new FormData();
    form.set('file', 'bytes');

    const uploaded = await client.universalChat.upload('session-1', form);

    expect(uploaded).toEqual({ fileId: 'f1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://app.jurexio.com/api/chat/sessions/session-1/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(form);
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['X-API-Key']).toBe(API_KEY);
  });
});
