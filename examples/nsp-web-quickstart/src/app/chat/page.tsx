'use client';

import { useState } from 'react';
import type { NyvPatternResponse } from '@nyayavigya/client-sdk';
import { useNyv } from '../providers';

interface ChatAnswer {
  answer: string;
  citations?: { label: string; url?: string }[];
}

function citationLabel(c: NonNullable<NyvPatternResponse['citations']>[number]): string {
  return c.case ?? c.statute ?? c.section ?? c.url ?? 'unknown citation';
}

function summarize(res: NyvPatternResponse): ChatAnswer {
  return {
    answer: String(res.result ?? JSON.stringify(res, null, 2)),
    citations: Array.isArray(res.citations)
      ? res.citations.map((c) => ({ label: citationLabel(c), url: c.url }))
      : undefined,
  };
}

export default function ChatPage() {
  const { client } = useNyv();
  const [q, setQ] = useState('Explain BNS Section 103 (murder) with relevant case law.');
  const [a, setA] = useState<ChatAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    setBusy(true); setErr(null); setA(null);
    try {
      const res = await client.ask(q);
      setA(summarize(res));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Chat (NyayaRAG)</h2>
      <textarea
        value={q}
        onChange={e => setQ(e.target.value)}
        rows={3}
        style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #ddd', borderRadius: 6 }}
      />
      <button onClick={ask} disabled={busy} style={{ marginTop: 8, padding: '8px 14px' }}>
        {busy ? 'Asking…' : 'Ask Nyayavigya'}
      </button>
      {err && <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{err}</pre>}
      {a && (
        <div style={{ marginTop: 16, background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #e5e5e5' }}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{a.answer}</div>
          {a.citations && a.citations.length > 0 && (
            <ul style={{ marginTop: 12, fontSize: 13, color: '#555' }}>
              {a.citations.map((c, i) => (
                <li key={i}>{c.url ? <a href={c.url}>{c.label}</a> : c.label}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
