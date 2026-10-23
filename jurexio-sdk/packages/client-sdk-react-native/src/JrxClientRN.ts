/**
 * JrxClientRN — React Native wrapper around `JrxClient`.
 *
 * Differences vs the isomorphic `JrxClient`:
 *   - API key + refresh token live in secure storage (Keychain / Keystore).
 *   - Streaming uses `react-native-sse` when available; falls back to polling.
 *   - The default User-Agent identifies the RN platform for analytics.
 *   - Adds `permissions` (camera/mic/photos/push) and `push` (HITL) helpers
 *     so apps need only this one import.
 *
 * Usage:
 *   const nyv = await JrxClientRN.create({ baseUrl: 'https://api.jurexio.com' });
 *   await nyv.setApiKey('nyv_live_sk_...');   // securely persisted
 *   const ans = await nyv.client.ask('What is BNS Section 103?');
 *   await nyv.stream.streamPattern('cot', { task: '...' }, { onTextDelta: console.log });
 */

import { JrxClient, JrxError, type JrxClientConfig } from '@jurexio/client-sdk';
import {
  createSecureStorage,
  JrxStorageKeys,
  type JrxSecureStorage,
} from './storage.js';
import { JrxRNStreamReader } from './sse.js';
import * as permissions from './permissions.js';
import { registerForHITLPushNotifications, type RegisterHITLOptions, type HITLPushPayload } from './push.js';

export interface JrxClientRNCreateOptions extends Omit<JrxClientConfig, 'apiKey'> {
  /** Optional initial key — if omitted, restored from secure storage. */
  apiKey?: string;
  /** Override storage (e.g. inject memory storage in tests). */
  storage?: JrxSecureStorage;
  /** When true, allow falling back to AsyncStorage (NOT secure). Default false. */
  allowInsecureStorage?: boolean;
}

/**
 * A `JrxClient`-shaped object that hard-fails every call. Returned from
 * `client` after `signOut()` so a stale reference can't be used to make
 * authenticated requests.
 */
function createSignedOutClient(baseUrl: string): JrxClient {
  const handler: ProxyHandler<JrxClient> = {
    get(_t, prop) {
      if (prop === 'baseUrl') return baseUrl;
      if (prop === 'apiKey') return null;
      throw new JrxError({
        code: 'unauthenticated',
        message: 'JrxClientRN: no API key configured (call setApiKey first)',
        status: 401,
      });
    },
  };
  return new Proxy({} as JrxClient, handler);
}

export class JrxClientRN {
  readonly storage: JrxSecureStorage;
  readonly permissions = permissions;
  readonly baseUrl: string;
  private readonly _baseConfig: Omit<JrxClientConfig, 'apiKey'>;
  private _client: JrxClient;
  private _stream: JrxRNStreamReader;
  private _apiKey: string | null;

  static readonly VERSION = '5.0.0';

  private constructor(init: {
    apiKey: string | null;
    baseUrl: string;
    baseConfig: Omit<JrxClientConfig, 'apiKey'>;
    storage: JrxSecureStorage;
    nyv: JrxClient;
    stream: JrxRNStreamReader;
  }) {
    this._apiKey = init.apiKey;
    this.baseUrl = init.baseUrl;
    this._baseConfig = init.baseConfig;
    this.storage = init.storage;
    this._client = init.nyv;
    this._stream = init.stream;
  }

  /** Underlying JrxClient. After `signOut()` this returns a stub that throws on any call. */
  get client(): JrxClient { return this._client; }

  /** Streaming reader. After `signOut()` this still exists but has no API key, so calls will fail. */
  get stream(): JrxRNStreamReader { return this._stream; }

  /**
   * Async factory. Restores any previously saved API key from secure storage,
   * picks the best available storage backend, and constructs the underlying
   * JrxClient.
   */
  static async create(opts: JrxClientRNCreateOptions): Promise<JrxClientRN> {
    const baseUrl = (opts.baseUrl ?? 'https://app.jurexio.com').replace(/\/$/, '');
    const storage = opts.storage ?? await createSecureStorage({
      requireSecure: !(opts.allowInsecureStorage === true),
    });

    let apiKey: string | null = opts.apiKey ?? null;
    if (!apiKey) {
      apiKey = (await storage.getItem(JrxStorageKeys.apiKey)) ?? null;
    } else {
      // Caller provided a key — persist it for later launches.
      await storage.setItem(JrxStorageKeys.apiKey, apiKey);
    }

    // Strip our RN-only fields before forwarding to JrxClient.
    const { storage: _s, allowInsecureStorage: _a, apiKey: _k, ...baseConfig } = opts;

    const nyv = apiKey
      ? new JrxClient({ ...baseConfig, apiKey, baseUrl })
      : createSignedOutClient(baseUrl);

    const stream = new JrxRNStreamReader({
      apiKey: apiKey ?? '',
      baseUrl,
      userAgent: `JrxClientRN/${JrxClientRN.VERSION}`,
    });

    return new JrxClientRN({ apiKey, baseUrl, baseConfig, storage, nyv, stream });
  }

  /** Update the API key — also persists it to secure storage and rotates the underlying clients. */
  async setApiKey(key: string): Promise<void> {
    if (!key) throw new Error('setApiKey: key is required');
    this._apiKey = key;
    await this.storage.setItem(JrxStorageKeys.apiKey, key);
    this._client = new JrxClient({
      ...this._baseConfig,
      apiKey: key,
      baseUrl: this.baseUrl,
    });
    this._stream = new JrxRNStreamReader({
      apiKey: key,
      baseUrl: this.baseUrl,
      userAgent: `JrxClientRN/${JrxClientRN.VERSION}`,
    });
  }

  /** Returns the currently active API key, or null if none configured. */
  getApiKey(): string | null {
    return this._apiKey || null;
  }

  /**
   * Forget the API key from memory + secure storage AND rotate the in-memory
   * JrxClient/stream so any held reference can no longer authenticate as the
   * previous user.
   */
  async signOut(): Promise<void> {
    this._apiKey = null;
    await this.storage.removeItem(JrxStorageKeys.apiKey);
    await this.storage.removeItem(JrxStorageKeys.refreshToken);
    this._client = createSignedOutClient(this.baseUrl);
    this._stream = new JrxRNStreamReader({
      apiKey: '',
      baseUrl: this.baseUrl,
      userAgent: `JrxClientRN/${JrxClientRN.VERSION}`,
    });
  }

  /**
   * Convenience — register the device for HITL push notifications using the
   * currently active API key. Returns a result object.
   */
  registerForHITL(opts: Omit<RegisterHITLOptions, 'baseUrl' | 'apiKey' | 'storage'>) {
    if (!this._apiKey) throw new Error('registerForHITL: setApiKey first');
    return registerForHITLPushNotifications({
      baseUrl: this.baseUrl,
      apiKey: this._apiKey,
      storage: this.storage,
      ...opts,
    });
  }
}

export type { HITLPushPayload };
