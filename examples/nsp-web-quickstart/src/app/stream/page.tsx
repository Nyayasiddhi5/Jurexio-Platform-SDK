'use client';

import { useRef, useState } from 'react';
import type { JrxApiError, JrxPatternResponse } from '@jurexio/client-sdk';
import { useJrx } from '../providers';

export default function StreamPage() {
  const { client } = useJrx();
  const [task, setTask] = useState('Compare BNS Section 103 to IPC Section 302 (murder).');
  const [thinking, setThinking] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [done, setDone] = useState<JrxPatternResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    setThinking([]); setText(''); setDone(null); setErr(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await client.stream.streamPattern(
        'cot',
        { task },
        {
          onThinking: (step: string, i: number, total: number) =>
            setThinking(prev => [...prev, `[${i}/${total}] ${step}`]),
          onTextDelta: (delta: string) => setText(prev => prev + delta),
          onComplete: (final: JrxPatternResponse) => setDone(final),
          onError: (e: JrxApiError) => setErr(`${e.code}: ${e.message}`),
        },
        { signal: ac.signal },
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <h2>Streaming (AG-UI events)</h2>
      <textarea value={task} onChange={e => setTask(e.target.value)} rows={3} style={{ width: '100%', padding: 8 }} />
      <div style={{ marginTop: 8 }}>
        <button onClick={run} style={{ padding: '8px 14px', marginRight: 8 }}>Run CoT</button>
        <button onClick={() => abortRef.current?.abort()} style={{ padding: '8px 14px' }}>Cancel</button>
      </div>
      {err && <pre style={{ color: 'crimson' }}>{err}</pre>}
      <h3 style={{ marginTop: 16 }}>Thinking</h3>
      <ul style={{ fontSize: 13, color: '#555' }}>
        {thinking.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
      <h3>Output</h3>
      <pre style={{ background: '#fff', padding: 12, border: '1px solid #e5e5e5', whiteSpace: 'pre-wrap', minHeight: 60 }}>
        {text}
      </pre>
      {done && (
        <details style={{ marginTop: 8 }}>
          <summary>Final envelope</summary>
          <pre>{JSON.stringify(done, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
