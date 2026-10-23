/**
 * Task #156 — SME-focused login.
 *
 * Posts directly to /api/auth/login (matches the main console flow), then
 * pushes the returned user into the local SmeAuthShell via AuthContext.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { setAuthSession } from '@/lib/auth-session';
import { resolveApiError } from '@/lib/jrx-messages';
import { consoleHomePath, isLegalChatLoginRole } from '@/lib/jrx-role-home';
import { BRAND, HEADING_FONT } from '@/features/legal-chat/brand';

interface LoginOk { token: string; user: { id: string | number; email: string; role: string; full_name?: string; org_id?: string | number } }
interface LoginErr { error?: string; message?: string }

export default function SmeLogin() {
  const { login } = useAuth();
  const [, setLoc] = useLocation();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password: pw }),
      });
      const j = (await r.json()) as LoginOk | LoginErr;
      if (!r.ok || !('token' in j)) {
        throw new Error(resolveApiError(j).message || `Sign-in failed (${r.status})`);
      }
      const u = {
        id: j.user.id,
        name: j.user.full_name || j.user.email,
        email: j.user.email,
        role: j.user.role,
        subscriptionTier: 'sme',
        subscriptionStatus: 'active',
        organizationId: j.user.org_id,
      };
      setAuthSession(j.token, u);
      // LegalChat login is SME-only — platform admins belong on /console/*
      if (!isLegalChatLoginRole(u.role)) {
        window.location.href = consoleHomePath(u.role);
        return;
      }
      login(u);
      setLoc('/chat');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: BRAND.canvas }}>
      <div className="w-full max-w-md">
        <Card className="w-full p-8 bg-white border-slate-200 shadow-xl rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
            <img
              src="/nyayasiddhi-icon.png"
              alt="Jurexio"
              className="w-12 h-12 object-contain rounded-xl bg-white border border-slate-200"
              onError={(e) => { (e.target as HTMLImageElement).src = '/nyayasiddhi-logo.png'; }}
            />
            <div>
              <h1 className="text-xl font-bold" style={{ fontFamily: HEADING_FONT, color: BRAND.royal }}>
                Jurexio SME Workspace
              </h1>
              <p className="text-xs font-medium" style={{ color: BRAND.gold }}>
                Justice. Powered by Precision.
              </p>
            </div>
          </div>
          <p className="text-[13px] mb-6 leading-relaxed" style={{ color: BRAND.muted }}>
            A focused shell for legal SMEs to exercise the full Jurexio stack on
            real prompts and rate every run via the 5-criteria GRPO rubric.
            CAM / maker-checker is forced ON for every SME session.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: BRAND.ink }}>Email</label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="bg-white border-slate-200 text-slate-800 focus-visible:ring-[#C7B15B]/40" data-testid="input-sme-email" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: BRAND.ink }}>Password</label>
              <Input type="password" required value={pw} onChange={(e) => setPw(e.target.value)}
                className="bg-white border-slate-200 text-slate-800 focus-visible:ring-[#C7B15B]/40" data-testid="input-sme-password" />
            </div>
            {err && <div className="text-sm" style={{ color: BRAND.error }}>{err}</div>}
            <Button type="submit" disabled={busy}
              className="w-full font-semibold text-white rounded-xl h-10"
              style={{ background: BRAND.royal }}
              data-testid="button-sme-login">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <div className="mt-5 flex items-center justify-center gap-4 text-[10.5px]" style={{ color: BRAND.muted }}>
            <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" style={{ color: BRAND.emerald }} /> CAM forced ON</span>
            <span>·</span>
            <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" style={{ color: BRAND.gold }} /> GRPO training live</span>
          </div>
          <p className="mt-5 text-[11px] text-center" style={{ color: BRAND.muted }}>
            Platform super-admins and org admins: use{' '}
            <a href="/console/login" className="underline font-medium" style={{ color: BRAND.royal }}>
              console login
            </a>{' '}
            instead — not this page.
          </p>
          <p className="mt-2 text-[11px] text-center" style={{ color: BRAND.muted }}>
            Invited via a one-time setup link? Open that link to set your
            password — you'll be brought back here automatically.
          </p>
        </Card>
      </div>
    </div>
  );
}
