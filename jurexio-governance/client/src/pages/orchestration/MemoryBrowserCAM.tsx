import { useEffect, useState } from 'react';
import { Brain, Database, Clock, AlertCircle, Construction } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv, p } from '@/lib/jrx-api-paths';

function FiveTierInspector() {
  const [sessionId, setSessionId] = useState('');
  const [matterId, setMatterId] = useState('');
  const [clientId, setClientId] = useState('');
  const [jurisdiction, setJurisdiction] = useState('IN');
  const [traceId, setTraceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [tiers, setTiers] = useState<Record<string, { ok: boolean; count: number; note?: string }>>({});

  async function load() {
    setBusy(true);
    const token = getAuthToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const pull = async (label: string, url: string) => {
      try {
        const r = await fetch(url, { credentials: 'include', headers });
        const j = await r.json().catch(() => ({}));
        const data = j?.data ?? j;
        const count = Array.isArray(data) ? data.length : (data?.size ?? (data ? 1 : 0));
        return { label, ok: r.ok, count: Number(count) || 0, note: r.ok ? undefined : `HTTP ${r.status}` };
      } catch (e) {
        return { label, ok: false, count: 0, note: e instanceof Error ? e.message : 'failed' };
      }
    };
    const rows = await Promise.all([
      pull('L1 working', nv(`jrx-legal-tools/memory/working/${encodeURIComponent(traceId || sessionId || 'none')}`)),
      pull('L1 episodic', nv(`jrx-legal-tools/memory/episodic/${encodeURIComponent(sessionId || 'none')}`)),
      pull('L2 matter', nv(`jrx-legal-tools/memory/matter/${encodeURIComponent(matterId || 'none')}`)),
      pull('L3 client', nv(`jrx-legal-tools/memory/client/${encodeURIComponent(clientId || 'none')}`)),
      pull('L4 jurisdictional', nv(`jrx-legal-tools/memory/jurisdictional/${encodeURIComponent(jurisdiction || 'IN')}`)),
      pull('L5 precedent', nv(`jrx-legal-tools/memory/precedent/${encodeURIComponent(jurisdiction || 'IN')}`)),
    ]);
    const next: Record<string, { ok: boolean; count: number; note?: string }> = {};
    for (const r of rows) next[r.label] = { ok: r.ok, count: r.count, note: r.note };
    setTiers(next);
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3" data-testid="memory-l1-l5">
      <div className="text-sm font-semibold text-[#152448]">5-tier memory inspector</div>
      <p className="text-xs text-slate-600">Honest L1–L5 from <code>/api/jrx/jrx-legal-tools/memory/*</code>. mem0/CAM entries stay in the table below (preference strip).</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input className="border rounded px-2 py-1 text-xs" placeholder="sessionId (L1)" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
        <input className="border rounded px-2 py-1 text-xs" placeholder="traceId (L1 working)" value={traceId} onChange={(e) => setTraceId(e.target.value)} />
        <input className="border rounded px-2 py-1 text-xs" placeholder="matterId (L2)" value={matterId} onChange={(e) => setMatterId(e.target.value)} />
        <input className="border rounded px-2 py-1 text-xs" placeholder="clientId (L3)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <input className="border rounded px-2 py-1 text-xs" placeholder="jurisdiction (L4/L5)" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
      </div>
      <button type="button" className="text-xs px-3 py-1 rounded border font-semibold" onClick={() => void load()} disabled={busy}>
        {busy ? 'Loading…' : 'Inspect tiers'}
      </button>
      {Object.keys(tiers).length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(tiers).map(([k, v]) => (
            <div key={k} className="border rounded p-2 text-xs">
              <div className="font-semibold">{k}</div>
              <div>{v.ok ? `${v.count} rows` : v.note}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface CamEntry {
  id: string;
  agent_id?: string;
  request_id?: string;
  scope?: string;
  ttl_seconds?: number;
  created_at?: string;
  payload?: any;
}

export default function MemoryBrowserCAM() {
  const [entries, setEntries] = useState<CamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiPartial, setApiPartial] = useState(false);
  const [stats, setStats] = useState<{ total: number; agents: number; scopes: string[] }>({ total: 0, agents: 0, scopes: [] });

  useEffect(() => {
    const token = getAuthToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.allSettled([
      fetch(`${p('CAM_ENTRIES')}?limit=100`, { headers }).then(async (r) => {
        if (!r.ok) { setApiPartial(true); return null; }
        return r.json();
      }),
      fetch(p('CAM_STATS'), { headers }).then(async (r) => {
        if (!r.ok) { setApiPartial(true); return null; }
        return r.json();
      }),
    ]).then(([entriesRes, statsRes]) => {
      const list: CamEntry[] = (entriesRes && entriesRes.status === 'fulfilled' && entriesRes.value)
        ? (entriesRes.value.data?.entries ?? entriesRes.value.entries ?? entriesRes.value.data ?? [])
        : [];
      setEntries(Array.isArray(list) ? list : []);
      if (statsRes && statsRes.status === 'fulfilled' && statsRes.value) {
        const d = statsRes.value.data ?? statsRes.value;
        setStats({
          total: d.total_entries ?? d.total ?? list.length,
          agents: d.distinct_agents ?? new Set(list.map(e => e.agent_id).filter(Boolean)).size,
          scopes: d.scopes ?? Array.from(new Set(list.map(e => e.scope).filter(Boolean) as string[])),
        });
      } else {
        setStats({
          total: list.length,
          agents: new Set(list.map(e => e.agent_id).filter(Boolean)).size,
          scopes: Array.from(new Set(list.map(e => e.scope).filter(Boolean) as string[])),
        });
      }
    }).catch(e => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen p-6 bg-[#F8FAFC]">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-blue-700">
            <Brain className="w-5 h-5 text-[#C7B15B]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[#152448]" style={{ fontFamily: 'Merriweather, serif' }}>Memory Browser (CAM)</h1>
              {apiPartial && (
                <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50">
                  <Construction className="w-3 h-3 mr-1" /> Partial — entries API pending
                </Badge>
              )}
            </div>
            <p className="text-sm text-slate-700">
              Contextual Agent Memory — live at <code>{p('CAM_ENTRIES')}</code> and{' '}
              <code>{p('CAM_REVIEWS')}</code> (compliance_reviewer+ JWT).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-700 text-xs"><Database className="w-3.5 h-3.5" /> Total entries</div>
            <div className="text-2xl font-bold text-[#152448] mt-1">{stats.total.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-700 text-xs"><Brain className="w-3.5 h-3.5" /> Distinct agents</div>
            <div className="text-2xl font-bold text-[#152448] mt-1">{stats.agents.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-700 text-xs"><Clock className="w-3.5 h-3.5" /> Scopes</div>
            <div className="text-sm font-semibold text-[#152448] mt-1">{stats.scopes.length ? stats.scopes.join(', ') : '—'}</div>
          </div>
        </div>

        <FiveTierInspector />

        <div className="bg-white rounded-lg border border-slate-200">
          <div className="px-4 py-2 border-b border-slate-200 text-sm font-semibold text-[#152448]">Recent CAM entries</div>
          {loading ? (
            <div className="p-6 text-sm text-slate-700">Loading…</div>
          ) : error ? (
            <div className="p-6 text-sm text-red-700 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-sm text-slate-700">
              {apiPartial
                ? 'CAM reviewer actions are live; the memory entry browser API is not mounted yet. Use Orchestration → CAM dashboard for live monitoring.'
                : 'No CAM entries returned yet. Once orchestrations write to CAM, entries will list here.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-700 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Agent</th>
                  <th className="px-3 py-2 text-left">Scope</th>
                  <th className="px-3 py-2 text-left">Request</th>
                  <th className="px-3 py-2 text-left">TTL</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-t border-slate-100 text-slate-800">
                    <td className="px-3 py-2 font-mono text-xs">{e.agent_id ?? '—'}</td>
                    <td className="px-3 py-2">{e.scope ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.request_id ?? '—'}</td>
                    <td className="px-3 py-2">{e.ttl_seconds ? `${e.ttl_seconds}s` : '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-700">{e.created_at ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
