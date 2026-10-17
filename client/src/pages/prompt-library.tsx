import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { BookMarked, Search, Copy, MessageSquare } from 'lucide-react';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';

type Prompt = {
  id: string;
  slug: string;
  name: string;
  category: string;
  jurisdiction: string;
  language: string;
  version: string;
  is_public: boolean;
  usage_count: number;
  template_body: string;
  tags: string[];
  agents?: string[];
  source?: 'seed' | 'db';
};

const CATEGORIES = ['All', 'Litigation', 'Contract Review', 'Compliance', 'Research', 'Citizen-Facing'] as const;
const JURISDICTIONS = ['All', 'IN', 'US', 'UK', 'EU', 'GC', 'SG'] as const;
const AGENTS = ['All', 'litigation', 'contracts', 'compliance', 'research', 'citizen', 'criminal'] as const;

export const PROMPT_PREFILL_KEY = 'nv_universal_chat_prefill';

export default function PromptLibrary() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [data, setData] = useState<Prompt[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [jurisdiction, setJurisdiction] = useState<string>('All');
  const [agent, setAgent] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = getAuthToken();
    fetch(nv('prompts?limit=2000'), { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(r => r.ok ? r.json() : { prompts: [] })
      .then(j => setData(((j.prompts ?? j.data ?? j.items ?? []) as any[]).map(r => ({
        ...r,
        template_body: r.template_body ?? r.preview ?? '',
        tags: Array.isArray(r.tags) ? r.tags : (typeof r.tags === 'string' ? safeJson(r.tags) : []),
        agents: Array.isArray(r.agents) ? r.agents : [],
      } as Prompt))))
      .catch(e => setError(e?.message ?? 'failed'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => data.filter(p => {
    if (category !== 'All' && p.category !== category) return false;
    if (jurisdiction !== 'All' && p.jurisdiction !== jurisdiction) return false;
    if (agent !== 'All' && !(p.agents ?? []).includes(agent)) return false;
    if (q) {
      const ql = q.toLowerCase();
      if (!(p.name.toLowerCase().includes(ql) || p.template_body.toLowerCase().includes(ql) || (p.tags ?? []).some(t => t.toLowerCase().includes(ql)))) return false;
    }
    return true;
  }), [data, category, jurisdiction, agent, q]);

  const counts = useMemo(() => ({
    total: data.length,
    byCategory: data.reduce<Record<string, number>>((m, p) => { m[p.category] = (m[p.category] ?? 0) + 1; return m; }, {}),
  }), [data]);

  function copyPrompt(p: Prompt) {
    navigator.clipboard.writeText(p.template_body).then(
      () => toast({ title: 'Copied to clipboard', description: p.name }),
      () => toast({ title: 'Copy failed', variant: 'destructive' }),
    );
  }

  function tryInChat(p: Prompt) {
    try { sessionStorage.setItem(PROMPT_PREFILL_KEY, p.template_body); } catch {}
    setLocation('/chat?tab=universal');
  }

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-prompt-library">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <BookMarked className="w-6 h-6" /> Prompt Library
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          {counts.total} canonical legal prompts across 5 categories × 6 jurisdictions —
          versioned, agent-tagged, ready for one-click use in Universal Chat.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              Templates — {filtered.length} of {counts.total}
            </CardTitle>
            <div className="relative w-72">
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-slate-600" />
              <Input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search by name, body, or tag…"
                className="pl-8"
                data-testid="input-prompt-search"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterSelect label="Category" value={category} onChange={setCategory} options={[...CATEGORIES]} testId="filter-category" />
            <FilterSelect label="Jurisdiction" value={jurisdiction} onChange={setJurisdiction} options={[...JURISDICTIONS]} testId="filter-jurisdiction" />
            <FilterSelect label="Agent" value={agent} onChange={setAgent} options={[...AGENTS]} testId="filter-agent" />
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-slate-700">Loading prompt library…</p>}
          {error && <p className="text-sm text-red-600">Failed to load: {error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="text-sm text-slate-700" data-testid="empty-prompts">No prompts match the current filters.</p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map(p => (
              <div
                key={p.id}
                className="border border-slate-200 rounded-lg p-4 bg-white flex flex-col"
                data-testid={`tpl-${p.slug}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate" title={p.name}>{p.name}</p>
                    <p className="text-xs text-slate-700 mt-0.5">
                      {p.category} · {p.jurisdiction} · v{p.version} · {(p.language ?? 'en').toUpperCase()}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase shrink-0">{p.jurisdiction}</Badge>
                </div>
                <pre className="mt-2 text-xs text-slate-700 whitespace-pre-wrap font-mono bg-slate-50 p-2 rounded max-h-32 overflow-hidden">
                  {p.template_body}
                </pre>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(p.agents ?? []).slice(0, 4).map(a => (
                    <Badge key={a} variant="secondary" className="text-[10px]">agent: {a}</Badge>
                  ))}
                  {(p.tags ?? []).slice(0, 4).map(t => (
                    <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 mt-3">
                  <p className="text-xs text-slate-600">{p.usage_count} runs</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyPrompt(p)}
                      data-testid={`copy-${p.slug}`}
                    >
                      <Copy className="w-3 h-3 mr-1" /> Copy
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => tryInChat(p)}
                      data-testid={`try-chat-${p.slug}`}
                    >
                      <MessageSquare className="w-3 h-3 mr-1" /> Try in Universal Chat
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; testId: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-700">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-40" data-testid={testId}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );
}

function safeJson(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
