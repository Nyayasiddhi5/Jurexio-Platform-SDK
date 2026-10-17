/**
 * NyvClientRN — React Native wrapper around `NyvClient`.
 *
 * Differences vs the isomorphic `NyvClient`:
 *   - API key + refresh token live in secure storage (Keychain / Keystore).
 *   - Streaming uses `react-native-sse` when available; falls back to polling.
 *   - The default User-Agent identifies the RN platform for analytics.
 *   - Adds `permissions` (camera/mic/photos/push) and `push` (HITL) helpers
 *     so apps need only this one import.
 *
 * Usage:
 *   const nyv = await NyvClientRN.create({ baseUrl: 'https://api.nyayavigya.com' });
 *   await nyv.setApiKey('nyv_live_sk_...');   // securely persisted
 *   const ans = await nyv.client.ask('What is BNS Section 103?');
 *   await nyv.stream.streamPattern('cot', { task: '...' }, { onTextDelta: console.log });
 */

import { NyvClient, NyvError, type NyvClientConfig } from '@jurexio/client-sdk';
import {
  createSecureStorage,
  NyvStorageKeys,
  type NyvSecureStorage,
} from './storage.js';
import { NyvRNStreamReader } from './sse.js';
import * as permissions from './permissions.js';
import { registerForHITLPushNotifications, type RegisterHITLOptions, type HITLPushPayload } from './push.js';

export interface NyvClientRNCreateOptions extends Omit<NyvClientConfig, 'apiKey'> {
  /** Optional initial key — if omitted, restored from secure storage. */
  apiKey?: string;
  /** Override storage (e.g. inject memory storage in tests). */
  storage?: NyvSecureStorage;
  /** When true, allow falling back to AsyncStorage (NOT secure). Default false. */
  allowInsecureStorage?: boolean;
}

/**
 * A `NyvClient`-shaped object that hard-fails every call. Returned from
 * `client` after `signOut()` so a stale reference can't be used to make
 * authenticated requests.
 */
function createSignedOutClient(baseUrl: string): NyvClient {
  const handler: ProxyHandler<NyvClient> = {
    get(_t, prop) {
      if (prop === 'baseUrl') return baseUrl;
      if (prop === 'apiKey') return null;
      throw new NyvError({
        code: 'unauthenticated',
        message: 'NyvClientRN: no API key configured (call setApiKey first)',
        status: 401,
      });
    },
  };
  return new Proxy({} as NyvClient, handler);
}

export class NyvClientRN {
  readonly storage: NyvSecureStorage;
  readonly permissions = permissions;
  readonly baseUrl: string;
  private readonly _baseConfig: Omit<NyvClientConfig, 'apiKey'>;
  private _client: NyvClient;
  private _stream: NyvRNStreamReader;
  private _apiKey: string | null;

  static readonly VERSION = '5.0.0';

  private constructor(init: {
    apiKey: string | null;
    baseUrl: string;
    baseConfig: Omit<NyvClientConfig, 'apiKey'>;
    storage: NyvSecureStorage;
    nyv: NyvClient;
    stream: NyvRNStreamReader;
  }) {
    this._apiKey = init.apiKey;
    this.baseUrl = init.baseUrl;
    this._baseConfig = init.baseConfig;
    this.storage = init.storage;
    this._client = init.nyv;
    this._stream = init.stream;
  }

  /** Underlying NyvClient. After `signOut()` this returns a stub that throws on any call. */
  get client(): NyvClient { return this._client; }

  /** Streaming reader. After `signOut()` this still exists but has no API key, so calls will fail. */
  get stream(): NyvRNStreamReader { return this._stream; }

  /**
   * Async factory. Restores any previously saved API key from secure storage,
   * picks the best available storage backend, and constructs the underlying
   * NyvClient.
   */
  static async create(opts: NyvClientRNCreateOptions): Promise<NyvClientRN> {
    const baseUrl = (opts.baseUrl ?? 'https://app.nyayavigya.in').replace(/\/$/, '');
    const storage = opts.storage ?? await createSecureStorage({
      requireSecure: !(opts.allowInsecureStorage === true),
    });

    let apiKey: string | null = opts.apiKey ?? null;
    if (!apiKey) {
      apiKey = (await storage.getItem(NyvStorageKeys.apiKey)) ?? null;
    } else {
      // Caller provided a key — persist it for later launches.
      await storage.setItem(NyvStorageKeys.apiKey, apiKey);
    }

    // Strip our RN-only fields before forwarding to NyvClient.
    const { storage: _s, allowInsecureStorage: _a, apiKey: _k, ...baseConfig } = opts;

    const nyv = apiKey
      ? new NyvClient({ ...baseConfig, apiKey, baseUrl })
      : createSignedOutClient(baseUrl);

    const stream = new NyvRNStreamReader({
      apiKey: apiKey ?? '',
      baseUrl,
      userAgent: `NyvClientRN/${NyvClientRN.VERSION}`,
    });

    return new NyvClientRN({ apiKey, baseUrl, baseConfig, storage, nyv, stream });
  }

  /** Update the API key — also persists it to secure storage and rotates the underlying clients. */
  async setApiKey(key: string): Promise<void> {
    if (!key) throw new Error('setApiKey: key is required');
    this._apiKey = key;
    await this.storage.setItem(NyvStorageKeys.apiKey, key);
    this._client = new NyvClient({
      ...this._baseConfig,
      apiKey: key,
      baseUrl: this.baseUrl,
    });
    this._stream = new NyvRNStreamReader({
      apiKey: key,
      baseUrl: this.baseUrl,
      userAgent: `NyvClientRN/${NyvClientRN.VERSION}`,
    });
  }

  /** Returns the currently active API key, or null if none configured. */
  getApiKey(): string | null {
    return this._apiKey || null;
  }

  /**
   * Forget the API key from memory + secure storage AND rotate the in-memory
   * NyvClient/stream so any held reference can no longer authenticate as the
   * previous user.
   */
  async signOut(): Promise<void> {
    this._apiKey = null;
    await this.storage.removeItem(NyvStorageKeys.apiKey);
    await this.storage.removeItem(NyvStorageKeys.refreshToken);
    this._client = createSignedOutClient(this.baseUrl);
    this._stream = new NyvRNStreamReader({
      apiKey: '',
      baseUrl: this.baseUrl,
      userAgent: `NyvClientRN/${NyvClientRN.VERSION}`,
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
