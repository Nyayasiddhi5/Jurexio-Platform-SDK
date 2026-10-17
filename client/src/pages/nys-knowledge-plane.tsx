/**
 * NYS Knowledge Plane hub — Console launchpad + live probes.
 * Full manage/browse UI remains at nyayasearch.jurexio.example (NYS SPA).
 * This page: federation status, SSO deep-links to every NYS dashboard page,
 * embedding SLOs, and operator probes via NYV /api/jrx/knowledge/* proxies.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  BookOpen,
  ExternalLink,
  Search,
  Scale,
  FileText,
  Gavel,
  Library,
  MessageSquare,
  Archive,
  Quote,
  FileCode2,
  Activity,
} from 'lucide-react';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';

const NYS_UI = 'https://nyayasearch.jurexio.example';

const NYS_PAGES: { path: string; label: string; desc: string; icon: typeof BookOpen }[] = [
  { path: '/', label: 'Dashboard', desc: 'Summary, usage, embed progress', icon: Activity },
  { path: '/chat', label: 'Legal Chat', desc: 'Conversations + document upload', icon: MessageSquare },
  { path: '/library', label: 'Task Library', desc: '240 legal-work benchmark tasks', icon: Library },
  { path: '/runs', label: 'Run History', desc: 'Agent runs + evaluate', icon: FileText },
  { path: '/caselaw', label: 'Caselaw Search', desc: 'SC + HC FTS/hybrid · 1950–2026', icon: Gavel },
  { path: '/archive', label: 'Archive (Athena)', desc: 'SC/HC PDF metadata search', icon: Archive },
  { path: '/citations', label: 'Citation Check', desc: 'Verify case citations', icon: Quote },
  { path: '/statutes', label: 'Statutes', desc: 'Hybrid FTS + vector search', icon: Scale },
  { path: '/statutes/compare', label: 'Old → New Codes', desc: 'IPC/BNS, CrPC/BNSS, IEA/BSA', icon: FileCode2 },
  { path: '/templates', label: 'Templates', desc: 'Seeded + custom template CRUD', icon: FileText },
  { path: '/api-tester', label: 'API Tester', desc: 'Live OpenAPI playground', icon: Search },
];

const LEGAL_FEED_CONSOLE = '/legal-intelligence-feed';

type PlaneHealth = {
  flag?: boolean;
  client?: { configured?: boolean; circuit?: string; baseUrl?: string | null };
  upstream?: { ok?: boolean; latencyMs?: number; error?: string };
};

type EmbedSlo = {
  coveragePct?: number;
  slo?: { overallStatus?: string; reasons?: string[]; targetCoveragePct?: number };
  total?: number;
  embedded?: number;
};

type ProbeKind = 'autorag' | 'caselaw' | 'statutes' | 'retrieve' | 'athena' | 'tasks' | 'compare' | 'stats';

export default function NysKnowledgePlaneHub() {
  const [health, setHealth] = useState<PlaneHealth | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [caselawSlo, setCaselawSlo] = useState<EmbedSlo | null>(null);
  const [statuteSlo, setStatuteSlo] = useState<EmbedSlo | null>(null);
  const [athenaStatus, setAthenaStatus] = useState<any>(null);
  const [query, setQuery] = useState('BNS Section 103');
  const [probe, setProbe] = useState<ProbeKind>('autorag');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssoBusy, setSsoBusy] = useState<string | null>(null);

  const authHeaders = useCallback((): HeadersInit => {
    const t = getAuthToken();
    return t
      ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }, []);

  useEffect(() => {
    const h = authHeaders();
    fetch(nv('knowledge/plane/health'), { headers: h })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => setHealth(j))
      .catch(() => setHealth(null));
    fetch(nv('knowledge/caselaw/embedding/coverage'), { headers: h })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => setCaselawSlo(j?.data ?? j))
      .catch(() => setCaselawSlo(null));
    fetch(nv('knowledge/statutes/embedding/coverage'), { headers: h })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => setStatuteSlo(j?.data ?? j))
      .catch(() => setStatuteSlo(null));
    fetch(nv('knowledge/caselaw/stats'), { headers: h })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => setStats(j?.data ?? j))
      .catch(() => setStats(null));
    fetch(nv('knowledge/documents/status'), { headers: h })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => setAthenaStatus(j?.data ?? j))
      .catch(() => setAthenaStatus(null));
  }, [authHeaders]);

  /** Prefer SSO handoff; fall back to bare URL if SSO not configured. */
  const openNys = async (path: string) => {
    setSsoBusy(path);
    setError(null);
    try {
      const r = await fetch(nv('knowledge/sso/launch'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.url) {
        window.open(j.url, '_blank', 'noopener,noreferrer');
        return;
      }
      const bare = `${NYS_UI}${path === '/' ? '' : path}`;
      window.open(bare, '_blank', 'noopener,noreferrer');
      if (j?.error?.code === 'QUEUE_UNAVAILABLE' || j?.details?.code === 'SSO_NOT_CONFIGURED') {
        setError('SSO secret not set on gateway — opened nyayasearch without session handoff');
      }
    } catch {
      window.open(`${NYS_UI}${path === '/' ? '' : path}`, '_blank', 'noopener,noreferrer');
    } finally {
      setSsoBusy(null);
    }
  };

  const runProbe = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const h = authHeaders();
      let r: Response;
      switch (probe) {
        case 'autorag':
          r = await fetch(nv('knowledge/search'), {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ query, jurisdiction: 'IN', limit: 8, taskType: 'research' }),
          });
          break;
        case 'caselaw':
          r = await fetch(
            `${nv('knowledge/caselaw/search')}?q=${encodeURIComponent(query)}&jurisdiction=IN&limit=5&mode=fts&courtType=hc&yearFrom=2023&yearTo=2026`,
            { headers: h },
          );
          break;
        case 'statutes':
          r = await fetch(
            `${nv('knowledge/statutes/search')}?q=${encodeURIComponent(query)}&jurisdiction=IN&limit=5`,
            { headers: h },
          );
          break;
        case 'retrieve':
          r = await fetch(nv('knowledge/retrieve'), {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ query, jurisdiction: 'IN' }),
          });
          break;
        case 'athena':
          r = await fetch(nv('knowledge/documents/search'), {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ q: query, limit: 5 }),
          });
          break;
        case 'tasks':
          r = await fetch(nv('legal-work/tasks'), { headers: h });
          break;
        case 'compare':
          r = await fetch(`${nv('knowledge/statutes/compare/ipc-bns')}?section=302`, { headers: h });
          break;
        case 'stats':
          r = await fetch(nv('knowledge/caselaw/stats'), { headers: h });
          break;
        default:
          throw new Error('Unknown probe');
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message || j?.error || `HTTP ${r.status}`);
      setResult(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const flagOn = Boolean(health?.flag);
  const configured = Boolean(health?.client?.configured);
  const circuit = health?.client?.circuit ?? 'unknown';
  const embedProg = stats?.embedding || stats?.embedProgress || stats?.data?.embedding;
  const sloBadge = (status?: string) => {
    if (status === 'ok') return 'default' as const;
    if (status === 'degraded') return 'secondary' as const;
    if (status === 'critical') return 'destructive' as const;
    return 'outline' as const;
  };

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-nys-knowledge-plane">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#152448] flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-[#C7B15B]" /> NYS Knowledge Plane
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Federated legal knowledge for Jurexio agents (Indian corpus 1950–2026). Grounding order:
            NYS caselaw/statutes → tenant RAG →{' '}
            <a href={LEGAL_FEED_CONSOLE} className="underline text-[#152448]">legal feed</a> / live web search → memory.
            Prefer <strong>SSO launch</strong> into Nyaya Search. Probes default to <strong>IN</strong>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={ssoBusy === '/'}
            onClick={() => openNys('/')}
            className="inline-flex items-center gap-2 bg-[#152448] hover:bg-[#2B384C] text-white"
          >
            SSO → Knowledge dashboard <ExternalLink className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={ssoBusy === '/statutes'}
            onClick={() => openNys('/statutes')}
            className="inline-flex items-center gap-2 border-[#152448]/30"
          >
            Statutes (IN) <ExternalLink className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Flag</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={flagOn ? 'default' : 'secondary'}>
              {flagOn ? 'PLANE ON' : 'OFF'}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Configured</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={configured ? 'default' : 'secondary'}>
              {configured ? 'BASE_URL set' : 'missing URL'}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Circuit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{circuit}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Upstream</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {health?.upstream?.ok
                ? `OK (${health.upstream.latencyMs}ms)`
                : health?.upstream?.error || 'n/a'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Athena</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm truncate">
              {athenaStatus?.configured === false
                ? 'not configured'
                : athenaStatus
                  ? 'status OK'
                  : 'n/a'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Caselaw embedding SLO (backfill progress)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Badge variant={sloBadge(caselawSlo?.slo?.overallStatus)}>
              {(caselawSlo?.slo?.overallStatus || 'unknown').toUpperCase()}
            </Badge>
            <p>
              Vector coverage (backfill SLO):{' '}
              {typeof caselawSlo?.coveragePct === 'number'
                ? `${caselawSlo.coveragePct}%`
                : 'n/a'}
              {typeof caselawSlo?.slo?.targetCoveragePct === 'number'
                ? ` (ops band target ${caselawSlo.slo.targetCoveragePct}%)`
                : ''}
            </p>
            <p className="text-xs text-slate-600">
              This percentage is a <strong>multi-week Bedrock/RDS backfill</strong>, not a GA gate and not “corpus broken”.
              India product-ready search uses <strong>SC + HC FTS + hybrid + Athena + legal feed / web search</strong> today. Statutes (acts) have a separate 100% embed SLO.
              Probes default to jurisdiction <strong>IN</strong>.
            </p>
            {caselawSlo?.slo?.reasons?.length ? (
              <p className="text-xs text-slate-500">{caselawSlo.slo.reasons.join('; ')}</p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statute embedding SLO</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Badge variant={sloBadge(statuteSlo?.slo?.overallStatus)}>
              {(statuteSlo?.slo?.overallStatus || 'unknown').toUpperCase()}
            </Badge>
            <p>
              Coverage:{' '}
              {typeof statuteSlo?.coveragePct === 'number'
                ? `${statuteSlo.coveragePct}%`
                : 'n/a'}
              {typeof statuteSlo?.embedded === 'number' && typeof statuteSlo?.total === 'number'
                ? ` · ${statuteSlo.embedded}/${statuteSlo.total}`
                : ''}
            </p>
            {statuteSlo?.slo?.reasons?.length ? (
              <p className="text-xs text-slate-500">{statuteSlo.slo.reasons.join('; ')}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {(stats || embedProg) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Corpus / embedding monitor</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-1">
            <p>
              Caselaw stats from <code>/api/jrx/knowledge/caselaw/stats</code>
              {typeof stats?.totalDocuments === 'number' ? ` · total=${stats.totalDocuments}` : ''}
              {typeof stats?.total === 'number' ? ` · total=${stats.total}` : ''}
            </p>
            {embedProg && (
              <p className="text-slate-600">
                Embedding progress:{' '}
                {typeof embedProg === 'object' ? JSON.stringify(embedProg).slice(0, 180) : String(embedProg)}
              </p>
            )}
            <p className="text-xs text-slate-500">
              Ingest / embed jobs remain CLI/SSM on the NYS worker (no HTTP admin). Use dual-ops runbook.
            </p>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">NYS dashboard launchpad (SSO)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {NYS_PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.path}
                type="button"
                disabled={ssoBusy === p.path}
                onClick={() => openNys(p.path)}
                className="block text-left w-full"
              >
                <Card className="h-full hover:border-slate-400 transition-colors">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Icon className="w-4 h-4" /> {p.label}
                      <ExternalLink className="w-3 h-3 ml-auto text-slate-400" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-slate-600">{p.desc}</CardContent>
                </Card>
              </button>
            );
          })}
          <a href={LEGAL_FEED_CONSOLE} className="block text-left w-full">
            <Card className="h-full hover:border-slate-400 transition-colors border-[#C7B15B]/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Live Legal Feed
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-slate-600">
                RSS digest · Auto-RAG fusion · regulatory feed (Console)
              </CardContent>
            </Card>
          </a>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4" /> Live federation probes (via NYV)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['autorag', 'Auto-RAG'],
                ['caselaw', 'HC FTS'],
                ['statutes', 'Statutes'],
                ['retrieve', 'Retrieve'],
                ['athena', 'Athena'],
                ['tasks', 'Legal tasks'],
                ['compare', 'IPC→BNS'],
                ['stats', 'Caselaw stats'],
              ] as [ProbeKind, string][]
            ).map(([k, label]) => (
              <Button
                key={k}
                size="sm"
                variant={probe === k ? 'default' : 'outline'}
                onClick={() => setProbe(k)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Legal query"
              disabled={probe === 'tasks' || probe === 'stats' || probe === 'compare'}
            />
            <Button onClick={runProbe} disabled={loading}>
              {loading ? 'Running…' : 'Probe'}
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && (
            <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded overflow-auto max-h-80">
              {JSON.stringify(result, null, 2).slice(0, 8000)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
