/**
 * Secure storage adapters for the React Native SDK wrapper.
 *
 * Three implementations, picked at runtime in order of preference:
 *   1. `expo-secure-store`  (preferred on Expo) — Keychain on iOS, Keystore on Android.
 *   2. `react-native-keychain` (preferred on bare RN).
 *   3. `@react-native-async-storage/async-storage` (FALLBACK — NOT encrypted).
 *
 * All deps are *peer + optional* — consumers add only the one they want. The
 * factory throws a descriptive error if none is installed when `requireSecure`
 * is true (default in production builds).
 */

export interface JrxSecureStorage {
  /** Returns the stored value, or null if missing. */
  getItem(key: string): Promise<string | null>;
  /** Stores the value, overwriting any existing entry. */
  setItem(key: string, value: string): Promise<void>;
  /** Removes the key. No-op if it does not exist. */
  removeItem(key: string): Promise<void>;
  /** Best-effort backend label for telemetry. */
  readonly backend: 'expo-secure-store' | 'keychain' | 'async-storage' | 'memory';
  readonly secure: boolean;
}

const JRX_KEY_NAMESPACE = 'nyv.v6.';

class MemoryStorage implements JrxSecureStorage {
  readonly backend = 'memory' as const;
  readonly secure = false;
  private map = new Map<string, string>();
  async getItem(k: string) { return this.map.get(JRX_KEY_NAMESPACE + k) ?? null; }
  async setItem(k: string, v: string) { this.map.set(JRX_KEY_NAMESPACE + k, v); }
  async removeItem(k: string) { this.map.delete(JRX_KEY_NAMESPACE + k); }
}

async function tryExpoSecureStore(): Promise<JrxSecureStorage | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ess = require('expo-secure-store');
    if (!ess?.setItemAsync) return null;
    return {
      backend: 'expo-secure-store',
      secure: true,
      async getItem(k: string) { return await ess.getItemAsync(JRX_KEY_NAMESPACE + k); },
      async setItem(k: string, v: string) { await ess.setItemAsync(JRX_KEY_NAMESPACE + k, v, { keychainAccessible: ess.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); },
      async removeItem(k: string) { await ess.deleteItemAsync(JRX_KEY_NAMESPACE + k); },
    };
  } catch { return null; }
}

async function tryKeychain(): Promise<JrxSecureStorage | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kc = require('react-native-keychain');
    if (!kc?.setGenericPassword) return null;
    return {
      backend: 'keychain',
      secure: true,
      async getItem(k: string) {
        const r = await kc.getGenericPassword({ service: JRX_KEY_NAMESPACE + k });
        return r ? (r as { password: string }).password : null;
      },
      async setItem(k: string, v: string) {
        await kc.setGenericPassword('nyv', v, { service: JRX_KEY_NAMESPACE + k });
      },
      async removeItem(k: string) {
        await kc.resetGenericPassword({ service: JRX_KEY_NAMESPACE + k });
      },
    };
  } catch { return null; }
}

async function tryAsyncStorage(): Promise<JrxSecureStorage | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const as = require('@react-native-async-storage/async-storage').default;
    if (!as?.setItem) return null;
    return {
      backend: 'async-storage',
      secure: false,
      async getItem(k: string) { return await as.getItem(JRX_KEY_NAMESPACE + k); },
      async setItem(k: string, v: string) { await as.setItem(JRX_KEY_NAMESPACE + k, v); },
      async removeItem(k: string) { await as.removeItem(JRX_KEY_NAMESPACE + k); },
    };
  } catch { return null; }
}

export interface JrxStorageOptions {
  /** When true, throw if no secure backend is available. Defaults to true. */
  requireSecure?: boolean;
}

/**
 * Factory — picks the best available storage backend at runtime.
 * Prefer this over instantiating individual backends directly.
 */
export async function createSecureStorage(opts: JrxStorageOptions = {}): Promise<JrxSecureStorage> {
  const requireSecure = opts.requireSecure ?? true;
  const ess = await tryExpoSecureStore();
  if (ess) return ess;
  const kc = await tryKeychain();
  if (kc) return kc;
  const as = await tryAsyncStorage();
  if (as && !requireSecure) return as;
  if (requireSecure) {
    throw new Error(
      'No secure storage backend installed. Install one of: ' +
      '`expo-secure-store` (recommended for Expo), ' +
      '`react-native-keychain` (bare RN), ' +
      'or pass { requireSecure: false } to fall back to AsyncStorage / memory.',
    );
  }
  return new MemoryStorage();
}

/** Stable storage keys used by the SDK. Treat as constants — do not change. */
export const JrxStorageKeys = {
  apiKey: 'apiKey',
  refreshToken: 'refreshToken',
  pushToken: 'pushToken',
  deviceId: 'deviceId',
  hitlInbox: 'hitlInbox',
  draftPrefix: 'draft.',
} as const;
