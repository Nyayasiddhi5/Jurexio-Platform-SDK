import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
import PartnerSmokePanel from '@/components/admin/PartnerSmokePanel';
// ──────────────────────────────────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Header { key: string; value: string; enabled: boolean; }
interface Param  { key: string; value: string; enabled: boolean; }

interface EndpointDef {
  id: string; label: string; method: HttpMethod; path: string;
  description: string; sampleBody?: string; sampleResponse?: string;
  params?: { key: string; value: string }[];
}

interface PlatformDef {
  id: string; name: string; color: string; icon: string;
  baseTag: string; endpoints: EndpointDef[];
}

interface HistoryEntry {
  id: string; ts: string; method: HttpMethod; url: string;
  status: number; duration: number; platform: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// PLATFORM CATALOG
// ──────────────────────────────────────────────────────────────────────────────

const PLATFORMS: PlatformDef[] = [
  {
    id: 'core', name: 'NYV Core SDK', color: '#f59e0b', icon: '⚡', baseTag: '/api/jrx',
    endpoints: [
      { id: 'health', label: 'Health Check', method: 'GET', path: nv('health'), description: 'System health, agent count, provider status.', sampleResponse: '{"status":"operational","agents":148}' },
      { id: 'health-full', label: 'Full Health', method: 'GET', path: nv('health/full'), description: 'Extended health including RAG and provider matrix.' },
      { id: 'models', label: 'LLM Models', method: 'GET', path: nv('models'), description: 'Dynamic model registry (SSoT).' },
      { id: 'agents-list', label: 'List Agents', method: 'GET', path: nv('agents'), description: 'Full ROMA L5 agent registry.' },
      { id: 'orchestrate', label: 'Orchestrate', method: 'POST', path: nv('orchestrate'), description: 'Queen orchestration (console JWT).', sampleBody: '{\n  "prompt": "Summarise IPC Section 302",\n  "jurisdiction": "IN"\n}' },
      { id: 'stream', label: 'Stream (AG-UI)', method: 'POST', path: nv('stream'), description: 'AG-UI Queen stream with 16-step trace.', sampleBody: '{\n  "prompt": "Explain habeas corpus",\n  "jurisdiction": "IN"\n}' },
      { id: 'mcp-catalog', label: 'MCP Catalog', method: 'GET', path: nv('nyaya-tools/catalog?limit=100'), description: 'Full Nyaya Tools MCP catalog.' },
      { id: 'mcp-invoke', label: 'Invoke MCP Tool', method: 'POST', path: nv('tools/mcp/invoke'), description: 'Invoke an executable MCP tool.', sampleBody: '{\n  "toolId": "statute_lookup",\n  "input": {"query": "IPC 302", "jurisdiction": "IN"}\n}' },
      { id: 'topologies', label: 'Swarm Topologies', method: 'GET', path: nv('swarm/topologies'), description: 'Swarm topology definitions.' },
      { id: 'token-stats', label: 'Token Stats', method: 'GET', path: nv('analytics/tokens'), description: 'Token usage and cost analytics.' },
    ]
  },
  {
    id: 'partner', name: 'Partner SDK (NSP/NYM)', color: '#10b981', icon: '🏛️', baseTag: 'SDK',
    endpoints: [
      { id: 'sdk-orch', label: 'SDK Orchestrate', method: 'POST', path: nv('v1/sdk/orchestrate'), description: 'Partner orchestrate (SDK key auth).', sampleBody: '{\n  "taskType": "legal-chat-fast",\n  "prompt": "What is anticipatory bail?",\n  "jurisdiction": "IN"\n}' },
      { id: 'sdk-models', label: 'Gateway Models', method: 'GET', path: nv('gateway/models'), description: 'Partner-visible model catalog.' },
      { id: 'cnr-resolve', label: 'CNR Resolve', method: 'POST', path: nv('v1/sdk/cnr/resolve'), description: 'NSP CNR resolve (unified identifier).', sampleBody: '{\n  "identifier": "TSWL000000742024",\n  "options": { "profile": "caseCreate", "courtType": "dc", "includeDocuments": true }\n}' },
      { id: 'docparse-health', label: 'Docparse health', method: 'GET', path: nv('v1/sdk/docparse/health'), description: 'Docparse SDK mount + feature flags.' },
      { id: 'jrx-docparse-health', label: 'JRX docparse health', method: 'GET', path: nv('v1/sdk/jrx/docparse/health'), description: 'JRX alias mount (same router).' },
      { id: 'cnr-health', label: 'CNR Health', method: 'GET', path: nv('v1/sdk/cnr/health'), description: 'CNR subsystem health.' },
      { id: 'legal-feed', label: 'Legal Feed', method: 'GET', path: nv('v1/sdk/legal-intelligence/feed'), description: 'Live legal intelligence digest.', params: [{ key: 'jurisdiction', value: 'IN' }] },
      { id: 'llm-catalog', label: 'LLM Catalog', method: 'GET', path: nv('v1/sdk/llm/catalog'), description: 'Partner LLM catalog.' },
      { id: 'llm-router-health', label: 'LLM Router Health', method: 'GET', path: nv('v1/sdk/llm/router/health'), description: 'Partner router health matrix.' },
      { id: 'patra-health', label: 'Patra Mitra Health', method: 'GET', path: nv('v1/sdk/patra-mitra/health'), description: 'Document companion subsystem health.' },
    ]
  },
  {
    id: 'gateway', name: 'Gateway APIs', color: '#3b82f6', icon: '⚖️', baseTag: 'GW',
    endpoints: [
      { id: 'gw-info', label: 'Platform Info', method: 'GET', path: nv('gateway/info'), description: 'Gateway platform metadata.' },
      { id: 'gw-research', label: 'Legal Research', method: 'POST', path: nv('gateway/research/query'), description: 'Deep legal research with citation.', sampleBody: '{\n  "query": "Landmark SC judgements on privacy rights",\n  "jurisdiction": "India",\n  "options": {}\n}' },
      { id: 'gw-statute', label: 'Statute Lookup', method: 'POST', path: nv('gateway/research/statute'), description: 'Statute section lookup.', sampleBody: '{\n  "statute": "Indian Penal Code",\n  "section": "302",\n  "jurisdiction": "India"\n}' },
      { id: 'gw-draft', label: 'Document Draft', method: 'POST', path: nv('gateway/documents/draft'), description: 'AI document drafting.', sampleBody: '{\n  "documentType": "legal_notice",\n  "jurisdiction": "IN",\n  "facts": "Tenant rent default"\n}' },
      { id: 'gw-agent-exec', label: 'Execute Agent', method: 'POST', path: nv('gateway/agents/jrx-legal-researcher-001/execute'), description: 'Execute a registered agent.', sampleBody: '{\n  "input": "Analyze this legal scenario...",\n  "context": {},\n  "options": {}\n}' },
      { id: 'gw-translate', label: 'Translate', method: 'POST', path: nv('gateway/translate'), description: 'Legal text translation.', sampleBody: '{\n  "text": "The court has ruled in favor of the plaintiff.",\n  "sourceLang": "en",\n  "targetLang": "hi"\n}' },
    ]
  },
  {
    id: 'documents', name: 'SDK Documents Pipeline', color: '#8b5cf6', icon: '📄', baseTag: 'DOC',
    endpoints: [
      { id: 'doc-parse', label: 'Parse Document', method: 'POST', path: nv('sdk/docs-pipeline/documents/parse'), description: 'Parse uploaded document text.', sampleBody: '{\n  "content": "This agreement is entered into...",\n  "format": "text"\n}' },
      { id: 'doc-intel', label: 'Document Intelligence', method: 'POST', path: nv('sdk/docs-pipeline/documents/intelligence'), description: 'Risk and clause intelligence.', sampleBody: '{\n  "content": "This agreement...",\n  "analysisType": "risk",\n  "jurisdiction": "India"\n}' },
      { id: 'doc-summarize', label: 'Summarize', method: 'POST', path: nv('sdk/docs-pipeline/documents/summarize'), description: 'Document summarization.', sampleBody: '{\n  "content": "Long contract text...",\n  "style": "brief"\n}' },
      { id: 'doc-templates', label: 'List Templates', method: 'GET', path: nv('sdk/docs-pipeline/documents/templates'), description: 'Available document templates.' },
      { id: 'doc-clauses', label: 'Clause Library', method: 'GET', path: nv('sdk/docs-pipeline/clauses/library'), description: 'Clause library catalog.' },
    ]
  },
  {
    id: 'governance', name: 'Governance & Compliance', color: '#ef4444', icon: '⚙️', baseTag: 'GOV',
    endpoints: [
      { id: 'gov-surface', label: 'Governance Surface', method: 'GET', path: nv('governance/surface'), description: 'Aggregated governance counts.' },
      { id: 'compliance-iso', label: 'ISO Compliance', method: 'GET', path: nv('compliance/iso'), description: 'ISO 42001 / SOC2 framework status.' },
      { id: 'compliance-dpdpa', label: 'DPDPA Compliance', method: 'GET', path: nv('compliance/dpdpa'), description: 'India DPDPA compliance posture.' },
      { id: 'policies', label: 'Policy List', method: 'GET', path: nv('policies'), description: 'Active policy registry.' },
      { id: 'compliance-grpo', label: 'GRPO Stats', method: 'GET', path: nv('compliance/grpo'), description: 'GRPO training statistics.' },
    ]
  },
];

const HTTP_COLORS: Record<HttpMethod, string> = {
  GET: '#10b981', POST: '#3b82f6', PUT: '#f59e0b', PATCH: '#8b5cf6', DELETE: '#ef4444'
};

const ERROR_CODES: { code: number; name: string; meaning: string }[] = [
  { code: 200, name: 'OK', meaning: 'Request succeeded' },
  { code: 201, name: 'Created', meaning: 'Resource created successfully' },
  { code: 400, name: 'Bad Request', meaning: 'Invalid request body or missing required fields' },
  { code: 401, name: 'Unauthorized', meaning: 'Missing or invalid JWT token' },
  { code: 403, name: 'Forbidden', meaning: 'Insufficient RBAC permissions for this endpoint' },
  { code: 404, name: 'Not Found', meaning: 'Agent / resource not found in registry' },
  { code: 422, name: 'Unprocessable Entity', meaning: 'Schema validation failed' },
  { code: 429, name: 'Too Many Requests', meaning: 'Platform rate limit exceeded' },
  { code: 500, name: 'Internal Server Error', meaning: 'Agent invocation error or LLM provider failure' },
  { code: 502, name: 'Bad Gateway', meaning: 'Upstream LLM provider unreachable' },
  { code: 503, name: 'Service Unavailable', meaning: 'AgentZero fallback engaged; degraded mode' },
];

// ──────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ──────────────────────────────────────────────────────────────────────────────

export default function SDKTestingConsole() {
  useAuth(); // ensure auth context is available
  // Read JWT from localStorage — AuthContext only provides {user, login, logout}, not token directly
  const lsToken = getAuthToken() ?? '';

  const [activePlatform, setActivePlatform] = useState<PlatformDef>(PLATFORMS[0]);
  const [activeEndpoint, setActiveEndpoint] = useState<EndpointDef>(PLATFORMS[0].endpoints[0]);
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState(nv('health'));
  const [headers, setHeaders] = useState<Header[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
    { key: 'Authorization', value: lsToken ? `Bearer ${lsToken}` : '', enabled: !!lsToken },
  ]);
  const [bodyText, setBodyText] = useState('');
  const [queryParams, setQueryParams] = useState<Param[]>([{ key: '', value: '', enabled: true }]);
  const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'params' | 'docs'>('body');
  const [responseTab, setResponseTab] = useState<'body' | 'headers' | 'timing'>('body');
  const [response, setResponse] = useState<{ status: number; statusText: string; body: string; headers: Record<string, string>; duration: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [envVars, setEnvVars] = useState({ BASE_URL: '', AUTH_TOKEN: lsToken });
  const [showEnv, setShowEnv] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'catalog' | 'errorcodes'>('split');
  const abortRef = useRef<AbortController | null>(null);

  // Sync auth header if token changes in localStorage after mount
  useEffect(() => {
    const currentToken = getAuthToken() ?? '';
    if (currentToken) {
      setHeaders(h => h.map(hh => hh.key === 'Authorization' ? { ...hh, value: `Bearer ${currentToken}`, enabled: true } : hh));
      setEnvVars(ev => ({ ...ev, AUTH_TOKEN: currentToken }));
    }
  }, []);

  function selectEndpoint(ep: EndpointDef, plat: PlatformDef) {
    setActivePlatform(plat);
    setActiveEndpoint(ep);
    setMethod(ep.method);
    setUrl(ep.path);
    setBodyText(ep.sampleBody || '');
    if (ep.params) {
      setQueryParams([...ep.params.map(p => ({ ...p, enabled: true })), { key: '', value: '', enabled: true }]);
    } else {
      setQueryParams([{ key: '', value: '', enabled: true }]);
    }
    setResponse(null);
  }

  function buildFinalUrl() {
    let base = url;
    const active = queryParams.filter(p => p.enabled && p.key);
    if (active.length) {
      base += '?' + active.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
    }
    return base;
  }

  async function sendRequest() {
    setLoading(true);
    setResponse(null);
    abortRef.current = new AbortController();
    const t0 = performance.now();
    try {
      const finalUrl = buildFinalUrl();
      const reqHeaders: Record<string, string> = {};
      headers.filter(h => h.enabled && h.key).forEach(h => { reqHeaders[h.key] = h.value; });

      const opts: RequestInit = { method, headers: reqHeaders, signal: abortRef.current.signal };
      if (['POST', 'PUT', 'PATCH'].includes(method) && bodyText) opts.body = bodyText;

      const res = await fetch(finalUrl, opts);
      const duration = Math.round(performance.now() - t0);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { }

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });

      setResponse({ status: res.status, statusText: res.statusText, body: pretty, headers: resHeaders, duration });
      setHistory(h => [{ id: Date.now().toString(), ts: new Date().toISOString(), method, url: finalUrl, status: res.status, duration, platform: activePlatform.name }, ...h.slice(0, 49)]);
    } catch (e: any) {
      const duration = Math.round(performance.now() - t0);
      if (e.name !== 'AbortError') {
        setResponse({ status: 0, statusText: 'Network Error', body: e.message, headers: {}, duration });
      }
    }
    setLoading(false);
  }

  function statusColor(s: number) {
    if (s >= 200 && s < 300) return '#10b981';
    if (s >= 400 && s < 500) return '#f59e0b';
    if (s >= 500) return '#ef4444';
    return '#6b7280';
  }

  const sty = {
    page: { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'ui-monospace, monospace', display: 'flex', flexDirection: 'column' as const },
    topBar: { background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 },
    body: { display: 'flex', flex: 1, overflow: 'hidden', height: 'calc(100vh - 56px)' },
    sidebar: { width: 260, background: '#ffffff', borderRight: '1px solid #e2e8f0', overflowY: 'auto' as const, flexShrink: 0 },
    main: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
    urlBar: { background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' },
    requestArea: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
    responseArea: { borderTop: '1px solid #e2e8f0', height: '42%', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
    tab: (active: boolean) => ({ padding: '8px 16px', fontSize: 12, cursor: 'pointer', borderBottom: active ? '2px solid #C7B15B' : '2px solid transparent', color: active ? '#152448' : '#64748b', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid' as const, borderBottomColor: active ? '#C7B15B' : 'transparent' }),
    input: { background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6, color: '#0f172a', padding: '8px 12px', fontSize: 13, outline: 'none', width: '100%' },
    btn: (c: string) => ({ background: c, border: 'none', borderRadius: 6, color: '#fff', padding: '8px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }),
    methodBadge: (m: HttpMethod) => ({ background: HTTP_COLORS[m] + '33', color: HTTP_COLORS[m], border: `1px solid ${HTTP_COLORS[m]}`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }),
    statusBadge: (s: number) => ({ background: statusColor(s) + '22', color: statusColor(s), border: `1px solid ${statusColor(s)}`, borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 700 }),
  };

  return (
    <div style={sty.page}>
      {/* TOP BAR */}
      <div style={sty.topBar}>
        <span style={{ color: '#f59e0b', fontWeight: 800, fontSize: 16 }}>⚡ Jurexio Enterprise Platform SDK Testing Console</span>
        <span style={{ color: '#6b7280', fontSize: 12, flex: 1 }}>Postman-Style API Explorer · 5 platform groups · mounted gateway paths</span>
        {['split', 'catalog', 'errorcodes'].map(v => (
          <button key={v} onClick={() => setViewMode(v as any)} style={{ ...sty.btn(viewMode === v ? '#374151' : '#1f2937'), fontSize: 11 }}>
            {v === 'split' ? '⬛ Request/Response' : v === 'catalog' ? '📋 API Catalog' : '🚦 Error Codes'}
          </button>
        ))}
        <button onClick={() => setShowEnv(!showEnv)} style={{ ...sty.btn('#1f2937'), fontSize: 11 }}>🌐 Env Vars</button>
      </div>

      {/* Partner smoke matrix + path banner */}
      <div style={{ padding: '8px 20px 0' }}>
        <PartnerSmokePanel />
      </div>
      <div style={{ background: '#fef3c7', borderBottom: '1px solid #f59e0b', padding: '8px 20px', fontSize: 12, color: '#92400e' }}>
        Partner orchestration and AG-UI traces: use{' '}
        <a href="/sdk-hub?tab=client" style={{ color: '#b45309', fontWeight: 700, textDecoration: 'underline' }}>
          SDK Hub › Client Playground
        </a>{' '}
        for live partner paths. Some endpoints here require SDK key or console JWT — 401/404 means wrong auth tier, not a missing backend.
      </div>

      {/* ENV VARS OVERLAY */}
      {showEnv && (
        <div style={{ background: '#1a2235', borderBottom: '1px solid #374151', padding: '12px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#f59e0b' }}>Environment:</span>
          <input style={{ ...sty.input, width: 320 }} placeholder="Base URL override" value={envVars.BASE_URL} onInput={(e: any) => setEnvVars(ev => ({ ...ev, BASE_URL: e.target.value }))} />
          <input style={{ ...sty.input, width: 400 }} placeholder="Auth Token" value={envVars.AUTH_TOKEN} onInput={(e: any) => setEnvVars(ev => ({ ...ev, AUTH_TOKEN: e.target.value }))} />
          <button onClick={() => setHeaders(h => h.map(hh => hh.key === 'Authorization' ? { ...hh, value: `Bearer ${envVars.AUTH_TOKEN}` } : hh))} style={sty.btn('#f59e0b')}>Apply Token</button>
        </div>
      )}

      {/* ERROR CODES VIEW */}
      {viewMode === 'errorcodes' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <h2 style={{ color: '#f59e0b', margin: '0 0 20px' }}>HTTP Error Code Reference</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1f2937' }}>
                {['Code', 'Name', 'Meaning'].map(c => <th key={c} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, color: '#9ca3af', borderBottom: '1px solid #374151' }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {ERROR_CODES.map(ec => (
                <tr key={ec.code} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '10px 16px' }}><span style={sty.statusBadge(ec.code)}>{ec.code}</span></td>
                  <td style={{ padding: '10px 16px', color: '#e2e8f0', fontWeight: 600 }}>{ec.name}</td>
                  <td style={{ padding: '10px 16px', color: '#9ca3af', fontSize: 13 }}>{ec.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* API CATALOG VIEW */}
      {viewMode === 'catalog' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <h2 style={{ color: '#f59e0b', margin: '0 0 20px' }}>Full API Catalog</h2>
          {PLATFORMS.map(plat => (
            <div key={plat.id} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>{plat.icon}</span>
                <span style={{ color: plat.color, fontWeight: 700, fontSize: 15 }}>{plat.name}</span>
                <span style={{ color: '#6b7280', fontSize: 12 }}>({plat.endpoints.length} endpoints)</span>
              </div>
              <div style={{ paddingLeft: 16, borderLeft: `2px solid ${plat.color}33` }}>
                {plat.endpoints.map(ep => (
                  <div key={ep.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid #1f2937', cursor: 'pointer' }}
                    onClick={() => { selectEndpoint(ep, plat); setViewMode('split'); }}>
                    <span style={sty.methodBadge(ep.method)}>{ep.method}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{ep.label}</span>
                      <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 8 }}>{ep.path}</span>
                      <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2 }}>{ep.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MAIN SPLIT VIEW */}
      {viewMode === 'split' && (
        <div style={sty.body}>
          {/* SIDEBAR */}
          <div style={sty.sidebar}>
            {/* History */}
            {history.length > 0 && (
              <div style={{ padding: '8px 0', borderBottom: '1px solid #374151' }}>
                <div style={{ padding: '6px 12px', fontSize: 10, color: '#6b7280', fontWeight: 700, letterSpacing: 1 }}>HISTORY</div>
                {history.slice(0, 8).map(h => (
                  <div key={h.id} style={{ padding: '6px 12px', cursor: 'pointer', borderBottom: '1px solid #1f2937', display: 'flex', gap: 6, alignItems: 'center' }}
                    onClick={() => { setMethod(h.method); setUrl(h.url); setResponse(null); }}>
                    <span style={sty.methodBadge(h.method)}>{h.method.slice(0, 3)}</span>
                    <span style={{ color: '#9ca3af', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{h.url}</span>
                    <span style={{ color: statusColor(h.status), fontSize: 10 }}>{h.status}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Platforms */}
            {PLATFORMS.map(plat => (
              <div key={plat.id}>
                <div style={{ padding: '8px 12px', fontSize: 10, color: plat.color, fontWeight: 700, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6, background: activePlatform.id === plat.id ? '#1f2937' : 'transparent', cursor: 'pointer' }}
                  onClick={() => setActivePlatform(plat)}>
                  {plat.icon} {plat.name}
                </div>
                {activePlatform.id === plat.id && plat.endpoints.map(ep => (
                  <div key={ep.id} onClick={() => selectEndpoint(ep, plat)}
                    style={{ padding: '7px 12px 7px 24px', cursor: 'pointer', display: 'flex', gap: 7, alignItems: 'center', background: activeEndpoint.id === ep.id ? '#1e293b' : 'transparent', borderLeft: activeEndpoint.id === ep.id ? `2px solid ${plat.color}` : '2px solid transparent' }}>
                    <span style={sty.methodBadge(ep.method)}>{ep.method.slice(0, 3)}</span>
                    <span style={{ fontSize: 12, color: activeEndpoint.id === ep.id ? '#e2e8f0' : '#9ca3af' }}>{ep.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* MAIN */}
          <div style={sty.main}>
            {/* URL BAR */}
            <div style={sty.urlBar}>
              <select value={method} onChange={(e: any) => setMethod(e.target.value)} style={{ background: HTTP_COLORS[method] + '33', border: `1px solid ${HTTP_COLORS[method]}`, color: HTTP_COLORS[method], borderRadius: 6, padding: '8px 10px', fontWeight: 700, fontSize: 13 }}>
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input style={{ ...sty.input, flex: 1 }} value={url} onInput={(e: any) => setUrl(e.target.value)} placeholder={nv('...')} />
              <button onClick={sendRequest} disabled={loading} style={{ ...sty.btn('#f59e0b'), minWidth: 90, opacity: loading ? 0.7 : 1 }}>
                {loading ? '⏳ Sending...' : '▶ Send'}
              </button>
              {loading && <button onClick={() => abortRef.current?.abort()} style={sty.btn('#ef4444')}>✕</button>}
            </div>

            {/* REQUEST TABS */}
            <div style={{ background: '#111827', borderBottom: '1px solid #374151', display: 'flex' }}>
              {(['body', 'headers', 'params', 'docs'] as const).map(t => (
                <button key={t} onClick={() => setActiveTab(t)} style={sty.tab(activeTab === t)}>
                  {t === 'body' ? 'Body' : t === 'headers' ? `Headers (${headers.filter(h => h.enabled && h.key).length})` : t === 'params' ? `Query (${queryParams.filter(p => p.enabled && p.key).length})` : '📖 Docs'}
                </button>
              ))}
            </div>

            {/* REQUEST CONTENT */}
            <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#0f172a' }}>
              {activeTab === 'body' && (
                <textarea style={{ ...sty.input, width: '100%', height: '100%', resize: 'none', fontSize: 12, lineHeight: 1.6 }}
                  value={bodyText} onInput={(e: any) => setBodyText(e.target.value)}
                  placeholder={method === 'GET' ? 'GET requests have no body' : '{\n  "key": "value"\n}'} />
              )}
              {activeTab === 'headers' && (
                <div>
                  {headers.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={h.enabled} onChange={() => setHeaders(hs => hs.map((hh, ii) => ii === i ? { ...hh, enabled: !hh.enabled } : hh))} />
                      <input style={{ ...sty.input, flex: 1 }} value={h.key} placeholder="Header" onInput={(e: any) => setHeaders(hs => hs.map((hh, ii) => ii === i ? { ...hh, key: e.target.value } : hh))} />
                      <input style={{ ...sty.input, flex: 2 }} value={h.value} placeholder="Value" onInput={(e: any) => setHeaders(hs => hs.map((hh, ii) => ii === i ? { ...hh, value: e.target.value } : hh))} />
                      <button onClick={() => setHeaders(hs => hs.filter((_, ii) => ii !== i))} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
                    </div>
                  ))}
                  <button onClick={() => setHeaders(h => [...h, { key: '', value: '', enabled: true }])} style={{ ...sty.btn('#1f2937'), fontSize: 11 }}>+ Add Header</button>
                </div>
              )}
              {activeTab === 'params' && (
                <div>
                  {queryParams.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={p.enabled} onChange={() => setQueryParams(ps => ps.map((pp, ii) => ii === i ? { ...pp, enabled: !pp.enabled } : pp))} />
                      <input style={{ ...sty.input, flex: 1 }} value={p.key} placeholder="Key" onInput={(e: any) => { setQueryParams(ps => ps.map((pp, ii) => ii === i ? { ...pp, key: e.target.value } : pp)); }} />
                      <input style={{ ...sty.input, flex: 2 }} value={p.value} placeholder="Value" onInput={(e: any) => setQueryParams(ps => ps.map((pp, ii) => ii === i ? { ...pp, value: e.target.value } : pp))} />
                      <button onClick={() => setQueryParams(ps => ps.filter((_, ii) => ii !== i))} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
                    </div>
                  ))}
                  <button onClick={() => setQueryParams(p => [...p, { key: '', value: '', enabled: true }])} style={{ ...sty.btn('#1f2937'), fontSize: 11 }}>+ Add Param</button>
                </div>
              )}
              {activeTab === 'docs' && (
                <div style={{ maxWidth: 700 }}>
                  <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{activeEndpoint.label}</div>
                  <div style={{ color: '#9ca3af', marginBottom: 12, fontSize: 13 }}>{activeEndpoint.description}</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <span style={sty.methodBadge(activeEndpoint.method)}>{activeEndpoint.method}</span>
                    <code style={{ color: '#e2e8f0', fontSize: 12 }}>{activeEndpoint.path}</code>
                  </div>
                  {activeEndpoint.sampleBody && (
                    <>
                      <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 4 }}>SAMPLE REQUEST BODY</div>
                      <pre style={{ background: '#0f172a', border: '1px solid #374151', borderRadius: 6, padding: 12, fontSize: 12, color: '#10b981', overflowX: 'auto' }}>{activeEndpoint.sampleBody}</pre>
                    </>
                  )}
                  {activeEndpoint.sampleResponse && (
                    <>
                      <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 4, marginTop: 12 }}>SAMPLE RESPONSE</div>
                      <pre style={{ background: '#0f172a', border: '1px solid #374151', borderRadius: 6, padding: 12, fontSize: 12, color: '#3b82f6', overflowX: 'auto' }}>{activeEndpoint.sampleResponse}</pre>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* RESPONSE AREA */}
            <div style={sty.responseArea}>
              <div style={{ background: '#111827', borderTop: '1px solid #374151', borderBottom: '1px solid #374151', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 700 }}>RESPONSE</span>
                {response && (
                  <>
                    <span style={sty.statusBadge(response.status)}>{response.status} {response.statusText}</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{response.duration}ms</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{new Blob([response.body]).size} bytes</span>
                  </>
                )}
                <div style={{ flex: 1 }} />
                {(['body', 'headers', 'timing'] as const).map(t => (
                  <button key={t} onClick={() => setResponseTab(t)} style={sty.tab(responseTab === t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#0a0f1a' }}>
                {!response && !loading && <div style={{ color: '#374151', textAlign: 'center', paddingTop: 32, fontSize: 13 }}>Press ▶ Send to execute the request</div>}
                {loading && <div style={{ color: '#f59e0b', textAlign: 'center', paddingTop: 32 }}>⏳ Waiting for response...</div>}
                {response && responseTab === 'body' && (
                  <pre style={{ fontSize: 12, color: response.status >= 200 && response.status < 300 ? '#86efac' : '#fca5a5', lineHeight: 1.6, overflowX: 'auto' }}>{response.body}</pre>
                )}
                {response && responseTab === 'headers' && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    {Object.entries(response.headers).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ padding: '4px 8px', color: '#f59e0b', whiteSpace: 'nowrap', width: '30%' }}>{k}</td>
                        <td style={{ padding: '4px 8px', color: '#9ca3af' }}>{v}</td>
                      </tr>
                    ))}
                  </table>
                )}
                {response && responseTab === 'timing' && (
                  <div style={{ padding: 12 }}>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 4 }}>TOTAL DURATION</div>
                      <div style={{ fontSize: 32, color: '#f59e0b', fontWeight: 700 }}>{response.duration}ms</div>
                    </div>
                    <div style={{ background: '#1f2937', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: response.status < 400 ? '#10b981' : '#ef4444', width: `${Math.min(100, response.duration / 50)}%` }} />
                    </div>
                    <div style={{ color: '#6b7280', fontSize: 11, marginTop: 8 }}>
                      {response.duration < 200 ? '🟢 Excellent' : response.duration < 500 ? '🟡 Good' : '🔴 Slow'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
