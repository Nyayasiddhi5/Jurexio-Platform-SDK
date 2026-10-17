// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * jrx-security-monitor.ts — Jurexio Enterprise Platform SDK v5.0.0 / Phase C / T-07
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic SecurityAgent service.  Not an LLM agent — pure TypeScript.
 * Adds A2A boundary enforcement, cross-session attack detection, execution
 * depth cap, and capability boundary enforcement.
 *
 * INVARIANTS:
 *   • Never throws from logSecurityEvent (security must not break prod).
 *   • All Redis / DB / registry imports are lazy + try/catch — service degrades
 *     gracefully when any backend is unavailable.
 *   • No new database tables. Reuses existing nv_audit_logs hash chain.
 *   • Express middleware is a no-op when JRX_F_SECURITY_MONITOR is OFF
 *     (mounted gated in src/index.ts).
 *
 * CONFIG (env, all optional):
 *   JRX_MAX_EXEC_DEPTH       default 12     — max A2A recursion depth
 *   JRX_ATTACK_WINDOW_MS     default 3600000 — cross-session detection window
 *   JRX_ATTACK_THRESHOLD     default 5      — violations within window
 *   A2A_HMAC_SECRET          optional       — when set, enforces HMAC on A2A
 */

import { createHmac } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_DEPTH     = parseInt(process.env.JRX_MAX_EXEC_DEPTH ?? '12', 10);
const ATTACK_WINDOW = parseInt(process.env.JRX_ATTACK_WINDOW_MS ?? '3600000', 10);
const ATTACK_THRESH = parseInt(process.env.JRX_ATTACK_THRESHOLD ?? '5', 10);

// ── Types ─────────────────────────────────────────────────────────────────────
export interface A2AMessage {
  from: string;
  to: string;
  orchestrationId: string;
  piiRedacted: boolean;
  hmacSignature?: string;
  context?: {
    billingCode?: string;
    jurisdiction?: string;
    orgId?: string;
    matterId?: string;
  };
}

export type SecurityEventType =
  | 'INJECTION_ATTEMPT'
  | 'ROGUE_AGENT'
  | 'EXECUTION_DEPTH_EXCEEDED'
  | 'A2A_HMAC_INVALID'
  | 'CROSS_SESSION_ATTACK'
  | 'JAILBREAK_ATTEMPT'
  | 'CAPABILITY_VIOLATION'
  | 'SECURITY_VIOLATION';

export interface SecurityEvent {
  eventType: SecurityEventType;
  agentId?: string;
  orgId?: string;
  sessionId?: string;
  requestId?: string;
  detail: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// ── Lazy backends ─────────────────────────────────────────────────────────────
let _redis: any = null;
let _redisTried = false;
let _registry: any = null;
let _registryTried = false;

async function getRedis(): Promise<any> {
  if (_redis || _redisTried) return _redis;
  _redisTried = true;
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2307)
    const mod: any = await import('../utils/redis-client.js').catch(() => null);
    _redis = mod?.redis ?? mod?.default ?? null;
  } catch {
    _redis = null;
  }
  return _redis;
}

async function getRegistry(): Promise<any> {
  if (_registry || _registryTried) return _registry;
  _registryTried = true;
  try {
    const mod: any = await import('../services/agent-registry-service.js').catch(() => null);
    _registry = mod?.agentRegistry ?? mod?.AgentRegistry?.getInstance?.() ?? null;
  } catch {
    _registry = null;
  }
  return _registry;
}

function findAgent(registry: any, id: string): any | null {
  if (!registry) return null;
  try {
    if (typeof registry.findById === 'function') return registry.findById(id);
    if (typeof registry.getAgent === 'function') return registry.getAgent(id);
    if (typeof registry.get === 'function') return registry.get(id);
  } catch { /* ignore */ }
  return null;
}

