'use client';

import { useState } from 'react';
import type { JrxDocumentAnalysis, JrxDocumentStatus } from '@jurexio/client-sdk';

interface UploadResult {
  docId: string;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export default function DocumentPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [analysis, setAnalysis] = useState<JrxDocumentAnalysis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!file) return;
    setErr(null); setAnalysis(null); setStatus('uploading…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fileName', file.name);
      const { docId } = await jsonFetch<UploadResult>(
        '/api/jrx-proxy/api/jrx/documents/upload',
        { method: 'POST', body: fd },
      );

      setStatus(`indexing (docId=${docId}) …`);
      let lastStatus: JrxDocumentStatus['status'] | undefined;
      for (let i = 0; i < 60; i++) {
        const s = await jsonFetch<JrxDocumentStatus>(`/api/jrx-proxy/api/jrx/documents/${docId}/status`);
        lastStatus = s.status;
        if (s.status === 'COMPLETED') break;
        if (s.status === 'FAILED') throw new Error('indexing failed');
        await new Promise(r => setTimeout(r, 1500));
      }
      if (lastStatus !== 'COMPLETED') throw new Error('indexing timeout');

      setStatus('analyzing…');
      // The doc-analyze API is text-based; we ask the proxy for the document's
      // extracted text first, then run analysis. (Alternatively, call
      // client.documents.extractAndAnalyze() in a Node-side route.)
      const { text } = await jsonFetch<{ text: string }>(
        `/api/jrx-proxy/api/jrx/documents/${docId}/text`,
      );
      const aRes = await jsonFetch<JrxDocumentAnalysis>(
        '/api/jrx-proxy/api/jrx/doc-analyze/analyze',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, options: { mode: 'clauses' } }),
        },
      );
      setAnalysis(aRes);
      setStatus('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div>
      <h2>Document analyze</h2>
      <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={run} disabled={!file || status === 'uploading…' || status === 'analyzing…'} style={{ marginLeft: 8 }}>
        Run
      </button>
      <p style={{ marginTop: 8, color: '#555' }}>Status: <code>{status}</code></p>
      {err && <pre style={{ color: 'crimson' }}>{err}</pre>}
      {analysis && <pre style={{ background: '#fff', padding: 12, border: '1px solid #e5e5e5' }}>{JSON.stringify(analysis, null, 2)}</pre>}
    </div>
  );
}
