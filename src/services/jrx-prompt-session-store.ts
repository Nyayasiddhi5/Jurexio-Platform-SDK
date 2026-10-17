/**
 * NV-AGENT-PROMPT-SESSION-001 — Prompt constitution session store.
 *
 * Tracks whether the full 23-section system prompt (L0) was loaded for
 * agentId × jurisdiction × sessionId, so Turn 2+ can send L1+L2 only.
 *
 * Backed by Redis (nvRedisCache) with in-memory fallback for local/dev.
 */

import { createLogger } from '../utils/logger.js';
import crypto from 'crypto';

const logger = createLogger('./jrx-prompt-session-store');

export const PROMPT_SESSION_TTL_MS = 30 * 60 * 1000;

export interface PromptConstitutionSession {
  sessionId: string;
  agentId: string;
  jurisdiction: string;
  promptHash: string;
  constitutionLoaded: boolean;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

const memory = new Map<string, { value: PromptConstitutionSession; expiresAt: number }>();

function sessionKey(sessionId: string, agentId: string, jurisdiction: string): string {
  return `prompt-const:${sessionId}:${agentId}:${String(jurisdiction || 'IN').toUpperCase()}`;
}

function touchMemory(key: string, value: PromptConstitutionSession): void {
  memory.set(key, { value, expiresAt: Date.now() + PROMPT_SESSION_TTL_MS });
  if (memory.size > 2000) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
}

function getMemory(key: string): PromptConstitutionSession | null {
  const e = memory.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    memory.delete(key);
    return null;
  }
  return e.value;
}

async function redisGet(key: string): Promise<PromptConstitutionSession | null> {
  try {
    const { nvRedisCache } = await import('./jrx-redis-cache-service.js');
    return (await nvRedisCache.get<PromptConstitutionSession>(key)) ?? null;
  } catch {
    return null;
  }
}

async function redisSet(key: string, value: PromptConstitutionSession): Promise<void> {
  try {
    const { nvRedisCache } = await import('./jrx-redis-cache-service.js');
    await nvRedisCache.set(key, value, PROMPT_SESSION_TTL_MS);
  } catch {
    /* memory-only */
  }
}

/**
 * Resolve constitution state and advance turn. Call once per leaf LLM dispatch.
 * If promptHash changes (registry bump) or agent switches → force Turn 1 reload.
 */
export async function beginPromptConstitutionTurn(opts: {
  sessionId: string;
  agentId: string;
  jurisdiction?: string;
  promptHash: string;
}): Promise<{
  turnNumber: number;
  mode: 'turn1_full' | 'turn2_plus';
  state: PromptConstitutionSession;
}> {
  const sessionId = String(opts.sessionId || '').trim();
  const agentId = String(opts.agentId || 'unknown').trim();
  const jurisdiction = String(opts.jurisdiction || 'IN').toUpperCase();
  const promptHash = String(opts.promptHash || '');

  if (!sessionId) {
    // Caller should use single_shot; return synthetic turn1 for safety if misused
    const now = new Date().toISOString();
    return {
      turnNumber: 1,
      mode: 'turn1_full',
      state: {
        sessionId: '',
        agentId,
        jurisdiction,
        promptHash,
        constitutionLoaded: false,
        turnCount: 1,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  const key = sessionKey(sessionId, agentId, jurisdiction);
  let state = getMemory(key) || (await redisGet(key));
  const now = new Date().toISOString();

  if (!state || state.promptHash !== promptHash || !state.constitutionLoaded) {
    state = {
      sessionId,
      agentId,
      jurisdiction,
      promptHash,
      constitutionLoaded: true,
      turnCount: 1,
      createdAt: state?.createdAt || now,
      updatedAt: now,
    };
    touchMemory(key, state);
    await redisSet(key, state);
    logger.info('[PromptSession] Turn 1 constitution load', {
      sessionId: sessionId.slice(0, 12),
      agentId,
      promptHash,
    });
    return { turnNumber: 1, mode: 'turn1_full', state };
  }

  state = {
    ...state,
    turnCount: state.turnCount + 1,
    updatedAt: now,
  };
  touchMemory(key, state);
  await redisSet(key, state);
  logger.info('[PromptSession] Turn 2+ L1+L2', {
    sessionId: sessionId.slice(0, 12),
    agentId,
    turnCount: state.turnCount,
  });
  return { turnNumber: state.turnCount, mode: 'turn2_plus', state };
}

/**
 * Auto-mint a stable session id for ecosystem partners when they omit one.
 * Same org/user/day → same session so load-once can activate across calls.
 *
 * NV-SESSION-POOLING-001 — this is safe ONLY when `userId` identifies a real end
 * user. It does not when the caller is an SDK key with no `x-customer-user-id`:
 * `userId` then falls back to `sdk:<appName>` (see `jrx-orchestration-routes.ts`),
 * which is the SAME value for every end user of that platform. The hash would
 * then collapse to **one session per platform per day**, and because session
 * memory is written under it, one advocate's matter facts land in another
 * advocate's context.
 *
 * Measured live on jrx-staging before this guard: two NSP requests sent with no
 * `x-customer-user-id` both received `jrx-sess-nsp-9ae2cc89bab6bce7`, and the model
 * reported back *"the retrieved memory context in this session appears to belong to
 * a different matter/client thread"* — i.e. cross-matter context did reach the
 * prompt and only the model's own refusal prevented disclosure. Model discretion is
 * not an access-control boundary, least of all on privileged legal material.
 *
 * So an app-level identity now yields a **per-request** id instead. That
 * deliberately gives up cross-call continuity for those callers — continuity is a
 * feature, cross-matter bleed is a confidentiality breach, and a partner that wants
 * continuity has two correct ways to ask for it: send `x-customer-user-id`, or send
 * an explicit `sessionId`. Both are honoured above and below.
 */
const APP_LEVEL_IDENTITY_RE = /^sdk[:_-]/i;

export function isAppLevelIdentity(userId?: string | null): boolean {
  const u = String(userId || '').trim();
  return !u || u.toLowerCase() === 'anon' || APP_LEVEL_IDENTITY_RE.test(u);
}

export function mintEcosystemPromptSessionId(opts: {
  platform?: string | null;
  userId?: string | null;
  orgId?: string | null;
  explicitSessionId?: string | null;
}): string {
  const explicit = String(opts.explicitSessionId || '').trim();
  if (explicit) return explicit;

  const platform = String(opts.platform || 'ECO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ECO';
  const user = String(opts.userId || 'anon');
  const org = String(opts.orgId || 'org');

  /* NV-SESSION-POOLING-001 — no real end-user identity ⇒ no shared bucket. */
  if (isAppLevelIdentity(user)) {
    const nonce = crypto.randomBytes(8).toString('hex');
    logger.warn('[PromptSession] no end-user identity — minting a per-request session (no cross-call memory)', {
      alertCode: 'JRX-SESSION-POOLING-001',
      platform,
      orgId: org,
      remedy: 'partner should send x-customer-user-id, or an explicit sessionId, to get continuity',
    });
    return `jrx-sess-${platform.toLowerCase()}-req-${nonce}`;
  }

  const day = new Date().toISOString().slice(0, 10);
  const h = crypto.createHash('sha256').update(`${platform}|${org}|${user}|${day}`).digest('hex').slice(0, 16);
  return `jrx-sess-${platform.toLowerCase()}-${h}`;
}

/** Test helper */
export function __clearPromptConstitutionMemory(): void {
  memory.clear();
}
