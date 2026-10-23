/**
 * BIPA Consent Privacy Page (task-357).
 *
 * Lets a data subject:
 *  - View any 740 ILCS 14/15(b) written-consent records on file
 *  - Grant a new written consent for a specific biometric identifier
 *  - Revoke an active consent (triggers §15(a) destruction worker)
 *
 * Backed by /api/jrx/bipa/consent/{policy,status,grant,revoke}.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, RefreshCw, CheckCircle2, AlertCircle, Trash2, Fingerprint, FileSignature } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

type BiometricType = 'voiceprint' | 'facial_geometry' | 'fingerprint' | 'iris_scan' | 'retina_scan' | 'hand_scan';

interface BipaRecord {
  id: string;
  userId: string;
  orgId: string | null;
  biometricType: BiometricType;
  status: 'granted' | 'revoked' | 'expired';
  disclosureText: string;
  purpose: string;
  retentionTerm: string;
  signatureName: string;
  policyVersion: string;
  grantedAt: string;
  revokedAt: string | null;
  destroyedAt: string | null;
}

interface StatusResp {
  success: boolean;
  userId: string;
  activeBiometricTypes: BiometricType[];
  policyVersion: string;
  records: BipaRecord[];
}

interface PolicyResp {
  success: boolean;
  statute: string;
  policyVersion: string;
  biometricTypes: BiometricType[];
  retentionTerm: string;
  disclosureSummary: string;
}

async function jget<T>(u: string): Promise<T> {
  const r = await fetch(u, { credentials: 'include' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function jpost<T>(u: string, body: unknown): Promise<T> {
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

const STATUS_BADGE: Record<BipaRecord['status'], string> = {
  granted: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  revoked: 'text-rose-700 bg-rose-50 border-rose-200',
  expired: 'text-slate-600 bg-slate-100 border-slate-200',
};

const TYPE_LABEL: Record<BiometricType, string> = {
  voiceprint: 'Voiceprint',
  facial_geometry: 'Facial geometry',
  fingerprint: 'Fingerprint',
  iris_scan: 'Iris scan',
  retina_scan: 'Retina scan',
  hand_scan: 'Hand scan',
};

export default function BipaConsentPage() {
  const qc = useQueryClient();
  const policy = useQuery<PolicyResp>({
    queryKey: ['bipa-policy'],
    queryFn: () => jget<PolicyResp>('/api/jrx/bipa/consent/policy'),
    refetchOnWindowFocus: false,
  });
  const status = useQuery<StatusResp>({
    queryKey: ['bipa-status'],
    queryFn: () => jget<StatusResp>('/api/jrx/bipa/consent/status'),
    refetchOnWindowFocus: false,
  });

  const [biometricType, setBiometricType] = useState<BiometricType>('voiceprint');
  const [purpose, setPurpose] = useState('Voice transcription for legal-AI dictation');
  const [signatureName, setSignatureName] = useState('');

  const grant = useMutation({
    mutationFn: () => jpost('/api/jrx/bipa/consent/grant', { biometricType, purpose, signatureName }),
    onSuccess: () => {
      setSignatureName('');
      qc.invalidateQueries({ queryKey: ['bipa-status'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (b: BiometricType) => jpost('/api/jrx/bipa/consent/revoke', { biometricType: b, reason: 'data-subject revoke from privacy page' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bipa-status'] }),
  });

  const activeSet = useMemo(() => new Set(status.data?.activeBiometricTypes ?? []), [status.data]);

  return (
    <div className="min-h-screen p-6 bg-[#F9FAFB]" data-testid="page-bipa-consent">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <ShieldCheck className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>
            Biometric Privacy (BIPA 740 ILCS 14/15)
          </h1>
          <Badge variant="outline" className="ml-2">Illinois</Badge>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => { policy.refetch(); status.refetch(); }} data-testid="btn-refresh-bipa">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${status.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        <p className="text-sm text-slate-600 mb-5">
          Jurexio obtains your written, informed consent before collecting any biometric identifier
          (voiceprint, facial geometry, fingerprint, iris/retina, or hand scan). Revoking a consent
          immediately runs the §15(a) destruction worker against any stored biometric data.
        </p>

        <Card className="mb-5" data-testid="card-bipa-policy">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileSignature className="w-4 h-4" /> Disclosure (§15(b))</CardTitle></CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-2">
            {policy.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : policy.data ? (
              <>
                <p>{policy.data.disclosureSummary}</p>
                <p className="text-xs text-slate-500">
                  Policy version <span className="font-mono">{policy.data.policyVersion}</span> · Statute {policy.data.statute}
                </p>
                <p className="text-xs text-slate-500"><strong>Retention:</strong> {policy.data.retentionTerm}</p>
              </>
            ) : (
              <p className="text-rose-600 text-xs">Failed to load disclosure.</p>
            )}
          </CardContent>
        </Card>

        <Card className="mb-5" data-testid="card-bipa-grant">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Fingerprint className="w-4 h-4" /> Grant written consent</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Biometric identifier</Label>
                <select
                  value={biometricType}
                  onChange={(e) => setBiometricType(e.target.value as BiometricType)}
                  className="mt-1 w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
                  data-testid="select-bipa-type"
                >
                  {(Object.keys(TYPE_LABEL) as BiometricType[]).map(t => (
                    <option key={t} value={t}>{TYPE_LABEL[t]}{activeSet.has(t) ? ' (already granted)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Printed name (signature)</Label>
                <Input
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="Type your full legal name"
                  data-testid="input-bipa-signature"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Purpose of collection</Label>
              <Textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={2}
                data-testid="input-bipa-purpose"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => grant.mutate()}
                disabled={!signatureName || grant.isPending || activeSet.has(biometricType)}
                data-testid="btn-bipa-grant"
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                {activeSet.has(biometricType) ? 'Already granted' : 'I consent in writing'}
              </Button>
              {grant.isError && <span className="text-xs text-rose-600">Grant failed: {String((grant.error as Error)?.message)}</span>}
              {grant.isSuccess && <span className="text-xs text-emerald-700">Consent recorded.</span>}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-bipa-records">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Your BIPA consent records</CardTitle></CardHeader>
          <CardContent>
            {status.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !status.data?.records?.length ? (
              <p className="text-sm text-slate-500">No BIPA consent records on file. Grant one above to enable biometric capture.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-bipa-records">
                  <thead className="text-xs text-slate-600 border-b">
                    <tr>
                      <th className="text-left py-2 pr-3">Identifier</th>
                      <th className="text-left py-2 pr-3">Status</th>
                      <th className="text-left py-2 pr-3">Granted</th>
                      <th className="text-left py-2 pr-3">Revoked</th>
                      <th className="text-left py-2 pr-3">Destroyed</th>
                      <th className="text-left py-2 pr-3">Signature</th>
                      <th className="text-right py-2 pl-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.data.records.map(r => (
                      <tr key={r.id} className="border-b last:border-0" data-testid={`row-bipa-${r.biometricType}-${r.status}`}>
                        <td className="py-2 pr-3 font-medium">{TYPE_LABEL[r.biometricType] ?? r.biometricType}</td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs ${STATUS_BADGE[r.status]}`}>
                            {r.status === 'granted' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-600">{new Date(r.grantedAt).toLocaleString()}</td>
                        <td className="py-2 pr-3 text-xs text-slate-600">{r.revokedAt ? new Date(r.revokedAt).toLocaleString() : '—'}</td>
                        <td className="py-2 pr-3 text-xs text-slate-600">{r.destroyedAt ? new Date(r.destroyedAt).toLocaleString() : '—'}</td>
                        <td className="py-2 pr-3 text-xs">{r.signatureName}</td>
                        <td className="py-2 pl-3 text-right">
                          {r.status === 'granted' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => revoke.mutate(r.biometricType)}
                              disabled={revoke.isPending}
                              data-testid={`btn-bipa-revoke-${r.biometricType}`}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              Revoke + destroy
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-500">No action</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {revoke.isError && <p className="text-xs text-rose-600 mt-2">Revoke failed: {String((revoke.error as Error)?.message)}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
