/**
 * Shared FetchHttpClient used by every SDK namespace and by public JrxClient.http.
 * Proves error envelopes, data unwrapping, binary downloads, and auth headers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { JrxClient, JrxError } from '../../src/index.js';
import type { JrxClientConfig } from '../../src/index.js';

const API_KEY = 'nyv_test_sk_0000000000000000000000000000000000000000';
const BASE = 'https://app.jurexio.com';

function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return new Response(JSON.stringify(body), {
    status,
    statusText: init.statusText ?? (status >= 400 ? 'Error' : 'OK'),
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function client(overrides: Partial<JrxClientConfig> = {}): JrxClient {
  return new JrxClient({ apiKey: API_KEY, baseUrl: BASE, ...overrides });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JrxClient HTTP errors', () => {
  it('maps code, message, details, and the trace header, preferring message over error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            code: 'VALIDATION',
            message: 'session id required',
            error: 'ignored',
            details: { field: 'sessionId' },
            data: { id: 'must-not-leak' },
          },
          { status: 422, statusText: 'Unprocessable Entity', headers: { 'X-JRX-Trace-Id': 'trace-9' } },
        ),
      ),
    );

    const err = await client().http.get('/api/jrx/health').then(
      () => {
        throw new Error('expected JrxError');
      },
      (caught: unknown) => caught,
    );

    expect(err).toBeInstanceOf(JrxError);
    expect(err).toMatchObject({
      name: 'JrxError',
      code: 'VALIDATION',
      message: 'session id required',
      status: 422,
      traceId: 'trace-9',
      details: { field: 'sessionId' },
    });
  });

  it('uses the NV error string when message is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { success: false, error: 'relation documents does not exist' },
          { status: 500, statusText: 'Internal Server Error' },
        ),
      ),
    );

    await expect(client().http.post('/api/jrx/patterns/cot', { task: 'x' })).rejects.toMatchObject({
      code: 'API_ERROR',
      message: 'relation documents does not exist',
      status: 500,
      traceId: undefined,
    });
  });

  it('falls back to the HTTP status line when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream down', { status: 503, statusText: 'Service Unavailable' })),
    );

    await expect(client().http.get('/api/jrx/health')).rejects.toMatchObject({
      code: 'API_ERROR',
      message: 'HTTP 503 Service Unavailable',
      status: 503,
    });
  });

  it('keeps an empty message instead of replacing it with the error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ code: 'EMPTY', message: '', error: 'fallback' }, { status: 400 }),
      ),
    );

    await expect(client().http.get('/api/jrx/health')).rejects.toMatchObject({
      code: 'EMPTY',
      message: '',
      status: 400,
    });
  });
});

describe('JrxClient HTTP success', () => {
  it('unwraps data, including 0 and null, and returns a body that has no data key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 's1' }, meta: { page: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: 0 }))
      .mockResolvedValueOnce(jsonResponse({ data: null, extra: 1 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'raw', ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const http = client().http;
    await expect(http.get('/api/jrx/a')).resolves.toEqual({ id: 's1' });
    await expect(http.get('/api/jrx/b')).resolves.toBe(0);
    await expect(http.get('/api/jrx/c')).resolves.toBeNull();
    await expect(http.get('/api/jrx/d')).resolves.toEqual({ id: 'raw', ok: true });
  });

  it('sends DELETE without a body and PATCH with a JSON body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const http = client().http;

    await http.delete('/api/jrx/sessions/1');
    await http.patch('/api/jrx/sessions/1', { name: 'a' });

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(deleteUrl).toBe(`${BASE}/api/jrx/sessions/1`);
    expect(deleteInit.method).toBe('DELETE');
    expect(deleteInit.body).toBeUndefined();
    expect(patchUrl).toBe(`${BASE}/api/jrx/sessions/1`);
    expect(patchInit.method).toBe('PATCH');
    expect(patchInit.body).toBe(JSON.stringify({ name: 'a' }));
    expect(headersOf(patchInit)['Content-Type']).toBe('application/json');
  });
});

describe('JrxClient getBytes', () => {
  it('returns bytes, the content type, and a quoted filename', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="matter brief.pdf"',
          },
        }),
      ),
    );

    const downloaded = await client().http.getBytes('/api/jrx/doc-ai/jobs/1/result');
    expect(Array.from(downloaded.data)).toEqual([9, 8, 7]);
    expect(downloaded.mimeType).toBe('application/pdf');
    expect(downloaded.fileName).toBe('matter brief.pdf');
  });

  it('reads an unquoted filename and omits fileName when the header is absent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'Content-Disposition': 'inline; filename=order.pdf' },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([2]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const http = client().http;

    await expect(http.getBytes('/api/jrx/files/a')).resolves.toMatchObject({
      mimeType: 'application/octet-stream',
      fileName: 'order.pdf',
    });
    const plain = await http.getBytes('/api/jrx/files/b');
    expect(Array.from(plain.data)).toEqual([2]);
    expect(plain.fileName).toBeUndefined();
    expect(plain.mimeType).toBe('application/octet-stream');
  });

  it('raises JrxError from the error field on a failed download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: 'relation documents does not exist' },
          { status: 500, headers: { 'X-JRX-Trace-Id': 'trace-dl' } },
        ),
      ),
    );

    await expect(client().http.getBytes('/api/jrx/files/missing')).rejects.toMatchObject({
      code: 'API_ERROR',
      message: 'relation documents does not exist',
      status: 500,
      traceId: 'trace-dl',
    });
  });
});

describe('JrxClient auth headers', () => {
  it('sends the default platform header and omits optional NSP headers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { status: 'ok', version: '5.0.0' } }));
    vi.stubGlobal('fetch', fetchMock);

    await client().http.get('/api/jrx/health');

    const headers = headersOf(fetchMock.mock.calls[0][1] as RequestInit);
    expect(headers['X-API-Key']).toBe(API_KEY);
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['X-JRX-Platform']).toBe('nys-professional');
    expect(headers['X-JRX-SDK-Version']).toBe('5.0.0');
    expect(headers['X-NSP-Client']).toBeUndefined();
    expect(headers['X-NSP-Inter-Secret']).toBeUndefined();
  });

  it('sends the platform client, inter-service secret, and a custom platform', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);

    await client({
      defaultPlatform: 'jurexio-citizen',
      platformClient: 'nyayasiddhi-professional/1.0.0',
      interServiceSecret: 'east-west-secret',
      version: '5.0.0-test',
    }).http.get('/api/jrx/health');

    const headers = headersOf(fetchMock.mock.calls[0][1] as RequestInit);
    expect(headers['X-JRX-Platform']).toBe('jurexio-citizen');
    expect(headers['X-NSP-Client']).toBe('nyayasiddhi-professional/1.0.0');
    expect(headers['X-NSP-Inter-Secret']).toBe('east-west-secret');
    expect(headers['X-JRX-SDK-Version']).toBe('5.0.0-test');
  });
});

describe('JrxClient health and orchestrate defaults', () => {
  it('healthCheck returns status, version, and the configured jurisdiction', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: { status: 'degraded', version: '5.0.0' } })),
    );

    const health = await client({ defaultJurisdiction: 'UK' }).healthCheck();
    expect(health.status).toBe('degraded');
    expect(health.version).toBe('5.0.0');
    expect(health.jurisdiction).toBe('UK');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('orchestrate injects the default jurisdiction and keeps an explicit one', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { answer: 'ok' } }));
    vi.stubGlobal('fetch', fetchMock);
    const sdk = client({ defaultJurisdiction: 'UK' });

    await sdk.orchestrate({ prompt: 'draft', jurisdiction: 'US' });
    await sdk.orchestrate({ prompt: 'draft' });
    await sdk.callAgent('research', 'find cases');

    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/jrx/orchestrate`);
    expect(bodies[0]).toMatchObject({ prompt: 'draft', jurisdiction: 'US' });
    expect(bodies[1]).toMatchObject({ prompt: 'draft', jurisdiction: 'UK' });
    expect(bodies[2]).toMatchObject({
      prompt: 'find cases',
      agentKey: 'research',
      jurisdiction: 'UK',
    });
  });
});

describe('JrxClient timeout', () => {
  it('aborts the request when the client timeout elapses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise((_resolve, reject) => {
          if (!signal) {
            reject(new Error('missing abort signal'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      }),
    );

    await expect(client({ timeout: 30 }).http.get('/api/jrx/health')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
