/**
 * Indic-language helpers for the Jurexio Citizen SDK.
 *
 * Three jobs:
 *   1. Detect the language of a free-text input from one of the 9 supported
 *      Indic scripts + English. Heuristic — uses Unicode block ranges.
 *   2. Provide canonical English / native names + the right BCP-47 locale
 *      tag for system text-to-speech / speech-to-text.
 *   3. Provide a small library of UI strings that all NYM consumer apps
 *      need ("Send", "Loading", "Error", ...) so a fresh consumer app does
 *      not have to ship its own translation table on day one.
 */

import type { Jurexio CitizenLanguage } from './types.js';

export interface Jurexio CitizenLanguageInfo {
  code: Jurexio CitizenLanguage;
  /** Self-name in the script (eg "हिन्दी" for Hindi). */
  nativeName: string;
  englishName: string;
  /** BCP-47 locale used by Sarvam / system STT-TTS. */
  locale: string;
  /** ISO-15924 script code. */
  script: 'Latn' | 'Deva' | 'Beng' | 'Taml' | 'Telu' | 'Gujr' | 'Knda' | 'Mlym' | 'Arab';
  /** Right-to-left? Only Urdu among NYM's languages. */
  rtl: boolean;
}

export const NYAYAMITRA_LANGUAGES: Record<Jurexio CitizenLanguage, Jurexio CitizenLanguageInfo> = {
  en: { code: 'en', nativeName: 'English',     englishName: 'English',  locale: 'en-IN', script: 'Latn', rtl: false },
  hi: { code: 'hi', nativeName: 'हिन्दी',        englishName: 'Hindi',    locale: 'hi-IN', script: 'Deva', rtl: false },
  bn: { code: 'bn', nativeName: 'বাংলা',          englishName: 'Bengali',  locale: 'bn-IN', script: 'Beng', rtl: false },
  ta: { code: 'ta', nativeName: 'தமிழ்',          englishName: 'Tamil',    locale: 'ta-IN', script: 'Taml', rtl: false },
  te: { code: 'te', nativeName: 'తెలుగు',         englishName: 'Telugu',   locale: 'te-IN', script: 'Telu', rtl: false },
  mr: { code: 'mr', nativeName: 'मराठी',          englishName: 'Marathi',  locale: 'mr-IN', script: 'Deva', rtl: false },
  gu: { code: 'gu', nativeName: 'ગુજરાતી',         englishName: 'Gujarati', locale: 'gu-IN', script: 'Gujr', rtl: false },
  kn: { code: 'kn', nativeName: 'ಕನ್ನಡ',           englishName: 'Kannada',  locale: 'kn-IN', script: 'Knda', rtl: false },
  ml: { code: 'ml', nativeName: 'മലയാളം',          englishName: 'Malayalam', locale: 'ml-IN', script: 'Mlym', rtl: false },
  ur: { code: 'ur', nativeName: 'اُردُو',            englishName: 'Urdu',     locale: 'ur-IN', script: 'Arab', rtl: true },
};

/** Convenience — array of all language infos in display order. */
export const NYAYAMITRA_LANGUAGE_LIST: Jurexio CitizenLanguageInfo[] = [
  NYAYAMITRA_LANGUAGES.en,
  NYAYAMITRA_LANGUAGES.hi,
  NYAYAMITRA_LANGUAGES.bn,
  NYAYAMITRA_LANGUAGES.ta,
  NYAYAMITRA_LANGUAGES.te,
  NYAYAMITRA_LANGUAGES.mr,
  NYAYAMITRA_LANGUAGES.gu,
  NYAYAMITRA_LANGUAGES.kn,
  NYAYAMITRA_LANGUAGES.ml,
  NYAYAMITRA_LANGUAGES.ur,
];

/**
 * Heuristic language detection — counts code-points in each script's Unicode
 * block and returns the highest-share language. Latin-only text returns 'en'.
 *
 * This is a *best-effort* router for "did the user type Hindi or Bengali?";
 * for high-stakes decisions, send the text to the gateway's `/detect-language`
 * endpoint instead.
 */
