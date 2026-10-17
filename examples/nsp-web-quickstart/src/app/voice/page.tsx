'use client';

import { useState } from 'react';
import { useNyv } from '../providers';

export default function VoicePage() {
  const { client } = useNyv();
  const [text, setText] = useState('यह एक नमूना उत्तर है।');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function speak() {
    setBusy(true); setErr(null); setAudioUrl(null);
    try {
      const res = await client.voice.synthesize({
        text,
        language: 'hi',
        voice: 'sarvam-meera',
      });
      if (!res.audioBase64) throw new Error('no audio in response');
      setAudioUrl(`data:audio/${res.format ?? 'wav'};base64,${res.audioBase64}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Voice (Sarvam)</h2>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} style={{ width: '100%', padding: 8 }} />
      <button onClick={speak} disabled={busy} style={{ marginTop: 8, padding: '8px 14px' }}>
        {busy ? 'Synthesizing…' : 'Synthesize'}
      </button>
      {err && <pre style={{ color: 'crimson' }}>{err}</pre>}
      {audioUrl && <audio controls src={audioUrl} style={{ display: 'block', marginTop: 16, width: '100%' }} />}
    </div>
  );
}
