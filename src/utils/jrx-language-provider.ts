/**
 * NV-LANGUAGE-PROVIDER-001 — Prefer Gemini for Indic STT / translate / detect
 * until Sarvam keys are validated. Escape: JRX_LANGUAGE_PROVIDER=sarvam
 * (and JRX_SARVAM_STT_ENABLED / JRX_SARVAM_TTS_ENABLED / JRX_SARVAM_ENABLED=1).
 */
export type JrxLanguageProvider = 'gemini' | 'sarvam';

function envFlagOn(name: string): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function envFlagExplicitlyOff(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  const v = String(raw).trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

export function resolveGeminiApiKey(): string | null {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_AI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.JRX_GOOGLE_API_KEY,
    process.env.JRX_GEMINI_API_KEY,
  ];
  for (const k of keys) {
    if (k && String(k).trim()) return String(k).trim();
  }
  return null;
}

export function resolveSarvamApiKey(): string | null {
  const k = process.env.JRX_SARVAM_API_KEY || process.env.SARVAM_API_KEY;
  return k && String(k).trim() ? String(k).trim() : null;
}

/**
 * Active language stack. Default **gemini** so Legal Chat / NYM Indic work
 * without waiting on Sarvam credentials.
 */
export function getLanguageProvider(): JrxLanguageProvider {
  const forced = String(process.env.JRX_LANGUAGE_PROVIDER || '').trim().toLowerCase();
  if (forced === 'sarvam' || forced === 'gemini') return forced;

  /* Explicit Sarvam opt-in via feature flags (once keys are ready). */
  if (
    envFlagOn('JRX_SARVAM_ENABLED')
    || envFlagOn('JRX_SARVAM_STT_ENABLED')
    || envFlagOn('JRX_SARVAM_TTS_ENABLED')
  ) {
    return resolveSarvamApiKey() ? 'sarvam' : 'gemini';
  }

  return 'gemini';
}

export function isSarvamSttEnabled(): boolean {
  if (envFlagExplicitlyOff('JRX_SARVAM_STT_ENABLED') || envFlagExplicitlyOff('JRX_SARVAM_ENABLED')) {
    return false;
  }
  if (getLanguageProvider() !== 'sarvam') return false;
  return !!resolveSarvamApiKey();
}

export function isSarvamTtsEnabled(): boolean {
  if (envFlagExplicitlyOff('JRX_SARVAM_TTS_ENABLED') || envFlagExplicitlyOff('JRX_SARVAM_ENABLED')) {
    return false;
  }
  if (getLanguageProvider() !== 'sarvam') return false;
  return !!resolveSarvamApiKey();
}

export function isSarvamTranslateEnabled(): boolean {
  if (envFlagExplicitlyOff('JRX_SARVAM_ENABLED')) return false;
  if (getLanguageProvider() !== 'sarvam') return false;
  return !!resolveSarvamApiKey();
}
