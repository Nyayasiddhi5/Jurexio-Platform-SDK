'use client';

import { useState } from 'react';
import type { NyvPrecedentSearchResult } from '@nyayavigya/client-sdk';
import { useNyv } from '../providers';

export default function IntelligencePage() {
  const { client } = useNyv();
  const [q, setQ] = useState('right to privacy supreme court India');
  const [results, setResults] = useState<NyvPrecedentSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    setBusy(true); setErr(null); setResults(null);
    try {
      const res = await client.intelligence.findPrecedents(q, 'IN', { maxResults: 5 });
      setResults(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Intelligence — Precedent search</h2>
      <input value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />
      <button onClick={search} disabled={busy} style={{ padding: '8px 14px' }}>
        {busy ? 'Searching…' : 'Search'}
      </button>
      {err && <pre style={{ color: 'crimson' }}>{err}</pre>}
      {results && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: '#555' }}>
            {results.matches.length} matches · strength {results.overallPrecedentStrength?.toFixed?.(2) ?? '—'}
          </p>
          <pre style={{ background: '#fff', padding: 12, border: '1px solid #e5e5e5', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
