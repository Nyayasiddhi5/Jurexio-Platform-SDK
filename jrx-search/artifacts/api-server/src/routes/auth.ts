import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const COOKIE_NAME = "nyv_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required for auth");
  return s;
}

export function authRequired(): boolean {
  return process.env.AUTH_REQUIRED === "1";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function makeToken(username: string): string {
  const payload = `${username}.${Date.now() + SESSION_TTL_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [username, expStr] = [payload.slice(0, payload.lastIndexOf(".")), payload.slice(payload.lastIndexOf(".") + 1)];
  if (!username || Number(expStr) < Date.now()) return null;
  return username;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // still do a comparison to keep timing uniform
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function sessionUser(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return verifyToken(cookies?.[COOKIE_NAME]);
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin ?? req.headers.referer;
  if (!origin) return true; // non-browser clients (no Origin header)
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Machine auth for Nyayavigya SDK / knowledge-plane federation.
 * Accepts X-API-Key or Authorization: Bearer matching comma-separated
 * NYS_SDK_API_KEYS (preferred) or legacy NYS_KNOWLEDGE_API_KEY / MCP_TOKEN.
 */
function extractMachineApiKey(req: Request): string | null {
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.trim()) return xApiKey.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const parts = auth.split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer" && parts[1].trim()) {
      return parts[1].trim();
    }
  }
  return null;
}

function acceptedMachineKeys(): string[] {
  const raw =
    process.env.NYS_SDK_API_KEYS ||
    process.env.NYS_KNOWLEDGE_API_KEY ||
    process.env.MCP_TOKEN ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function machineKeyOk(req: Request): boolean {
  const presented = extractMachineApiKey(req);
  if (!presented) return false;
  const accepted = acceptedMachineKeys();
  if (accepted.length === 0) return false;
  const pb = Buffer.from(presented);
  for (const key of accepted) {
    const kb = Buffer.from(key);
    if (pb.length === kb.length && timingSafeEqual(pb, kb)) return true;
  }
  return false;
}

function isLocalhostOps(req: Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  const local =
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.endsWith("127.0.0.1");
  if (!local) return false;
  return (
    req.path === "/caselaw/embedding/coverage" ||
    req.path === "/statutes/embedding/coverage"
  );
}

export function authGuard(req: Request, res: Response, next: NextFunction): void {
  if (!authRequired()) return next();
  if (
    req.path === "/healthz" ||
    req.path.startsWith("/auth/") ||
    isLocalhostOps(req)
  ) {
    return next();
  }
  // SDK / east-west machine callers (Nyayavigya knowledge plane) — allow
  // without browser session cookie. Same-origin check skipped for API keys.
  if (machineKeyOk(req)) {
    (req as Request & { nysAuth?: string }).nysAuth = "api_key";
    return next();
  }
  if (!sessionUser(req)) {
    res.status(401).json({
      error: "Authentication required",
      // NYV-compatible envelope (additive dual format)
      errorDetail: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
    res.status(403).json({
      error: "Cross-origin request rejected",
      errorDetail: { code: "CSRF_REJECTED", message: "Cross-origin request rejected" },
    });
    return;
  }
  next();
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const router: IRouter = Router();

router.post("/auth/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  const expectedUser = process.env.SUPERADMIN_USERNAME;
  const expectedPass = process.env.SUPERADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) {
    req.log.error("SUPERADMIN_USERNAME/PASSWORD not configured");
    res.status(503).json({ error: "Authentication is not configured on this server" });
    return;
  }
  const userOk = constantTimeEquals(parsed.data.username, expectedUser);
  const passOk = constantTimeEquals(parsed.data.password, expectedPass);
  if (!userOk || !passOk) {
    req.log.warn({ username: parsed.data.username }, "Failed login attempt");
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  res.cookie(COOKIE_NAME, makeToken(parsed.data.username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
  });
  req.log.info({ username: parsed.data.username }, "Superadmin logged in");
  res.json({ ok: true, username: parsed.data.username });
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get("/auth/me", (req, res) => {
  if (!authRequired()) {
    res.json({ authenticated: true, authRequired: false, username: null });
    return;
  }
  const user = sessionUser(req);
  if (!user) {
    res.status(401).json({ authenticated: false, authRequired: true, username: null });
    return;
  }
  res.json({ authenticated: true, authRequired: true, username: user });
});

/**
 * NYV Console → nyayasearch SSO: one-time HMAC launch token.
 * Token format: base64url(payload).hmac where payload =
 *   `v1|username|path|expMs|nonce`
 * Shared secret: NYS_SSO_LAUNCH_SECRET (must match NYV gateway).
 */
function ssoSecret(): string | null {
  const s = (process.env.NYS_SSO_LAUNCH_SECRET ?? "").trim();
  return s || null;
}

function verifySsoLaunchToken(token: string): { username: string; path: string } | null {
  const sec = ssoSecret();
  if (!sec) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", sec).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const parts = payload.split("|");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const [, username, path, expStr] = parts;
  if (!username || Number(expStr) < Date.now()) return null;
  const safePath =
    path && path.startsWith("/") && !path.startsWith("//") && !path.includes("://")
      ? path
      : "/";
  return { username, path: safePath };
}

/** One-time nonce set (in-memory; multi-instance may accept twice — TTL is short). */
const usedSsoNonces = new Set<string>();

router.get("/auth/sso/callback", (req, res) => {
  if (!authRequired()) {
    res.redirect(302, typeof req.query.next === "string" ? req.query.next : "/");
    return;
  }
  if (!ssoSecret()) {
    res.status(503).send("SSO is not configured on this server");
    return;
  }
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const verified = verifySsoLaunchToken(token);
  if (!verified) {
    res.status(401).send("Invalid or expired SSO token");
    return;
  }
  // Extract nonce from payload for single-use (best-effort)
  try {
    const payloadB64 = token.slice(0, token.lastIndexOf("."));
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const nonce = payload.split("|")[4];
    if (nonce) {
      if (usedSsoNonces.has(nonce)) {
        res.status(401).send("SSO token already used");
        return;
      }
      usedSsoNonces.add(nonce);
      setTimeout(() => usedSsoNonces.delete(nonce), 120_000).unref?.();
    }
  } catch {
    /* ignore */
  }

  const sessionUserName =
    process.env.SUPERADMIN_USERNAME || verified.username || "nyv-operator";
  res.cookie(COOKIE_NAME, makeToken(sessionUserName), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
  });
  req.log?.info?.(
    { username: sessionUserName, path: verified.path },
    "NYV SSO launch accepted",
  );
  res.redirect(302, verified.path || "/");
});

export default router;
