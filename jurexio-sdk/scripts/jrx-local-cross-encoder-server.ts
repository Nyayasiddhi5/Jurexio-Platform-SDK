#!/usr/bin/env npx tsx
/**
 * NV-LOCAL-CE-001 — lightweight cross-encoder HTTP for CI / keyless soak.
 *
 * POST { pairs: [{ query, passage }] } → { scores: number[], provider: './jrx-local-ce' }
 *
 * Uses TF–IDF cosine (deterministic, no external keys). Real Cohere/Voyage
 * still preferred when COHERE_API_KEY / VOYAGE_API_KEY are non-empty.
 *
 *   JRX_LOCAL_CE_PORT=8791 npx tsx scripts/jrx-local-cross-encoder-server.ts
 */
import * as http from 'node:http';

const PORT = Math.max(1, Number(process.env.JRX_LOCAL_CE_PORT) || 8791);

function tokenize(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function tf(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  const n = tokens.length || 1;
  for (const [k, v] of m) m.set(k, v / n);
  return m;
}

function cosine(a: Map<string, number>, b: Map<string, number>, idf: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const w = idf.get(k) || 1;
    const av = (a.get(k) || 0) * w;
    const bv = (b.get(k) || 0) * w;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / Math.sqrt(na * nb);
}

function scorePairs(pairs: Array<{ query?: string; passage?: string }>): number[] {
  const docs = pairs.map((p) => tokenize(String(p.passage || '')));
  const queries = pairs.map((p) => tokenize(String(p.query || '')));
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = Math.max(1, docs.length);
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log(1 + N / (1 + c)) + 1);
  return pairs.map((_, i) => {
    const q = tf(queries[i]);
    const d = tf(docs[i]);
    // Legal/domain cue boosts
    const blob = String(pairs[i].passage || '').toLowerCase();
    const qblob = String(pairs[i].query || '').toLowerCase();
    let boost = 0;
    for (const cue of ['section', 'act', 'bns', 'checklist', 'policy', 'incident', 'vendor', 'raci', 'board']) {
      if (qblob.includes(cue) && blob.includes(cue)) boost += 0.05;
    }
    return Math.min(1, cosine(q, d, idf) + boost);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, provider: './jrx-local-ce' }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: any = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'invalid_json' }));
    return;
  }
  const pairs = Array.isArray(body.pairs) ? body.pairs : [];
  const scores = scorePairs(pairs);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ scores, provider: './jrx-local-ce' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ listening: `http://127.0.0.1:${PORT}`, provider: './jrx-local-ce' }));
});
