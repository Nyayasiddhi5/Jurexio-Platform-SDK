/**
 * Push-notification handler for Human-In-The-Loop (HITL) responses.
 *
 * Flow:
 *   1. App calls `registerForHITLPushNotifications(client)` after sign-in.
 *   2. We ask `expo-notifications` for the device push token.
 *   3. We POST it to `/api/jrx/sdk/console/push-tokens` so the gateway can
 *      target this device when an HITL approval response comes back.
 *   4. We install a foreground listener that:
 *        - persists incoming HITL payloads to the SDK's secure storage inbox
 *          (so they survive app restart);
 *        - fans them out to a user-supplied callback so the UI can update.
 *
 * The `expo-notifications` import is *peer-optional* — apps that opt out of
 * push do not need to install it. The functions return a result object so
 * callers can render a banner ("install expo-notifications to enable HITL
 * approvals") instead of crashing.
 */

import type { NyvSecureStorage } from './storage.js';
import { NyvStorageKeys } from './storage.js';

export interface HITLPushPayload {
  hitlId: string;
  appId?: string | number;
  orchestrationId?: string;
  status: 'approved' | 'rejected' | 'requires_input' | 'pending';
  reviewerName?: string;
  reviewerComment?: string;
  receivedAt?: string;
  /** Anything else the gateway sends through. */
  [k: string]: unknown;
}

export interface HITLRegistration {
  registered: boolean;
  pushToken?: string;
  /** Why registration could not complete. */
  reason?: 'module-missing' | 'permission-denied' | 'no-token' | 'network' | 'error';
  error?: string;
}

export interface RegisterHITLOptions {
  /** Base URL of the NYV gateway. */
  baseUrl: string;
  /** SDK API key used to authenticate the registration POST. */
  apiKey: string;
  /** Where to persist incoming HITL payloads (storage.ts). Optional. */
  storage?: NyvSecureStorage;
  /** Foreground callback invoked when a HITL push arrives. */
  onHITL?: (payload: HITLPushPayload) => void;
  /** Override the device-id (otherwise derived from `expo-application`). */
  deviceId?: string;
}

/** Minimal shape of `expo-notifications` we depend on. */
interface ExpoNotificationsModule {
  requestPermissionsAsync(opts?: unknown): Promise<{ granted?: boolean }>;
  getExpoPushTokenAsync(): Promise<{ data?: string } | string>;
  addNotificationReceivedListener(
    cb: (evt: { request?: { content?: { data?: unknown } } }) => void,
  ): { remove?: () => void };
}

export async function registerForHITLPushNotifications(
  options: RegisterHITLOptions,
): Promise<HITLRegistration> {
  let n: ExpoNotificationsModule;
  try {
    n = require('expo-notifications') as ExpoNotificationsModule;
    if (!n?.requestPermissionsAsync) throw new Error('module-missing');
  } catch {
    return { registered: false, reason: 'module-missing' };
  }

  try {
    const perm = await n.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    if (!perm?.granted) return { registered: false, reason: 'permission-denied' };

    const tokenRes = await n.getExpoPushTokenAsync();
    const pushToken = typeof tokenRes === 'string' ? tokenRes : tokenRes?.data;
    if (!pushToken || typeof pushToken !== 'string') {
      return { registered: false, reason: 'no-token' };
    }

    if (options.storage) {
      await options.storage.setItem(NyvStorageKeys.pushToken, pushToken);
    }

    // Subscribe foreground listener BEFORE registering so we don't miss the
    // first ack push that the server sends after registration.
    if (options.onHITL) {
      n.addNotificationReceivedListener((evt) => {
        const data = evt?.request?.content?.data;
        if (!data || typeof data !== 'object') return;
        const payload = data as HITLPushPayload;
        if (payload.hitlId) {
          options.onHITL?.(payload);
          if (options.storage) {
            persistHITLToInbox(options.storage, payload).catch(() => { /* best-effort */ });
          }
        }
      });
    }

    // Register push token with the gateway. Use AbortController so a slow
    // network does not deadlock app startup.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(
        `${options.baseUrl.replace(/\/$/, '')}/api/jrx/sdk/console/push-tokens`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
            'X-NYV-Platform': 'mobile',
          },
          body: JSON.stringify({
            pushToken,
            deviceId: options.deviceId ?? null,
            platform: 'react-native',
            registeredAt: new Date().toISOString(),
          }),
          signal: ctrl.signal,
        },
      );
      if (!res.ok) {
        return { registered: false, reason: 'network', error: `HTTP ${res.status}`, pushToken };
      }
      return { registered: true, pushToken };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { registered: false, reason: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

async function persistHITLToInbox(storage: NyvSecureStorage, payload: HITLPushPayload) {
  const raw = await storage.getItem(NyvStorageKeys.hitlInbox);
  const inbox = raw ? (safeParseArray(raw)) : [];
  inbox.unshift({ ...payload, receivedAt: payload.receivedAt ?? new Date().toISOString() });
  // Keep last 200 entries — the inbox is a UX cache, not source of truth.
  if (inbox.length > 200) inbox.length = 200;
  await storage.setItem(NyvStorageKeys.hitlInbox, JSON.stringify(inbox));
}

function safeParseArray(raw: string): HITLPushPayload[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v as HITLPushPayload[] : [];
  } catch { return []; }
}
