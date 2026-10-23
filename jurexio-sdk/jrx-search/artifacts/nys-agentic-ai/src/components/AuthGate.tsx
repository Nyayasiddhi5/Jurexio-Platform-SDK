import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BRAND, BRAND_LOGO } from "@/lib/brand";

type AuthState = "loading" | "authenticated" | "login";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: "same-origin" })
      .then((r) => setState(r.ok ? "authenticated" : "login"))
      .catch(() => setState("login"));
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (state === "authenticated") return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        setState("authenticated");
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Login failed (${res.status})`);
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: `linear-gradient(160deg, ${BRAND.cream} 0%, ${BRAND.page} 55%, #EEF1F6 100%)` }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-8 shadow-sm"
        style={{ borderColor: BRAND.border }}
      >
        <div className="space-y-2 text-center">
          <img
            src={BRAND_LOGO.icon}
            alt="Nyayasiddhi"
            className="mx-auto h-12 w-12 rounded-md object-contain"
            width={48}
            height={48}
          />
          <h1
            className="text-xl font-semibold"
            style={{ fontFamily: "Merriweather, Georgia, serif", color: BRAND.primary }}
          >
            {BRAND_LOGO.productName}
          </h1>
          <p className="text-[11px] uppercase tracking-wider" style={{ color: BRAND.accent }}>
            {BRAND_LOGO.tagline}
          </p>
          <p className="text-sm text-muted-foreground">
            Sign in to Instant Search, statutes, caselaw, and evaluation runs
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          style={{ background: BRAND.primary }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