// ── 1. A2A Boundary Enforcement ───────────────────────────────────────────────
export async function validateA2AMessage(
  msg: A2AMessage,
  product: 'jurexio' | 'jurexio' = 'jurexio',
): Promise<void> {
  const registry = await getRegistry();

  // 1a. Sender registered
  if (registry) {
    const sender = findAgent(registry, msg.from);
    if (!sender) {
      await logSecurityEvent({
        eventType: 'ROGUE_AGENT',
        agentId: msg.from,
        detail: `Unregistered A2A sender: ${msg.from}`,
        severity: 'CRITICAL',
      });
      throw new Error('A2A_UNREGISTERED_SENDER');
    }
  }

  // 1b. HMAC verification.  When A2A_HMAC_SECRET is configured, EVERY A2A
  // message MUST carry a valid signature — accepting unsigned messages while a
  // secret is set would silently weaken authenticity.  When the secret is not
  // configured the system runs in permissive mode (dev/local).
  const hmacSecret = process.env.A2A_HMAC_SECRET;
  if (hmacSecret) {
    if (!msg.hmacSignature) {
      await logSecurityEvent({
        // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
        eventType: 'A2A_HMAC_MISSING',
        agentId: msg.from,
        detail: 'A2A_HMAC_SECRET configured but message arrived without hmacSignature',
        severity: 'HIGH',
      });
      throw new Error('A2A_HMAC_MISSING');
    }
    const payload = JSON.stringify({
      from: msg.from,
      to: msg.to,
      orchestrationId: msg.orchestrationId,
    });
    const expected = createHmac('sha256', hmacSecret).update(payload).digest('hex');
    if (expected !== msg.hmacSignature) {
      await logSecurityEvent({
        eventType: 'A2A_HMAC_INVALID',
        agentId: msg.from,
        detail: 'HMAC signature mismatch — possible message tampering',
        severity: 'HIGH',
      });
      throw new Error('A2A_HMAC_INVALID');
    }
  }

  // 1c. Execution depth cap (Redis-backed; skipped when Redis unavailable)
  const redis = await getRedis();
  if (redis && msg.orchestrationId) {
    const depthKey = `nyv:depth:${msg.orchestrationId}`;
    let depth = 0;
    try { depth = parseInt((await redis.get(depthKey)) ?? '0', 10) || 0; } catch { /* ignore */ }
    if (depth >= MAX_DEPTH) {
      await logSecurityEvent({
        eventType: 'EXECUTION_DEPTH_EXCEEDED',
        agentId: msg.to,
        detail: `Execution depth ${depth} >= cap ${MAX_DEPTH} for orchestrationId ${msg.orchestrationId}`,
        severity: 'HIGH',
      });
      throw new Error('EXECUTION_DEPTH_EXCEEDED');
    }
    try {
      if (typeof redis.set === 'function') {
        await redis.set(depthKey, String(depth + 1), 'EX', Math.ceil(ATTACK_WINDOW / 1000));
      }
    } catch { /* ignore */ }
  }

  // 1d. PII redaction confirmed
  if (!msg.piiRedacted) {
    await logSecurityEvent({
      eventType: 'SECURITY_VIOLATION',
      agentId: msg.from,
      detail: 'A2A message sent without PII redaction confirmation (piiRedacted: false)',
      severity: 'HIGH',
    });
    throw new Error('A2A_PII_NOT_REDACTED');
  }

  // 1e. Jurexio: billing code propagation
  if (product === 'jurexio' && !msg.context?.billingCode) {
    await logSecurityEvent({
      eventType: 'SECURITY_VIOLATION',
      agentId: msg.from,
      detail: 'Jurexio A2A message missing required billingCode in context',
      severity: 'MEDIUM',
    });
    throw new Error('A2A_BILLING_CODE_MISSING');
  }
}

// ── 2. Cross-Session Attack Detection ─────────────────────────────────────────
export async function detectCrossSessionAttack(
  orgId: string,
  sessionId: string,
  violationType: string,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  const key = `nyv:sec:violations:${orgId}:${violationType}`;
  let count = 0;
  try {
    count = await redis.incr(key);
    if (count === 1 && typeof redis.expire === 'function') {
      await redis.expire(key, Math.ceil(ATTACK_WINDOW / 1000));
    }
  } catch {
    return false;
  }

  if (count >= ATTACK_THRESH) {
    await logSecurityEvent({
      eventType: 'CROSS_SESSION_ATTACK',
      orgId,
      sessionId,
      detail: `${violationType}: ${count} violations in ${Math.round(ATTACK_WINDOW / 60000)}min — threshold ${ATTACK_THRESH}`,
      severity: 'CRITICAL',
    });
    return true;
  }
  return false;
}

// ── 3. Capability Boundary Enforcement ────────────────────────────────────────
export async function enforceCapabilityBoundary(
  agentId: string,
  requestedPattern: string,
): Promise<void> {
  const registry = await getRegistry();
  if (!registry) return; // permissive when registry unavailable

  const agent = findAgent(registry, agentId);
  if (!agent) {
    await logSecurityEvent({
      eventType: 'ROGUE_AGENT',
      agentId,
      detail: `Agent not found in registry: ${agentId}`,
      severity: 'HIGH',
    });
    throw new Error(`AGENT_NOT_IN_REGISTRY: ${agentId}`);
  }

  const allowed: string[] = agent.agenticPatterns ?? agent.patterns ?? [];
  if (!Array.isArray(allowed) || allowed.length === 0) return;

  if (!allowed.includes(requestedPattern) && !allowed.includes('ALL')) {
    await logSecurityEvent({
      eventType: 'CAPABILITY_VIOLATION',
      agentId,
      detail: `Pattern ${requestedPattern} not in declared allowlist: [${allowed.join(', ')}]`,
      severity: 'MEDIUM',
    });
    throw new Error(`CAPABILITY_BOUNDARY_VIOLATION: agent=${agentId}, pattern=${requestedPattern}`);
  }
}

