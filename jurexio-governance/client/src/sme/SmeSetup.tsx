/**
 * Task #156 — SME setup page (token redemption).
 *
 * Reads ?token=… from the URL, asks for a new password, posts to
 * /api/jrx/auth/sme-setup. On success, stores the returned JWT + user
 * and routes to /sme.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Scale } from 'lucide-react';
import { setAuthSession } from '@/lib/auth-session';
import { BRAND, HEADING_FONT } from '@/features/legal-chat/brand';

import { nv } from '@/lib/jrx-api-paths';
interface SetupResponse {
  ok: true;
  token: string;
  user: { id: string | number; email: string; role: string };
}
interface ErrorResponse { error?: string; detail?: string }

export default function SmeSetup() {
  const { login } = useAuth();
  const [, setLoc] = useLocation();
  const [token, setToken] = useState<string>('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token') || '';
    setToken(t);
    if (!t) setErr('Setup link is missing its token. Ask your Superadmin to re-issue.');
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 10) { setErr('Password must be at least 10 characters.'); return; }
    if (pw !== pw2) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const r = await fetch(nv('auth/sme-setup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password: pw }),
      });
      const j = (await r.json()) as SetupResponse | ErrorResponse;
      if (!r.ok || !('ok' in j)) {
        const msg = ('error' in j && j.error) ? j.error : `setup failed (${r.status})`;
        throw new Error(msg);
      }
      setAuthSession(j.token, j.user);
      login({
        id: j.user.id,
        name: j.user.email,
        email: j.user.email,
        role: j.user.role,
        subscriptionTier: 'sme',
        subscriptionStatus: 'active',
      });
      setLoc('/');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: BRAND.canvas }}>
      <Card className="w-full max-w-md p-8 bg-white border-slate-200 shadow-xl rounded-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm"
            style={{ background: BRAND.royal, color: BRAND.gold }}>
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ fontFamily: HEADING_FONT, color: BRAND.royal }}>
              Set your SME password
            </h1>
            <p className="text-xs font-medium" style={{ color: '#8A7420' }}>One-time setup</p>
          </div>
        </div>
        <p className="text-[13px] mb-6 leading-relaxed" style={{ color: BRAND.muted }}>
          Choose a password for your Jurexio SME workspace. This link can
          only be used once.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: BRAND.ink }}>New password (min 10)</label>
            <Input type="password" required value={pw} onChange={(e) => setPw(e.target.value)}
              className="bg-white border-slate-200 text-slate-800 focus-visible:ring-[#C7B15B]/40" data-testid="input-sme-setup-pw" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: BRAND.ink }}>Confirm password</label>
            <Input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)}
              className="bg-white border-slate-200 text-slate-800 focus-visible:ring-[#C7B15B]/40" data-testid="input-sme-setup-pw2" />
          </div>
          {err && <div className="text-sm" style={{ color: BRAND.error }}>{err}</div>}
          <Button type="submit" disabled={busy || !token}
            className="w-full font-semibold text-white rounded-xl h-10"
            style={{ background: BRAND.royal }}
            data-testid="button-sme-setup-submit">
            {busy ? 'Setting up…' : 'Set password & enter workspace'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