export function detectLanguage(text: string): Jurexio CitizenLanguage {
  if (!text || !text.trim()) return 'en';
  const counts: Record<Jurexio CitizenLanguage, number> = {
    en: 0, hi: 0, bn: 0, ta: 0, te: 0, mr: 0, gu: 0, kn: 0, ml: 0, ur: 0,
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0900 && cp <= 0x097F) counts.hi++;        // Devanagari (Hindi/Marathi share)
    else if (cp >= 0x0980 && cp <= 0x09FF) counts.bn++;   // Bengali
    else if (cp >= 0x0B80 && cp <= 0x0BFF) counts.ta++;   // Tamil
    else if (cp >= 0x0C00 && cp <= 0x0C7F) counts.te++;   // Telugu
    else if (cp >= 0x0A80 && cp <= 0x0AFF) counts.gu++;   // Gujarati
    else if (cp >= 0x0C80 && cp <= 0x0CFF) counts.kn++;   // Kannada
    else if (cp >= 0x0D00 && cp <= 0x0D7F) counts.ml++;   // Malayalam
    else if (cp >= 0x0600 && cp <= 0x06FF) counts.ur++;   // Arabic block (Urdu)
    else if (cp >= 0x0041 && cp <= 0x007A) counts.en++;   // Latin
  }
  // Devanagari — disambiguate Hindi vs Marathi using a tiny stop-word check.
  if (counts.hi > 0) {
    if (/\b(आहे|नाही|आम्ही|तुम्ही)\b/.test(text)) {
      counts.mr = counts.hi; counts.hi = 0;
    }
  }
  let best: Jurexio CitizenLanguage = 'en';
  let bestCount = -1;
  for (const k of Object.keys(counts) as Jurexio CitizenLanguage[]) {
    if (counts[k] > bestCount) { bestCount = counts[k]; best = k; }
  }
  return best;
}

/** Returns whether the language uses right-to-left text direction. */
export function isRTL(lang: Jurexio CitizenLanguage): boolean {
  return NYAYAMITRA_LANGUAGES[lang]?.rtl ?? false;
}

/** Returns the BCP-47 locale tag (eg "hi-IN") used by Sarvam / native TTS-STT. */
export function localeFor(lang: Jurexio CitizenLanguage): string {
  return NYAYAMITRA_LANGUAGES[lang]?.locale ?? 'en-IN';
}

/** Common UI strings used by every NYM consumer app. */
export type NymUiKey =
  | 'send' | 'cancel' | 'retry' | 'loading' | 'error'
  | 'voiceListening' | 'voiceTapToSpeak' | 'attachDocument'
  | 'savedOffline' | 'syncing' | 'offline'
  | 'disclaimerLegalNotLawyer';