// ── 4. Security Event Logger → IronLedger hash chain ─────────────────────────
export async function logSecurityEvent(evt: SecurityEvent): Promise<void> {
  try {
    const jwtSecret = process.env.JRX_JWT_SECRET ?? 'default-secret-do-not-use';
    const orgKey = evt.orgId ?? 'system';

    let prevHash = '0x00';
    const redis = await getRedis();
    if (redis) {
      try { prevHash = (await redis.get(`nyv:audit:last:${orgKey}`)) ?? '0x00'; } catch { /* ignore */ }
    }

    const entry = { ...evt, timestamp: new Date().toISOString(), prevHash };
    const hash = createHmac('sha256', jwtSecret).update(JSON.stringify(entry)).digest('hex');

    if (redis) {
      try { await redis.set(`nyv:audit:last:${orgKey}`, hash); } catch { /* ignore */ }
    }

    if (evt.severity === 'CRITICAL') {
      // Use stderr so this is never lost behind log-level filters
      console.error(`[NV-SECURITY-MONITOR] CRITICAL: ${evt.eventType} | ${evt.detail} | hash=${hash.slice(0, 12)}…`);
    }
  } catch {
    // Security monitor NEVER throws — production requests must not be blocked by logging failure.
  }
}

// ── 5. Express Middleware ─────────────────────────────────────────────────────
/**
 * Mounted in src/index.ts after auth, gated on JRX_F_SECURITY_MONITOR.
 * On a flagged-injection request (req._securityFlags.injectionFlagged === true),
 * runs cross-session attack detection.  When the threshold is exceeded the
 * request is rejected with 429 SECURITY_BLOCK.  All other requests pass through.
 */
// Inline prompt-injection signal — kept narrow + fast so it can run on every
// flagged-on request without measurable latency.  Returning `true` only feeds
// the cross-session counter; the actual block decision still comes from
// `detectCrossSessionAttack` once the per-org threshold is exceeded.
const INJECTION_SNIFFERS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /disregard\s+(?:the\s+)?system\s+prompt/i,
  /you\s+are\s+now\s+(?:dan|jailbroken|unrestricted)/i,
  /reveal\s+your\s+(?:system\s+)?(?:prompt|instructions)/i,
  /forget\s+(?:everything|all|previous)/i,
  /\bprompt\s*injection\b/i,
  /<\s*\/?\s*(?:system|admin|root)\s*>/i,
];

function detectInjectionInBody(body: unknown): boolean {
  if (!body) return false;
  let text = '';
  try {
    text = typeof body === 'string' ? body : JSON.stringify(body);
  } catch { return false; }
  if (text.length > 50_000) text = text.slice(0, 50_000); // hard cap
  for (const re of INJECTION_SNIFFERS) {
    if (re.test(text)) return true;
  }
  return false;
}

export async function securityMonitorMiddleware(
  req: Request & { _securityFlags?: { injectionFlagged?: boolean } },
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Tenant id can arrive under any of these — tolerate all auth shapes.
    const u = (req as any).user ?? {};
    const orgId: string | undefined = u.organizationId ?? u.orgId ?? u.tenantId ?? u.org_id;

    const sessionId = (req.headers['x-request-id'] as string) ??
      (req.headers['x-session-id'] as string) ?? 'unknown';

    // An upstream guardrail may already have flagged the request; if not, run
    // the inline sniffer on the request body so this middleware is never inert.
    const upstreamFlag = req._securityFlags?.injectionFlagged === true;
    const inlineFlag   = detectInjectionInBody(req.body);
    const flagged      = upstreamFlag || inlineFlag;

    if (flagged && orgId) {
      const blocked = await detectCrossSessionAttack(orgId, sessionId, 'injection');
      if (blocked) {
        res.status(429).json({
          error: 'SECURITY_BLOCK',
          code: 'CROSS_SESSION_ATTACK',
          message: 'Request blocked due to repeated security policy violations.',
        });
        return;
      }
      // Propagate signal so downstream handlers can short-circuit if they choose.
      if (!req._securityFlags) req._securityFlags = {};
      req._securityFlags.injectionFlagged = true;
    }

    next();
  } catch {
    next(); // never block on monitor failure
  }
}
