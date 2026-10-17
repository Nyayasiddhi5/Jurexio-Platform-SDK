/**
 * Matter Vault — Harvey-style vault-scale matter review (scaffolding).
 * Composes EDJ batch ingest, tenant RAG probes, and contract playbook runs.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Archive, FolderOpen, Upload, Play, Plus, RefreshCw, Scale, FileText, Search,
} from 'lucide-react';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';

type MatterVault = {
  vaultId: string;
  name: string;
  matterRef?: string;
  jurisdiction: string;
  status: string;
  documents: { docId: string; fileName: string; status: string; edjJobId?: string }[];
  playbookRuns: { runId: string; playbookId: string; status: string }[];
  ragSummary?: { chunkCount: number; confidence?: number };
};

const JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'SG', 'GC'];

export default function MatterVaultPage() {
  const [matters, setMatters] = useState<MatterVault[]>([]);
  const [selected, setSelected] = useState<MatterVault | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [matterRef, setMatterRef] = useState('');
  const [jurisdiction, setJurisdiction] = useState('IN');
  const [playbookId, setPlaybookId] = useState('');
  const [fileName, setFileName] = useState('contract.pdf');
  const [fileContent, setFileContent] = useState('');

  const authHeaders = useCallback((): HeadersInit => {
    const t = getAuthToken();
    return t
      ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }, []);

  const loadMatters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(nv('matter-vault/matters'), { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      const list = (j?.data?.matters ?? j?.matters ?? []) as MatterVault[];
      setMatters(list);
      if (selected) {
        const fresh = list.find((m) => m.vaultId === selected.vaultId);
        if (fresh) setSelected(fresh);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, selected]);

  useEffect(() => {
    void loadMatters();
  }, []);

  const createMatter = async () => {
    setError(null);
    try {
      const r = await fetch(nv('matter-vault/matters'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, matterRef, jurisdiction }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      setName('');
      setMatterRef('');
      await loadMatters();
      setSelected(j.data as MatterVault);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const uploadBatch = async () => {
    if (!selected) return;
    setError(null);
    const contentBase64 = fileContent.trim()
      ? btoa(unescape(encodeURIComponent(fileContent)))
      : btoa('Matter vault placeholder document body for EDJ ingest scaffolding.');
    try {
      const r = await fetch(nv(`matter-vault/matters/${selected.vaultId}/upload-batch`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          documents: [{ fileName, contentBase64, mimeType: 'text/plain', outputProfile: 'extraction' }],
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      setSelected(j.data as MatterVault);
      await loadMatters();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runPlaybook = async () => {
    if (!selected || !playbookId.trim()) return;
    setError(null);
    try {
      const r = await fetch(nv(`matter-vault/matters/${selected.vaultId}/run-playbook`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ playbookId, probeRag: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      setSelected(j.data as MatterVault);
      await loadMatters();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Archive className="w-7 h-7 text-indigo-700" />
            Matter Vault
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Vault-scale matter review — EDJ batch ingest, tenant RAG, contract playbooks.
            API: <code className="text-xs bg-slate-100 px-1 rounded">/api/jrx/matter-vault/*</code>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadMatters()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 text-sm text-red-800">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" /> New matter vault
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Matter name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Matter ref (optional)" value={matterRef} onChange={(e) => setMatterRef(e.target.value)} />
            <Select value={jurisdiction} onValueChange={setJurisdiction}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {JURISDICTIONS.map((j) => (
                  <SelectItem key={j} value={j}>{j}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={() => void createMatter()} disabled={name.trim().length < 2}>
              Create vault
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FolderOpen className="w-4 h-4" /> Matters ({matters.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto">
            {matters.length === 0 && (
              <p className="text-sm text-slate-500">No matter vaults yet — create one to start batch review.</p>
            )}
            {matters.map((m) => (
              <button
                key={m.vaultId}
                type="button"
                onClick={() => setSelected(m)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selected?.vaultId === m.vaultId ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{m.name}</span>
                  <Badge variant="outline">{m.status}</Badge>
                </div>
                <div className="text-xs text-slate-500 mt-1 flex gap-3">
                  <span>{m.jurisdiction}</span>
                  <span>{m.documents?.length ?? 0} docs</span>
                  {m.matterRef && <span>{m.matterRef}</span>}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="w-4 h-4" />
              {selected.name}
              <Badge className="ml-2">{selected.vaultId}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2"><Upload className="w-4 h-4" /> Batch upload (EDJ)</p>
                <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="fileName" />
                <Textarea
                  rows={3}
                  placeholder="Optional plain-text body (encoded for scaffolding ingest)"
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                />
                <Button variant="secondary" onClick={() => void uploadBatch()}>
                  Upload batch
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2"><Play className="w-4 h-4" /> Run playbook + RAG</p>
                <Input
                  value={playbookId}
                  onChange={(e) => setPlaybookId(e.target.value)}
                  placeholder="playbook UUID from /api/jrx/orchestration/playbooks"
                />
                <Button onClick={() => void runPlaybook()} disabled={!playbookId.trim()}>
                  Run playbook
                </Button>
                {selected.ragSummary && (
                  <p className="text-xs text-slate-600">
                    RAG: {selected.ragSummary.chunkCount} chunks
                    {selected.ragSummary.confidence != null && ` · confidence ${(selected.ragSummary.confidence * 100).toFixed(0)}%`}
                  </p>
                )}
              </div>
            </div>

            {(selected.documents?.length ?? 0) > 0 && (
              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-2"><FileText className="w-4 h-4" /> Documents</p>
                <ul className="text-sm space-y-1">
                  {selected.documents.map((d) => (
                    <li key={d.docId} className="flex gap-2 items-center">
                      <Badge variant="outline">{d.status}</Badge>
                      <span>{d.fileName}</span>
                      {d.edjJobId && <span className="text-xs text-slate-400">EDJ {d.edjJobId}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-slate-50">
        <CardContent className="pt-4 text-xs text-slate-600 flex items-start gap-2">
          <Search className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Probe: <code>GET /api/jrx/matter-vault/health</code> ·{' '}
            <code>POST /api/jrx/matter-vault/matters</code> ·{' '}
            SDK: <code>nyv.matterVault.listMatters()</code> (client-sdk 5.0.0)
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
