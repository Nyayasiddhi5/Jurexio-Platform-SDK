/**
 * Offline-draft helpers.
 *
 * NYM consumer apps frequently need to:
 *   1. Capture a chat / case-brief draft while the device is offline.
 *   2. Persist it to local storage in a forward-compatible JSON envelope.
 *   3. Replay the draft to the gateway when connectivity returns.
 *
 * This module is intentionally storage-agnostic — pass any object that
 * implements the `OfflineDraftStore` interface (AsyncStorage, MMKV,
 * IndexedDB shim, an in-memory test stub, etc).
 */

import type {
  CaseBriefIntake,
  ClauseClassifyRequest,
  MitraChatRequest,
  NyayamitraLanguage,
} from './types.js';

/** Discriminator + payload for any draft kind. */
export type OfflineDraft =
  | { kind: 'chat';        payload: MitraChatRequest }
  | { kind: 'classify';    payload: ClauseClassifyRequest }
  | { kind: 'case-brief';  payload: CaseBriefIntake };

export interface OfflineDraftEnvelope<T extends OfflineDraft = OfflineDraft> {
  /** Stable per-draft id — caller-supplied or auto-generated. */
  id: string;
  /** Schema version of the envelope (this module ships v1). */
  v: 1;
  /** Wall-clock when the draft was captured (ISO-8601 UTC). */
  createdAt: string;
  /** Last attempt time (ISO-8601 UTC); null if never tried. */
  lastTriedAt: string | null;
  /** Number of replay attempts so far. */
  attempts: number;
  /** Latest error message if the last attempt failed. */
  lastError: string | null;
  /** Source language for analytics / triage. */
  language: NyayamitraLanguage;
  /** Discriminated draft. */
  draft: T;
}

/** Minimal storage contract — covers AsyncStorage, MMKV, IndexedDB shims. */
export interface OfflineDraftStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Default storage key — overridable per-instance. */
export const NYM_OFFLINE_DRAFTS_KEY = 'nym.offline.drafts.v1';

export interface OfflineDraftQueueOptions {
  store: OfflineDraftStore;
  /** Override the default storage key (eg multi-tenant apps). */
  storageKey?: string;
  /** Maximum drafts kept; oldest is evicted. Default 200. */
  maxDrafts?: number;
}

/**
 * A small queue that persists offline drafts and replays them when given a
 * `flush()` function. Single-process — not safe for concurrent app instances.
 */
export class OfflineDraftQueue {
  private readonly store: OfflineDraftStore;
  private readonly storageKey: string;
  private readonly maxDrafts: number;

  constructor(opts: OfflineDraftQueueOptions) {
    this.store = opts.store;
    this.storageKey = opts.storageKey ?? NYM_OFFLINE_DRAFTS_KEY;
    this.maxDrafts = Math.max(10, opts.maxDrafts ?? 200);
  }

  /** Read all queued drafts (oldest first). */
  async list(): Promise<OfflineDraftEnvelope[]> {
    const raw = await this.store.getItem(this.storageKey);
    return raw ? safeParse(raw) : [];
  }

  /** Persist a new draft. Returns the envelope with id + timestamps populated. */
  async enqueue(draft: OfflineDraft, opts?: { id?: string; language?: NyayamitraLanguage }): Promise<OfflineDraftEnvelope> {
    const envelope: OfflineDraftEnvelope = {
      id: opts?.id ?? generateId(),
      v: 1,
      createdAt: new Date().toISOString(),
      lastTriedAt: null,
      attempts: 0,
      lastError: null,
      language: opts?.language ?? inferLanguage(draft) ?? 'en',
      draft,
    };
    const all = await this.list();
    all.push(envelope);
    while (all.length > this.maxDrafts) all.shift();
    await this.store.setItem(this.storageKey, JSON.stringify(all));
    return envelope;
  }

  /** Remove a single envelope by id. No-op if missing. */
  async remove(id: string): Promise<void> {
    const all = await this.list();
    const next = all.filter(d => d.id !== id);
    if (next.length !== all.length) {
      await this.store.setItem(this.storageKey, JSON.stringify(next));
    }
  }

  /** Wipe the queue. */
  async clear(): Promise<void> {
    await this.store.removeItem(this.storageKey);
  }

  /**
   * Attempt to flush every queued draft via the supplied dispatcher. The
   * dispatcher receives the envelope and resolves on success — any thrown
   * error counts as a failed attempt and the envelope stays queued.
   *
   * Returns the count of successes / failures / skipped.
   */
  async flush(
    dispatcher: (env: OfflineDraftEnvelope) => Promise<void>,
    options?: { stopOnError?: boolean; maxAttempts?: number },
  ): Promise<{ ok: number; failed: number; skipped: number }> {
    const stopOnError = options?.stopOnError ?? false;
    const maxAttempts = options?.maxAttempts ?? 5;

    const all = await this.list();
    let ok = 0, failed = 0, skipped = 0;
    const remaining: OfflineDraftEnvelope[] = [];

    for (const env of all) {
      if (env.attempts >= maxAttempts) { skipped++; remaining.push(env); continue; }
      try {
        await dispatcher(env);
        ok++;
      } catch (e) {
        env.attempts++;
        env.lastTriedAt = new Date().toISOString();
        env.lastError = e instanceof Error ? e.message : String(e);
        remaining.push(env);
        failed++;
        if (stopOnError) {
          // Push the rest back unchanged and bail.
          const idx = all.indexOf(env);
          for (let i = idx + 1; i < all.length; i++) remaining.push(all[i]);
          break;
        }
      }
    }

    await this.store.setItem(this.storageKey, JSON.stringify(remaining));
    return { ok, failed, skipped };
  }
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function safeParse(raw: string): OfflineDraftEnvelope[] {
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(isEnvelope);
  } catch { return []; }
}

function isEnvelope(x: unknown): x is OfflineDraftEnvelope {
  if (!x || typeof x !== 'object') return false;
  const e = x as Partial<OfflineDraftEnvelope>;
  return e.v === 1 && typeof e.id === 'string' && typeof e.createdAt === 'string' && !!e.draft;
}

function inferLanguage(draft: OfflineDraft): NyayamitraLanguage | null {
  if (draft.kind === 'chat') return draft.payload.language ?? null;
  if (draft.kind === 'classify') return draft.payload.language ?? null;
  if (draft.kind === 'case-brief') return draft.payload.language ?? null;
  return null;
}

function generateId(): string {
  // Compact, sortable id: ms-since-epoch in base36 + 6 random base36 chars.
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `nymd_${t}_${r}`;
}