export const NYAYAMITRA_UI_STRINGS: Record<NymUiKey, Record<Jurexio CitizenLanguage, string>> = {
  send: {
    en: 'Send', hi: 'भेजें', bn: 'পাঠান', ta: 'அனுப்பு', te: 'పంపు',
    mr: 'पाठवा', gu: 'મોકલો', kn: 'ಕಳುಹಿಸಿ', ml: 'അയയ്ക്കുക', ur: 'بھیجیں',
  },
  cancel: {
    en: 'Cancel', hi: 'रद्द करें', bn: 'বাতিল', ta: 'ரத்து', te: 'రద్దు',
    mr: 'रद्द करा', gu: 'રદ કરો', kn: 'ರದ್ದು', ml: 'റദ്ദാക്കുക', ur: 'منسوخ',
  },
  retry: {
    en: 'Retry', hi: 'पुनः प्रयास', bn: 'পুনরায় চেষ্টা', ta: 'மீண்டும் முயற்சிக்க', te: 'మళ్ళీ ప్రయత్నించండి',
    mr: 'पुन्हा प्रयत्न', gu: 'ફરી પ્રયાસ', kn: 'ಮರು ಪ್ರಯತ್ನಿಸಿ', ml: 'വീണ്ടും ശ്രമിക്കുക', ur: 'دوبارہ کوشش کریں',
  },
  loading: {
    en: 'Loading…', hi: 'लोड हो रहा है…', bn: 'লোড হচ্ছে…', ta: 'ஏற்றுகிறது…', te: 'లోడ్ అవుతోంది…',
    mr: 'लोड होत आहे…', gu: 'લોડ થઈ રહ્યું છે…', kn: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…', ml: 'ലോഡ് ചെയ്യുന്നു…', ur: 'لوڈ ہو رہا ہے…',
  },
  error: {
    en: 'Something went wrong', hi: 'कुछ गलत हुआ', bn: 'কিছু সমস্যা হয়েছে', ta: 'ஏதோ தவறு', te: 'ఏదో పొరపాటు జరిగింది',
    mr: 'काहीतरी चूक झाली', gu: 'કંઈક ખોટું થયું', kn: 'ಏನೋ ತಪ್ಪಾಗಿದೆ', ml: 'എന്തോ പിശക് സംഭവിച്ചു', ur: 'کچھ غلط ہو گیا',
  },
  voiceListening: {
    en: 'Listening…', hi: 'सुन रहा हूँ…', bn: 'শুনছি…', ta: 'கேட்கிறேன்…', te: 'వింటున్నాను…',
    mr: 'ऐकत आहे…', gu: 'સાંભળી રહ્યો છું…', kn: 'ಆಲಿಸುತ್ತಿದ್ದೇನೆ…', ml: 'കേൾക്കുന്നു…', ur: 'سن رہا ہوں…',
  },
  voiceTapToSpeak: {
    en: 'Tap to speak', hi: 'बोलने के लिए दबाएँ', bn: 'বলতে ট্যাপ করুন', ta: 'பேச தட்டவும்', te: 'మాట్లాడటానికి తాకండి',
    mr: 'बोलण्यासाठी टॅप करा', gu: 'બોલવા માટે ટેપ કરો', kn: 'ಮಾತನಾಡಲು ಟ್ಯಾಪ್ ಮಾಡಿ', ml: 'സംസാരിക്കാൻ ടാപ്പ് ചെയ്യുക', ur: 'بولنے کے لیے دبائیں',
  },
  attachDocument: {
    en: 'Attach document', hi: 'दस्तावेज़ संलग्न करें', bn: 'নথি যুক্ত করুন', ta: 'ஆவணம் இணை', te: 'పత్రం జతచేయండి',
    mr: 'दस्तऐवज जोडा', gu: 'દસ્તાવેજ જોડો', kn: 'ದಸ್ತಾವೇಜು ಲಗತ್ತಿಸಿ', ml: 'പ്രമാണം ചേർക്കുക', ur: 'دستاویز منسلک کریں',
  },
  savedOffline: {
    en: 'Saved offline', hi: 'ऑफ़लाइन सहेजा', bn: 'অফলাইনে সংরক্ষিত', ta: 'ஆஃப்லைனில் சேமிக்கப்பட்டது', te: 'ఆఫ్‌లైన్‌లో సేవ్ చేయబడింది',
    mr: 'ऑफलाइन जतन केले', gu: 'ઑફલાઇન સાચવ્યું', kn: 'ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ', ml: 'ഓഫ്‌ലൈനായി സംരക്ഷിച്ചു', ur: 'آف لائن محفوظ',
  },
  syncing: {
    en: 'Syncing…', hi: 'सिंक हो रहा है…', bn: 'সিঙ্ক হচ্ছে…', ta: 'ஒத்திசைக்கிறது…', te: 'సింక్ అవుతోంది…',
    mr: 'सिंक होत आहे…', gu: 'સિંક થઈ રહ્યું છે…', kn: 'ಸಿಂಕ್ ಆಗುತ್ತಿದೆ…', ml: 'സമന്വയിക്കുന്നു…', ur: 'سنک ہو رہا ہے…',
  },
  offline: {
    en: 'Offline', hi: 'ऑफ़लाइन', bn: 'অফলাইন', ta: 'ஆஃப்லைன்', te: 'ఆఫ్‌లైన్',
    mr: 'ऑफलाइन', gu: 'ઑફલાઇન', kn: 'ಆಫ್‌ಲೈನ್', ml: 'ഓഫ്‌ലൈൻ', ur: 'آف لائن',
  },
  disclaimerLegalNotLawyer: {
    en: 'Information only — not a substitute for a qualified lawyer.',
    hi: 'केवल जानकारी — यह वकील का विकल्प नहीं है।',
    bn: 'তথ্যমূলক — এটি যোগ্য আইনজীবীর বিকল্প নয়।',
    ta: 'தகவல் மட்டும் — தகுதிவாய்ந்த வழக்கறிஞருக்கு மாற்றாக அமைக்க முடியாது.',
    te: 'సమాచారం మాత్రమే — అర్హత గల న్యాయవాదికి ప్రత్యామ్నాయం కాదు.',
    mr: 'फक्त माहिती — पात्र वकीलाचा पर्याय नाही.',
    gu: 'માત્ર માહિતી — લાયક વકીલનો વિકલ્પ નથી.',
    kn: 'ಮಾಹಿತಿ ಮಾತ್ರ — ಅರ್ಹ ವಕೀಲರ ಬದಲಿ ಅಲ್ಲ.',
    ml: 'വിവരം മാത്രം — യോഗ്യനായ അഭിഭാഷകന് പകരമല്ല.',
    ur: 'صرف معلومات — یہ مستند وکیل کا متبادل نہیں ہے۔',
  },
};

/** Look up a UI string in the requested language, falling back to English. */
export function t(key: NymUiKey, lang: Jurexio CitizenLanguage): string {
  return NYAYAMITRA_UI_STRINGS[key]?.[lang] ?? NYAYAMITRA_UI_STRINGS[key]?.en ?? key;
}
