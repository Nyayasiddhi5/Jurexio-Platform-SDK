import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { legalChatApi } from '@/services/legal-chat-api';
import { Trash2 } from 'lucide-react';

const JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'SG', 'GC'];

interface SmeAllocation {
  id: number;
  sme_user_id: number;
  sme_email?: string;
  sme_name?: string;
  scope: {
    jurisdictions?: string[];
    tiers?: string[];
    notes?: string;
  } & Record<string, unknown>;
  active: boolean;
  created_at?: string;
  revoked_at?: string | null;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return JSON.stringify(e);
}

export function SmeAllocations() {
  const [allocations, setAllocations] = useState<SmeAllocation[]>([]);
  const [email, setEmail] = useState('');
  const [scopeJurisdictions, setScopeJurisdictions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ email: string; setupUrl: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    legalChatApi
      .listAllocations()
      .then((r) =>
        setAllocations((r as { allocations?: SmeAllocation[] } | null)?.allocations ?? []),
      )
      .catch((e: unknown) => setError(errorMessage(e)));
  };
  useEffect(refresh, []);

  const grant = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await legalChatApi.createAllocation({
        smeEmail: email.trim(),
        scope: { jurisdictions: scopeJurisdictions, notes: notes || undefined },
      });
      setEmail(''); setNotes(''); setScopeJurisdictions([]);
      refresh();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  const issueCreds = async () => {
    if (!email.trim()) return;
    setIssuing(true);
    setError(null);
    setIssued(null);
    try {
      const r = (await legalChatApi.issueSmeCredentials({
        email: email.trim(),
        scope: { jurisdictions: scopeJurisdictions, notes: notes || undefined },
      })) as { email: string; setupUrl: string; expiresAt: string };
      setIssued({ email: r.email, setupUrl: r.setupUrl, expiresAt: r.expiresAt });
      refresh();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally { setIssuing(false); }
  };

  const revoke = async (id: number) => {
    await legalChatApi.revokeAllocation(id);
    refresh();
  };

  return (
    <Card className="p-4 bg-white border-slate-200 text-slate-800 space-y-4">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#152448' }}>Grant SME Legal Chat access</h3>
        <p className="text-xs text-slate-500">Superadmin-only. SMEs can run prompts + provide GRPO feedback in their granted scope.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs text-slate-700">SME email</Label>
          <Input
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="sme@firm.com"
            className="bg-white border-slate-200 text-slate-800 text-sm focus-visible:ring-[#C7B15B]/40"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-700">Scope: jurisdictions</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {JURISDICTIONS.map((j) => {
              const active = scopeJurisdictions.includes(j);
              return (
                <button
                  key={j}
                  onClick={() => setScopeJurisdictions(active
                    ? scopeJurisdictions.filter(x => x !== j)
                    : [...scopeJurisdictions, j])}
                  className={`px-2 py-1 rounded-md text-xs border ${
                    active ? 'border-transparent text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-[#C7B15B]'
                  }`}
                  style={active ? { background: '#152448' } : undefined}
                >{j}</button>
              );
            })}
          </div>
        </div>
        <div>
          <Label className="text-xs text-slate-700">Notes</Label>
          <Input
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="optional"
            className="bg-white border-slate-200 text-slate-800 text-sm focus-visible:ring-[#C7B15B]/40"
          />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={grant} disabled={busy || !email.trim()} className="text-white" style={{ background: '#152448' }}>
          {busy ? 'Granting…' : 'Grant access'}
        </Button>
        <Button onClick={issueCreds} disabled={issuing || !email.trim()} className="bg-emerald-600 text-white hover:bg-emerald-700">
          {issuing ? 'Issuing…' : 'Issue credentials'}
        </Button>
      </div>
      {issued && (
        <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2 space-y-1">
          <div className="text-emerald-700 font-semibold">Credentials issued for {issued.email}</div>
          <div className="text-slate-500">Send this one-time setup link to the SME (expires {new Date(issued.expiresAt).toLocaleString()}):</div>
          <div className="font-mono break-all text-[10px] text-slate-700">{issued.setupUrl}</div>
          <button
            onClick={() => { void navigator.clipboard.writeText(issued.setupUrl); }}
            className="text-[10px] underline"
            style={{ color: '#152448' }}
          >Copy link</button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#152448' }}>Active allocations</h4>
        {allocations.length === 0 && <p className="text-xs text-slate-400">No SMEs allocated yet.</p>}
        <div className="space-y-2">
          {allocations.map((a) => (
            <div key={a.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs">
              <div>
                <div className="font-semibold text-slate-700">{a.sme_email || `user#${a.sme_user_id}`} {a.sme_name ? <span className="text-slate-400">— {a.sme_name}</span> : null}</div>
                <div className="text-slate-500 text-[10px]">
                  scope: {(a.scope?.jurisdictions || []).join(',') || 'all'}
                  {a.scope?.notes ? ` · ${a.scope.notes}` : ''} ·
                  {a.active && !a.revoked_at ? <Badge className="ml-1 bg-emerald-100 text-emerald-700 text-[10px]">active</Badge>
                                              : <Badge className="ml-1 bg-slate-200 text-slate-600 text-[10px]">revoked</Badge>}
                </div>
              </div>
              {a.active && !a.revoked_at && (
                <button onClick={() => revoke(a.id)} className="text-red-400 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
