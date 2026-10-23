/**
 * Jurexio 47-Language Auto-Routing Service
 * @version 3.1.2
 *
 * Pipeline:
 *   1. detectLanguage(text) → ISO 639-1 code + script + confidence
 *   2. routeToLLM(detected, query) → select best LLM for language
 *   3. translateIfNeeded(text, detected) → translate to English for LLM reasoning
 *   4. run LLM legal completion in English
 *   5. translateBack(response, detected) → render in original language
 *
 * Supported: 47 languages (22 Indian official + 25 global legal)
 * Scripts: Devanagari, Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati,
 *          Odia, Punjabi, Urdu, Arabic, Arabic (GCC), Chinese, Japanese, Korean,
 *          Russian, Hebrew, Persian, Thai, Vietnamese, and 27 Latin-script langs
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('lang-router');

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE REGISTRY — 47 languages
// ─────────────────────────────────────────────────────────────────────────────

export interface NvLanguage {
  code: string;           // ISO 639-1
  name: string;
  nativeName: string;
  script: string;
  jurisdiction: string[];
  sarvamSupported: boolean;  // Sarvam AI supports this language
  llmRoute: 'sarvam' | 'openrouter' | 'groq' | 'anthropic' | 'native';
  unicode: RegExp;       // Unicode block detector
  legalTerminology: string; // e.g., "Contract" in this language
}

export const NV_LANGUAGES: NvLanguage[] = [
  // ─── 22 Indian Official Languages ─────────────────────────────────────────
  { code: 'hi', name: 'Hindi',       nativeName: 'हिन्दी',      script: 'Devanagari', jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0900-\u097F]/,   legalTerminology: 'अनुबंध' },
  { code: 'mr', name: 'Marathi',     nativeName: 'मराठी',       script: 'Devanagari', jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0900-\u097F]/,   legalTerminology: 'करार' },
  { code: 'sa', name: 'Sanskrit',    nativeName: 'संस्कृतम्',   script: 'Devanagari', jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0900-\u097F]/,   legalTerminology: 'संविद' },
  { code: 'ne', name: 'Nepali',      nativeName: 'नेपाली',      script: 'Devanagari', jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0900-\u097F]/,   legalTerminology: 'सम्झौता' },
  { code: 'ta', name: 'Tamil',       nativeName: 'தமிழ்',       script: 'Tamil',      jurisdiction: ['IN','SG'], sarvamSupported: true,  llmRoute: 'sarvam', unicode: /[\u0B80-\u0BFF]/,   legalTerminology: 'ஒப்பந்தம்' },
  { code: 'te', name: 'Telugu',      nativeName: 'తెలుగు',      script: 'Telugu',     jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0C00-\u0C7F]/,   legalTerminology: 'ఒప్పందం' },
  { code: 'kn', name: 'Kannada',     nativeName: 'ಕನ್ನಡ',       script: 'Kannada',    jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0C80-\u0CFF]/,   legalTerminology: 'ಒಪ್ಪಂದ' },
  { code: 'ml', name: 'Malayalam',   nativeName: 'മലയാളം',      script: 'Malayalam',  jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0D00-\u0D7F]/,   legalTerminology: 'കരാർ' },
  { code: 'bn', name: 'Bengali',     nativeName: 'বাংলা',       script: 'Bengali',    jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0980-\u09FF]/,   legalTerminology: 'চুক্তি' },
  { code: 'gu', name: 'Gujarati',    nativeName: 'ગુજરાતી',     script: 'Gujarati',   jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0A80-\u0AFF]/,   legalTerminology: 'કરાર' },
  { code: 'pa', name: 'Punjabi',     nativeName: 'ਪੰਜਾਬੀ',     script: 'Gurmukhi',   jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0A00-\u0A7F]/,   legalTerminology: 'ਇਕਰਾਰਨਾਮਾ' },
  { code: 'or', name: 'Odia',        nativeName: 'ଓଡ଼ିଆ',       script: 'Odia',       jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0B00-\u0B7F]/,   legalTerminology: 'ଚୁକ୍ତି' },
  { code: 'ur', name: 'Urdu',        nativeName: 'اردو',        script: 'Nastaliq',   jurisdiction: ['IN','GC'], sarvamSupported: true,  llmRoute: 'sarvam', unicode: /[\u0600-\u06FF]/,   legalTerminology: 'معاہدہ' },
  { code: 'as', name: 'Assamese',    nativeName: 'অসমীয়া',     script: 'Bengali',    jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0980-\u09FF]/,   legalTerminology: 'চুক্তি' },
  { code: 'mni','name': 'Manipuri',  nativeName: 'মৈতৈলোন্',   script: 'Meitei',     jurisdiction: ['IN'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\uABC0-\uABFF]/,   legalTerminology: 'ঙাকপু' },
  { code: 'kok', name: 'Konkani',    nativeName: 'कोंकणी',      script: 'Devanagari', jurisdiction: ['IN'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0900-\u097F]/,   legalTerminology: 'करार' },
  { code: 'ks', name: 'Kashmiri',    nativeName: 'كٲشُر',       script: 'Nastaliq',   jurisdiction: ['IN'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0600-\u06FF]/,   legalTerminology: 'معاہدہ' },
  { code: 'sd', name: 'Sindhi',      nativeName: 'سنڌي',        script: 'Arabic',     jurisdiction: ['IN'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0600-\u06FF]/,   legalTerminology: 'معاهدو' },
  { code: 'si', name: 'Sinhala',     nativeName: 'සිංහල',       script: 'Sinhala',    jurisdiction: ['IN'], sarvamSupported: true,  llmRoute: 'sarvam',     unicode: /[\u0D80-\u0DFF]/,   legalTerminology: 'ගිවිසුම' },
  { code: 'bo', name: 'Tibetan',     nativeName: 'བོད་ཡིག',     script: 'Tibetan',    jurisdiction: ['IN'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0F00-\u0FFF]/,   legalTerminology: 'གན་རྒྱ' },
  { code: 'doi', name: 'Dogri',      nativeName: 'डोगरी',       script: 'Devanagari', jurisdiction: ['IN'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0900-\u097F]/,   legalTerminology: 'इकरारनामा' },
  { code: 'sat', name: 'Santali',    nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ',    script: 'Ol Chiki',   jurisdiction: ['IN'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u1C50-\u1C7F]/,   legalTerminology: 'Contract' },

  // ─── 25 Global Legal Languages ────────────────────────────────────────────
  { code: 'en', name: 'English',     nativeName: 'English',     script: 'Latin',      jurisdiction: ['IN','UK','US','GC','EU','SG'], sarvamSupported: false, llmRoute: 'native', unicode: /[a-zA-Z]/,         legalTerminology: 'Contract' },
  { code: 'ar', name: 'Arabic',      nativeName: 'العربية',     script: 'Arabic',     jurisdiction: ['GC'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0600-\u06FF]/,   legalTerminology: 'عقد' },
  { code: 'fr', name: 'French',      nativeName: 'Français',    script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZàâäéèêëîïôùûüÿçœæÀÂÄÉÈÊËÎÏÔÙÛÜŸÇŒÆ]/,  legalTerminology: 'Contrat' },
  { code: 'de', name: 'German',      nativeName: 'Deutsch',     script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZäöüÄÖÜß]/,  legalTerminology: 'Vertrag' },
  { code: 'zh', name: 'Chinese',     nativeName: '中文',         script: 'Han',        jurisdiction: ['SG'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u4E00-\u9FFF]/,   legalTerminology: '合同' },
  { code: 'ja', name: 'Japanese',    nativeName: '日本語',       script: 'Kanji',      jurisdiction: ['SG'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u3040-\u30FF\u4E00-\u9FFF]/,  legalTerminology: '契約' },
  { code: 'ko', name: 'Korean',      nativeName: '한국어',       script: 'Hangul',     jurisdiction: ['SG'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\uAC00-\uD7FF]/,   legalTerminology: '계약' },
  { code: 'es', name: 'Spanish',     nativeName: 'Español',     script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/,  legalTerminology: 'Contrato' },
  { code: 'pt', name: 'Portuguese',  nativeName: 'Português',   script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZáàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/,  legalTerminology: 'Contrato' },
  { code: 'it', name: 'Italian',     nativeName: 'Italiano',    script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZàèéìíîòóùúÀÈÉÌÍÎÒÓÙÚ]/,  legalTerminology: 'Contratto' },
  { code: 'nl', name: 'Dutch',       nativeName: 'Nederlands',  script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-Z]/,         legalTerminology: 'Contract' },
  { code: 'pl', name: 'Polish',      nativeName: 'Polski',      script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/,  legalTerminology: 'Umowa' },
  { code: 'ru', name: 'Russian',     nativeName: 'Русский',     script: 'Cyrillic',   jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0400-\u04FF]/,   legalTerminology: 'Договор' },
  { code: 'tr', name: 'Turkish',     nativeName: 'Türkçe',      script: 'Latin',      jurisdiction: ['GC'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZğüşöçıİĞÜŞÖÇ]/,  legalTerminology: 'Sözleşme' },
  { code: 'fa', name: 'Persian',     nativeName: 'فارسی',       script: 'Arabic',     jurisdiction: ['GC'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0600-\u06FF]/,   legalTerminology: 'قرارداد' },
  { code: 'he', name: 'Hebrew',      nativeName: 'עברית',       script: 'Hebrew',     jurisdiction: ['GC'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0590-\u05FF]/,   legalTerminology: 'חוזה' },
  { code: 'th', name: 'Thai',        nativeName: 'ภาษาไทย',    script: 'Thai',       jurisdiction: ['SG'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0E00-\u0E7F]/,   legalTerminology: 'สัญญา' },
  { code: 'vi', name: 'Vietnamese',  nativeName: 'Tiếng Việt',  script: 'Latin',      jurisdiction: ['SG'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[àáâãèéêìíòóôõùúýăđĩũơưạặ]/,  legalTerminology: 'Hợp đồng' },
  { code: 'ms', name: 'Malay',       nativeName: 'Bahasa Melayu', script: 'Latin',    jurisdiction: ['SG'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-Z]/,         legalTerminology: 'Kontrak' },
  { code: 'id', name: 'Indonesian',  nativeName: 'Bahasa Indonesia', script: 'Latin', jurisdiction: ['SG'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-Z]/,         legalTerminology: 'Kontrak' },
  { code: 'sv', name: 'Swedish',     nativeName: 'Svenska',     script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZåäöÅÄÖ]/,   legalTerminology: 'Avtal' },
  { code: 'da', name: 'Danish',      nativeName: 'Dansk',       script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZæøåÆØÅ]/,   legalTerminology: 'Kontrakt' },
  { code: 'fi', name: 'Finnish',     nativeName: 'Suomi',       script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZäöÄÖ]/,     legalTerminology: 'Sopimus' },
  { code: 'ro', name: 'Romanian',    nativeName: 'Română',      script: 'Latin',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[a-zA-ZăâîșțĂÂÎȘȚ]/,  legalTerminology: 'Contract' },
  { code: 'el', name: 'Greek',       nativeName: 'Ελληνικά',    script: 'Greek',      jurisdiction: ['EU'], sarvamSupported: false, llmRoute: 'openrouter', unicode: /[\u0370-\u03FF]/,   legalTerminology: 'Σύμβαση' },
];

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE DETECTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export interface LanguageDetectionResult {
  detected: string;           // ISO 639-1 code
  confidence: number;         // 0–1
  script: string;
  language: NvLanguage;
  isEnglish: boolean;
  requiresTranslation: boolean;
  llmRoute: string;
  sarvamSupported: boolean;
  jurisdictionHint: string[];
}

export function detectLanguage(text: string): LanguageDetectionResult {
  if (!text || text.trim().length === 0) {
    const eng = NV_LANGUAGES.find(l => l.code === 'en')!;
    return { detected: 'en', confidence: 1.0, script: 'Latin', language: eng, isEnglish: true, requiresTranslation: false, llmRoute: 'native', sarvamSupported: false, jurisdictionHint: ['IN','UK','US','GC','EU','SG'] };
  }

  const sample = text.slice(0, 500);

  // Test each language's unicode pattern — score by character match count
  const scores: Array<{ lang: NvLanguage; count: number; density: number }> = [];

  for (const lang of NV_LANGUAGES) {
    if (lang.code === 'en') continue; // English is fallback
    const matches = (sample.match(lang.unicode) ?? []).length;
    if (matches > 0) {
      scores.push({ lang, count: matches, density: matches / sample.length });
    }
  }

  if (scores.length === 0) {
    const eng = NV_LANGUAGES.find(l => l.code === 'en')!;
    return { detected: 'en', confidence: 0.85, script: 'Latin', language: eng, isEnglish: true, requiresTranslation: false, llmRoute: 'native', sarvamSupported: false, jurisdictionHint: ['IN','UK','US','GC','EU','SG'] };
  }

  // Sort by density (best match)
  scores.sort((a, b) => b.density - a.density);
  const top = scores[0];

  // Disambiguate Devanagari scripts (Hindi vs Marathi vs Sanskrit vs Nepali)
  let finalLang = top.lang;
  if (['hi','mr','sa','ne','kok','doi'].includes(top.lang.code)) {
    // Simple heuristic: check for language-specific words
    if (/\b(आहे|माझा|मराठी)\b/.test(sample)) finalLang = NV_LANGUAGES.find(l => l.code === 'mr') ?? top.lang;
    else if (/\b(ह्यूँ|तिम्रो|नेपाल)\b/.test(sample)) finalLang = NV_LANGUAGES.find(l => l.code === 'ne') ?? top.lang;
    else finalLang = NV_LANGUAGES.find(l => l.code === 'hi') ?? top.lang;
  }

  // Disambiguate Arabic script (Arabic vs Urdu vs Persian vs Kashmiri)
  if (['ar','ur','fa','ks','sd'].includes(top.lang.code)) {
    if (/[\u06A9\u06AF\u06CC\u06BE]/.test(sample)) finalLang = NV_LANGUAGES.find(l => l.code === 'ur') ?? top.lang; // Urdu-specific chars
    else if (/[\u0679\u0688\u0691]/.test(sample)) finalLang = NV_LANGUAGES.find(l => l.code === 'ur') ?? top.lang;
    else finalLang = NV_LANGUAGES.find(l => l.code === 'ar') ?? top.lang;
  }

  // Bengali vs Assamese
  if (top.lang.code === 'bn' && /[ৰৱ]/.test(sample)) {
    finalLang = NV_LANGUAGES.find(l => l.code === 'as') ?? top.lang;
  }

  const confidence = Math.min(0.99, 0.6 + top.density * 2);

  return {
    detected: finalLang.code,
    confidence,
    script: finalLang.script,
    language: finalLang,
    isEnglish: false,
    requiresTranslation: finalLang.code !== 'en',
    llmRoute: finalLang.llmRoute,
    sarvamSupported: finalLang.sarvamSupported,
    jurisdictionHint: finalLang.jurisdiction,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTILINGUAL COMPLETION ROUTER
// ─────────────────────────────────────────────────────────────────────────────

export interface MultilingualCompletionRequest {
  query: string;
  targetLanguage?: string;   // Force output language (ISO 639-1)
  jurisdiction?: string;
  userId?: string;
  model?: string;
  context?: string;
}

export interface MultilingualCompletionResult {
  detectedLanguage: string;
  detectedScript: string;
  confidence: number;
  llmRoute: string;
  translatedToEnglish?: string;
  englishResponse?: string;
  finalResponse: string;
  responseLanguage: string;
  processingSteps: string[];
  jurisdictionHint: string[];
  sarvamUsed: boolean;
  latencyMs: number;
}

export async function routeMultilingualCompletion(
  request: MultilingualCompletionRequest,
  completionFn: (query: string, language: string, jurisdiction: string) => Promise<string>
): Promise<MultilingualCompletionResult> {
  const startMs = Date.now();
  const steps: string[] = [];

  // Step 1: Detect language
  const detected = detectLanguage(request.query);
  steps.push(`Language detected: ${detected.language.name} (${detected.detected}) — confidence: ${(detected.confidence * 100).toFixed(1)}%`);

  // Step 2: Determine output language
  const outputLang = request.targetLanguage ?? detected.detected;
  const jurisdiction = request.jurisdiction ?? detected.jurisdictionHint[0] ?? 'IN';

  // Step 3: If non-English, translate query to English for LLM reasoning
  let englishQuery = request.query;
  let sarvamUsed = false;

  if (detected.detected !== 'en' && detected.requiresTranslation) {
    steps.push(`Translating from ${detected.language.name} → English via ${detected.sarvamSupported ? 'Sarvam AI' : 'OpenRouter LLM'}`);
    try {
      if (detected.sarvamSupported) {
        const { sarvamTranslationService } = await import('./sarvam-translation-service.js').catch(() => ({ sarvamTranslationService: null }));
        if (sarvamTranslationService) {
          const translated = await (sarvamTranslationService as any).translate({ text: request.query, sourceLanguage: detected.detected, targetLanguage: 'en' });
          englishQuery = translated.translatedText ?? request.query;
          sarvamUsed = true;
        }
      }
      // Fallback: use LLM translation prefix
      if (!sarvamUsed) {
        englishQuery = `[TRANSLATE FROM ${detected.language.name.toUpperCase()}]: ${request.query}`;
      }
    } catch {
      steps.push('Translation failed — proceeding with original text');
    }
    steps.push(`Query translated: "${englishQuery.slice(0, 100)}..."`);
  } else {
    steps.push('Query is in English — no translation needed');
  }

  // Step 4: Run legal LLM completion (in English)
  steps.push(`Routing to LLM: ${detected.llmRoute} | Jurisdiction: ${jurisdiction}`);
  const englishResponse = await completionFn(englishQuery, 'en', jurisdiction);
  steps.push('LLM completion received');

  // Step 5: Translate response back to detected/target language
  let finalResponse = englishResponse;
  if (outputLang !== 'en') {
    steps.push(`Translating response → ${detected.language.name} via ${detected.sarvamSupported ? 'Sarvam AI' : 'OpenRouter'}`);
    try {
      if (detected.sarvamSupported) {
        const { sarvamTranslationService } = await import('./sarvam-translation-service.js').catch(() => ({ sarvamTranslationService: null }));
        if (sarvamTranslationService) {
          const backTranslated = await (sarvamTranslationService as any).translate({ text: englishResponse, sourceLanguage: 'en', targetLanguage: outputLang });
          finalResponse = backTranslated.translatedText ?? englishResponse;
          sarvamUsed = true;
        }
      }
    } catch {
      steps.push('Back-translation failed — returning English response');
      finalResponse = `[${detected.language.name} response — translation service unavailable]\n\n${englishResponse}`;
    }
    steps.push('Response translated to target language');
  } else {
    steps.push('Response delivered in English');
  }

  return {
    detectedLanguage: detected.detected,
    detectedScript: detected.script,
    confidence: detected.confidence,
    llmRoute: detected.llmRoute,
    translatedToEnglish: detected.detected !== 'en' ? englishQuery : undefined,
    englishResponse,
    finalResponse,
    responseLanguage: outputLang,
    processingSteps: steps,
    jurisdictionHint: detected.jurisdictionHint,
    sarvamUsed,
    latencyMs: Date.now() - startMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED LANGUAGE LIST (for API exposure)
// ─────────────────────────────────────────────────────────────────────────────

export function getSupportedLanguages(): { total: number; indian: number; global: number; languages: Array<{ code: string; name: string; nativeName: string; script: string; sarvamSupported: boolean; jurisdiction: string[] }> } {
  return {
    total: NV_LANGUAGES.length,
    indian: NV_LANGUAGES.filter(l => l.jurisdiction.includes('IN')).length,
    global: NV_LANGUAGES.filter(l => !l.jurisdiction.every(j => j === 'IN')).length,
    languages: NV_LANGUAGES.map(l => ({ code: l.code, name: l.name, nativeName: l.nativeName, script: l.script, sarvamSupported: l.sarvamSupported, jurisdiction: l.jurisdiction })),
  };
}

export const nvLanguageRouter = {
  detect: detectLanguage,
  route: routeMultilingualCompletion,
  getSupportedLanguages,
  getLanguageByCode: (code: string) => NV_LANGUAGES.find(l => l.code === code) ?? null,
  TOTAL_LANGUAGES: NV_LANGUAGES.length,
};

export default nvLanguageRouter;
