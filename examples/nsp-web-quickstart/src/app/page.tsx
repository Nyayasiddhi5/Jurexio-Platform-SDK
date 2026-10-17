import Link from 'next/link';

const flows = [
  { href: '/chat',         title: '1. Chat (NyayaRAG)',          desc: 'Ask a legal question with citations and follow-ups.' },
  { href: '/document',     title: '2. Document analyze',          desc: 'Upload a PDF, wait for ingestion, get clause analysis.' },
  { href: '/voice',        title: '3. Voice (Sarvam)',            desc: 'Synthesize a Hindi audio answer from any prompt.' },
  { href: '/intelligence', title: '4. Intelligence',              desc: 'Run precedent search + bias / readability scoring.' },
  { href: '/stream',       title: '5. Streaming (AG-UI events)',  desc: 'Watch a CoT pattern execute live with token deltas.' },
];

export default function HomePage() {
  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>NSP Web Quickstart</h1>
      <p style={{ color: '#555' }}>
        This sample demonstrates the five most common <code>@nyayavigya/client-sdk</code> v6 flows.
        All API traffic is proxied through the Next.js route handlers under{' '}
        <code>/api/jrx-proxy/*</code> so your live API key never reaches the browser.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 24 }}>
        {flows.map(f => (
          <li key={f.href} style={{ padding: 16, marginBottom: 12, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8 }}>
            <Link href={f.href} style={{ color: '#0a58ff', textDecoration: 'none' }}>
              <strong>{f.title}</strong>
            </Link>
            <div style={{ color: '#666', marginTop: 4, fontSize: 14 }}>{f.desc}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
