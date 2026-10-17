/**
 * Native permission helpers — wrap the Expo permission APIs with a single,
 * consistent interface so app code never has to remember which module exports
 * which `requestPermissionsAsync`.
 *
 * Each helper is *peer-optional* — if the underlying Expo module is not
 * installed the helper returns `{ granted: false, reason: 'module-missing' }`
 * with the name of the missing module, so consumers can produce a clear error
 * to the user instead of crashing.
 */

export interface JrxPermissionResult {
  granted: boolean;
  /** Optional explanation when not granted. */
  reason?: 'denied' | 'restricted' | 'undetermined' | 'module-missing' | 'error';
  /** Module name we attempted to load. */
  module?: string;
  /** Underlying error message, if any. */
  error?: string;
}

/** Shape of every Expo permission result we accept. */
interface ExpoPermissionResponse {
  granted?: boolean;
  status?: string;
}
type ExpoPermissionFn = (opts?: unknown) => Promise<ExpoPermissionResponse>;

const REASONS: ReadonlySet<NonNullable<JrxPermissionResult['reason']>> = new Set([
  'denied', 'restricted', 'undetermined', 'module-missing', 'error',
]);
function toReason(s: string | undefined): JrxPermissionResult['reason'] {
  if (!s) return 'denied';
  return REASONS.has(s as NonNullable<JrxPermissionResult['reason']>)
    ? (s as NonNullable<JrxPermissionResult['reason']>)
    : 'denied';
}

function notInstalled(module: string): JrxPermissionResult {
  return { granted: false, reason: 'module-missing', module };
}
function ok(): JrxPermissionResult { return { granted: true }; }
function denied(reason: JrxPermissionResult['reason'] = 'denied'): JrxPermissionResult {
  return { granted: false, reason };
}

function isModuleNotFound(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'MODULE_NOT_FOUND';
}
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runPermissionFlow(
  moduleName: string,
  loader: () => ExpoPermissionFn | null,
  args?: unknown,
): Promise<JrxPermissionResult> {
  let fn: ExpoPermissionFn | null;
  try {
    fn = loader();
  } catch (e) {
    if (isModuleNotFound(e)) return notInstalled(moduleName);
    return { granted: false, reason: 'error', error: errMessage(e) };
  }
  if (!fn) return notInstalled(moduleName);
  try {
    const r = await fn(args);
    return r?.granted ? ok() : denied(toReason(r?.status));
  } catch (e) {
    return { granted: false, reason: 'error', error: errMessage(e) };
  }
}

/* ── Camera (OCR document capture) ────────────────────────────────────────── */

export function requestCameraPermission(): Promise<JrxPermissionResult> {
  return runPermissionFlow('expo-camera', () => {
    const cam = require('expo-camera') as {
      Camera?: { requestCameraPermissionsAsync?: ExpoPermissionFn };
      requestCameraPermissionsAsync?: ExpoPermissionFn;
    };
    return cam.Camera?.requestCameraPermissionsAsync ?? cam.requestCameraPermissionsAsync ?? null;
  });
}

/* ── Microphone (voice in / Sarvam transcribe) ────────────────────────────── */

export function requestMicrophonePermission(): Promise<JrxPermissionResult> {
  return runPermissionFlow('expo-av', () => {
    const av = require('expo-av') as {
      Audio?: { requestPermissionsAsync?: ExpoPermissionFn };
      requestPermissionsAsync?: ExpoPermissionFn;
    };
    return av.Audio?.requestPermissionsAsync ?? av.requestPermissionsAsync ?? null;
  });
}

/* ── Photo library (alternative to camera capture) ────────────────────────── */

export function requestMediaLibraryPermission(): Promise<JrxPermissionResult> {
  return runPermissionFlow('expo-image-picker', () => {
    const ip = require('expo-image-picker') as {
      requestMediaLibraryPermissionsAsync?: ExpoPermissionFn;
    };
    return ip.requestMediaLibraryPermissionsAsync ?? null;
  });
}

/* ── Push notifications (HITL responses) ──────────────────────────────────── */

export function requestPushNotificationPermission(): Promise<JrxPermissionResult> {
  return runPermissionFlow(
    'expo-notifications',
    () => {
      const n = require('expo-notifications') as {
        requestPermissionsAsync?: ExpoPermissionFn;
      };
      return n.requestPermissionsAsync ?? null;
    },
    { ios: { allowAlert: true, allowBadge: true, allowSound: true } },
  );
}

/** Convenience — request the four permissions an SDK consumer typically needs. */
export async function requestStandardSdkPermissions(): Promise<{
  camera: JrxPermissionResult;
  microphone: JrxPermissionResult;
  mediaLibrary: JrxPermissionResult;
  push: JrxPermissionResult;
}> {
  const [camera, microphone, mediaLibrary, push] = await Promise.all([
    requestCameraPermission(),
    requestMicrophonePermission(),
    requestMediaLibraryPermission(),
    requestPushNotificationPermission(),
  ]);
  return { camera, microphone, mediaLibrary, push };
}
