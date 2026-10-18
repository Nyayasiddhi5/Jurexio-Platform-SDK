import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import { getGeminiLanguageModel, toGeminiApiModelId } from '../config/jrx-gemini-models.js';
import {
  isSarvamTranslateEnabled,
  resolveGeminiApiKey,
} from '../utils/jrx-language-provider.js';


const logger = createLogger('sarvam-translation-service');

export interface SarvamLanguageInfo {
  code: string;
  sarvamCode: string;
  name: string;
  nativeName: string;
  script: string;
  rtl: boolean;
}

export interface TranslateRequest {
  input: string;
  source_language_code: string;
  target_language_code: string;
  model?: string;
  output_script?: string;
  numerals_format?: 'international' | 'native';
  speaker_gender?: 'male' | 'female' | 'neutral';
  mode?: 'formal' | 'informal' | 'classic-colloquial';
  enable_preprocessing?: boolean;
}

export interface TranslateResponse {
  translated_text: string;
  source_language_code: string;
  target_language_code: string;
}

export interface TransliterateRequest {
  input: string;
  source_language_code: string;
  target_language_code: string;
  numerals_format?: 'international' | 'native';
}

export interface TransliterateResponse {
  transliterated_text: string;
}

export interface SpeechToTextRequest {
  file: Uint8Array;
  fileName: string;
  model?: string;
  mode?: 'transcribe' | 'translate' | 'verbatim' | 'translit' | 'codemix';
  language_code: string;
}

export interface SpeechToTextResponse {
  transcript: string;
  language_code: string;
}

export interface TextToSpeechRequest {
  inputs: string[];
  target_language_code: string;
  speaker?: string;
  model?: string;
  enable_preprocessing?: boolean;
}

export interface TextToSpeechResponse {
  audios: string[];
}

export interface LanguageDetectionRequest {
  input: string;
}

export interface LanguageDetectionResponse {
  language_code: string;
  confidence: number;
  script: string;
}

export interface DocumentTranslationRequest {
  file: Uint8Array;
  fileName: string;
  page_number: number;
  input_lang: string;
  output_lang: string;
}

export interface DocumentTranslationResponse {
  translated_content: string;
  page_number: number;
}

export interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain?: 'general' | 'legal' | 'technical' | 'business' | 'creative';
  cacheEnabled?: boolean;
  mode?: 'formal' | 'informal' | 'classic-colloquial';
  speakerGender?: 'male' | 'female' | 'neutral';
  numeralsFormat?: 'international' | 'native';
  enablePreprocessing?: boolean;
}

export interface TranslationResponse {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number;
  provider: 'sarvam' | 'gemini' | 'fallback';
  cached: boolean;
  processingTime: number;
  metadata: {
    domain: string;
    qualityScore: number;
    model: string;
    alternativeTranslations?: string[];
  };
}

export interface BatchTranslationRequest {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
  domain?: string;
}

export interface ServiceStatistics {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
  errors: number;
  avgLatencyMs: number;
  totalLatencyMs: number;
  supportedLanguages: number;
  apiKeyConfigured: boolean;
  rateLimitState: {
    translateRemaining: number;
    otherRemaining: number;
  };
  uptime: number;
}

interface CacheEntry {
  value: string;
  timestamp: number;
  hits: number;
  accessedAt: number;
}

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number;
}

const SUPPORTED_LANGUAGES: SarvamLanguageInfo[] = [
  { code: 'en', sarvamCode: 'en-IN', name: 'English', nativeName: 'English', script: 'Latin', rtl: false },
  { code: 'hi', sarvamCode: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari', rtl: false },
  { code: 'bn', sarvamCode: 'bn-IN', name: 'Bengali', nativeName: 'বাংলা', script: 'Bengali', rtl: false },
  { code: 'te', sarvamCode: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu', rtl: false },
  { code: 'mr', sarvamCode: 'mr-IN', name: 'Marathi', nativeName: 'मराठी', script: 'Devanagari', rtl: false },
  { code: 'ta', sarvamCode: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil', rtl: false },
  { code: 'gu', sarvamCode: 'gu-IN', name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati', rtl: false },
  { code: 'ur', sarvamCode: 'ur-IN', name: 'Urdu', nativeName: 'اردو', script: 'Nastaliq', rtl: true },
  { code: 'kn', sarvamCode: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada', rtl: false },
  { code: 'or', sarvamCode: 'or-IN', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'Odia', rtl: false },
  { code: 'ml', sarvamCode: 'ml-IN', name: 'Malayalam', nativeName: 'മലയാളം', script: 'Malayalam', rtl: false },
  { code: 'pa', sarvamCode: 'pa-IN', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', rtl: false },
  { code: 'as', sarvamCode: 'as-IN', name: 'Assamese', nativeName: 'অসমীয়া', script: 'Bengali', rtl: false },
  { code: 'mai', sarvamCode: 'mai-IN', name: 'Maithili', nativeName: 'मैथिली', script: 'Devanagari', rtl: false },
  { code: 'sa', sarvamCode: 'sa-IN', name: 'Sanskrit', nativeName: 'संस्कृतम्', script: 'Devanagari', rtl: false },
  { code: 'kok', sarvamCode: 'kok-IN', name: 'Konkani', nativeName: 'कोंकणी', script: 'Devanagari', rtl: false },
  { code: 'ne', sarvamCode: 'ne-IN', name: 'Nepali', nativeName: 'नेपाली', script: 'Devanagari', rtl: false },
  { code: 'sd', sarvamCode: 'sd-IN', name: 'Sindhi', nativeName: 'سنڌي', script: 'Arabic', rtl: true },
  { code: 'doi', sarvamCode: 'doi-IN', name: 'Dogri', nativeName: 'डोगरी', script: 'Devanagari', rtl: false },
  { code: 'mni', sarvamCode: 'mni-IN', name: 'Manipuri', nativeName: 'মৈতৈলোন্', script: 'Meitei', rtl: false },
  { code: 'brx', sarvamCode: 'brx-IN', name: 'Bodo', nativeName: 'बड़ो', script: 'Devanagari', rtl: false },
  { code: 'sat', sarvamCode: 'sat-IN', name: 'Santali', nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ', script: 'Ol Chiki', rtl: false },
  { code: 'ks', sarvamCode: 'ks-IN', name: 'Kashmiri', nativeName: 'कॉशुर', script: 'Arabic', rtl: true },
];

const LANGUAGE_CODE_MAP: Record<string, string> = {};
const REVERSE_LANGUAGE_MAP: Record<string, string> = {};
for (const lang of SUPPORTED_LANGUAGES) {
  LANGUAGE_CODE_MAP[lang.code] = lang.sarvamCode;
  REVERSE_LANGUAGE_MAP[lang.sarvamCode] = lang.code;
}

const LEGAL_SEED_TRANSLATIONS: Record<string, Record<string, string>> = {
  'court': {
    en: 'Court', hi: 'न्यायालय', bn: 'আদালত', te: 'న్యాయస్థానం', mr: 'न्यायालय',
    ta: 'நீதிமன்றம்', gu: 'અદાલત', ur: 'عدالت', kn: 'ನ್ಯಾಯಾಲಯ', or: 'ନ୍ୟାୟାଳୟ',
    ml: 'കോടതി', pa: 'ਅਦਾਲਤ', as: 'আদালত', mai: 'न्यायालय', sa: 'न्यायालयम्',
    kok: 'न्यायालय', ne: 'अदालत', sd: 'عدالت', doi: 'अदालत', mni: 'কোর্ট',
    brx: 'न्यायालय', sat: 'ᱟᱫᱟᱞᱚᱛ', ks: 'عدالت',
  },
  'judgment': {
    en: 'Judgment', hi: 'निर्णय', bn: 'রায়', te: 'తీర్పు', mr: 'निकाल',
    ta: 'தீர்ப்பு', gu: 'ચુકાદો', ur: 'فیصلہ', kn: 'ತೀರ್ಪು', or: 'ରାୟ',
    ml: 'വിധി', pa: 'ਫੈਸਲਾ', as: 'ৰায়', mai: 'निर्णय', sa: 'निर्णयः',
    kok: 'निवाडो', ne: 'फैसला', sd: 'فيصلو', doi: 'फैसला', mni: 'ৱাফম',
    brx: 'रायजों', sat: 'ᱱᱤᱨᱱᱚᱭ', ks: 'فیصلہ',
  },
  'petition': {
    en: 'Petition', hi: 'याचिका', bn: 'আবেদন', te: 'పిటిషన్', mr: 'याचिका',
    ta: 'மனு', gu: 'અરજી', ur: 'درخواست', kn: 'ಅರ್ಜಿ', or: 'ଆବେଦନ',
    ml: 'ഹർജി', pa: 'ਪਟੀਸ਼ਨ', as: 'আবেদন', mai: 'याचिका', sa: 'निवेदनम्',
    kok: 'अर्ज', ne: 'निवेदन', sd: 'درخواست', doi: 'अर्जी', mni: 'আবেদন',
    brx: 'बिनायथि', sat: 'ᱟᱨᱡᱤ', ks: 'درخواست',
  },
  'advocate': {
    en: 'Advocate', hi: 'अधिवक्ता', bn: 'আইনজীবী', te: 'న్యాయవాది', mr: 'वकील',
    ta: 'வழக்கறிஞர்', gu: 'વકીલ', ur: 'وکیل', kn: 'ವಕೀಲ', or: 'ଓକିଲ',
    ml: 'അഭിഭാഷകന്‍', pa: 'ਵਕੀਲ', as: 'অধিবক্তা', mai: 'अधिवक्ता', sa: 'अधिवक्ता',
    kok: 'वकील', ne: 'वकिल', sd: 'وڪيل', doi: 'वकील', mni: 'উকিল',
    brx: 'अधिबक्ता', sat: 'ᱣᱟᱠᱤᱞ', ks: 'وکیل',
  },
  'evidence': {
    en: 'Evidence', hi: 'साक्ष्य', bn: 'প্রমাণ', te: 'సాక్ష్యం', mr: 'पुरावा',
    ta: 'சாட்சியம்', gu: 'પુરાવો', ur: 'ثبوت', kn: 'ಸಾಕ್ಷ್ಯ', or: 'ପ୍ରମାଣ',
    ml: 'തെളിവ്', pa: 'ਸਬੂਤ', as: 'প্ৰমাণ', mai: 'प्रमाण', sa: 'प्रमाणम्',
    kok: 'पुरावो', ne: 'प्रमाण', sd: 'ثبوت', doi: 'सबूत', mni: 'প্ৰমান',
    brx: 'प्रमाण', sat: 'ᱥᱟᱠᱷᱤ', ks: 'ثبوت',
  },
  'plaintiff': {
    en: 'Plaintiff', hi: 'वादी', bn: 'বাদী', te: 'వాది', mr: 'वादी',
    ta: 'வாதி', gu: 'વાદી', ur: 'مدعی', kn: 'ವಾದಿ', or: 'ବାଦୀ',
    ml: 'വാദി', pa: 'ਮੁਦਈ', as: 'বাদী', mai: 'वादी', sa: 'वादी',
    kok: 'वादी', ne: 'वादी', sd: 'مدعي', doi: 'वादी', mni: 'বাদী',
    brx: 'बादि', sat: 'ᱵᱟᱫᱤ', ks: 'مُدّعی',
  },
  'defendant': {
    en: 'Defendant', hi: 'प्रतिवादी', bn: 'বিবাদী', te: 'ప్రతివాది', mr: 'प्रतिवादी',
    ta: 'பிரதிவாதி', gu: 'પ્રતિવાદી', ur: 'مدعا علیہ', kn: 'ಪ್ರತಿವಾದಿ', or: 'ବିବାଦୀ',
    ml: 'പ്രതി', pa: 'ਮੁਦਾਲੇਹ', as: 'বিবাদী', mai: 'प्रतिवादी', sa: 'प्रतिवादी',
    kok: 'प्रतिवादी', ne: 'प्रतिवादी', sd: 'مدعا عليه', doi: 'प्रतिवादी', mni: 'বিবাদী',
    brx: 'प्रतिबादि', sat: 'ᱯᱨᱟᱛᱤᱵᱟᱫᱤ', ks: 'مُدّعا علیہ',
  },
  'bail': {
    en: 'Bail', hi: 'जमानत', bn: 'জামিন', te: 'బెయిల్', mr: 'जामीन',
    ta: 'ஜாமீன்', gu: 'જામીન', ur: 'ضمانت', kn: 'ಜಾಮೀನು', or: 'ଜାମିନ',
    ml: 'ജാമ്യം', pa: 'ਜ਼ਮਾਨਤ', as: 'জামিন', mai: 'जमानत', sa: 'प्रतिभूतिः',
    kok: 'जामीन', ne: 'जमानत', sd: 'ضمانت', doi: 'ज़मानत', mni: 'জামিন',
    brx: 'जामिन', sat: 'ᱡᱟᱢᱤᱱ', ks: 'ضمانت',
  },
  'statute': {
    en: 'Statute', hi: 'विधि', bn: 'আইন', te: 'శాసనం', mr: 'कायदा',
    ta: 'சட்டம்', gu: 'કાયદો', ur: 'قانون', kn: 'ಶಾಸನ', or: 'ଆଇନ',
    ml: 'നിയമം', pa: 'ਕਾਨੂੰਨ', as: 'আইন', mai: 'विधि', sa: 'विधिः',
    kok: 'कायदो', ne: 'ऐन', sd: 'قانون', doi: 'कानून', mni: 'আইন',
    brx: 'आइन', sat: 'ᱟᱭᱤᱱ', ks: 'قانون',
  },
  'jurisdiction': {
    en: 'Jurisdiction', hi: 'अधिकार क्षेत्र', bn: 'এখতিয়ার', te: 'అధికార పరిధి', mr: 'अधिकार क्षेत्र',
    ta: 'அதிகார எல்லை', gu: 'અધિકારક્ષેત્ર', ur: 'دائرہ اختیار', kn: 'ನ್ಯಾಯವ್ಯಾಪ್ತಿ', or: 'ଅଧିକାର କ୍ଷେତ୍ର',
    ml: 'അധികാരപരിധി', pa: 'ਅਧਿਕਾਰ ਖੇਤਰ', as: 'ক্ষেত্ৰাধিকাৰ', mai: 'अधिकार क्षेत्र', sa: 'अधिकारक्षेत्रम्',
    kok: 'अधिकारक्षेत्र', ne: 'क्षेत्राधिकार', sd: 'دائرو اختيار', doi: 'अधिकार खेत्र', mni: 'এখতিয়ার',
    brx: 'अधिकार क्षेत्र', sat: 'ᱟᱫᱷᱤᱠᱟᱨ ᱠᱷᱮᱛᱨᱚ', ks: 'دائرہ اِختیار',
  },
  'constitution': {
    en: 'Constitution', hi: 'संविधान', bn: 'সংবিধান', te: 'రాజ్యాంగం', mr: 'संविधान',
    ta: 'அரசியலமைப்பு', gu: 'બંધારણ', ur: 'آئین', kn: 'ಸಂವಿಧಾನ', or: 'ସମ୍ବିଧାନ',
    ml: 'ഭരണഘടന', pa: 'ਸੰਵਿਧਾਨ', as: 'সংবিধান', mai: 'संविधान', sa: 'संविधानम्',
    kok: 'संविधान', ne: 'संविधान', sd: 'آئين', doi: 'संविधान', mni: 'সংবিধান',
    brx: 'संबिधान', sat: 'ᱥᱚᱝᱵᱤᱫᱷᱟᱱ', ks: 'آئین',
  },
  'appeal': {
    en: 'Appeal', hi: 'अपील', bn: 'আপিল', te: 'అపీలు', mr: 'अपील',
    ta: 'மேல்முறையீடு', gu: 'અપીલ', ur: 'اپیل', kn: 'ಮೇಲ್ಮನವಿ', or: 'ଅପିଲ',
    ml: 'അപ്പീല്‍', pa: 'ਅਪੀਲ', as: 'আপীল', mai: 'अपील', sa: 'अभियाचना',
    kok: 'अपील', ne: 'पुनरावेदन', sd: 'اپيل', doi: 'अपील', mni: 'আপিল',
    brx: 'अपिल', sat: 'ᱟᱯᱤᱞ', ks: 'اپیل',
  },
  'witness': {
    en: 'Witness', hi: 'गवाह', bn: 'সাক্ষী', te: 'సాక్షి', mr: 'साक्षीदार',
    ta: 'சாட்சி', gu: 'સાક્ષી', ur: 'گواہ', kn: 'ಸಾಕ್ಷಿ', or: 'ସାକ୍ଷୀ',
    ml: 'സാക്ഷി', pa: 'ਗਵਾਹ', as: 'সাক্ষী', mai: 'गवाह', sa: 'साक्षी',
    kok: 'साक्ष', ne: 'साक्षी', sd: 'گواهه', doi: 'गवाह', mni: 'সাক্ষী',
    brx: 'साक्षि', sat: 'ᱥᱟᱠᱷᱤ', ks: 'گواہ',
  },
  'affidavit': {
    en: 'Affidavit', hi: 'शपथ पत्र', bn: 'হলফনামা', te: 'అఫిడవిట్', mr: 'शपथपत्र',
    ta: 'சத்தியப்பிரமாணம்', gu: 'સોગંદનામું', ur: 'حلف نامہ', kn: 'ಅಫಿಡವಿಟ್', or: 'ଶପଥପତ୍ର',
    ml: 'സത്യവാങ്മൂലം', pa: 'ਹਲਫ਼ਨਾਮਾ', as: 'শপতনামা', mai: 'शपथ पत्र', sa: 'शपथपत्रम्',
    kok: 'प्रतिज्ञापत्र', ne: 'शपथपत्र', sd: 'حلفنامو', doi: 'हलफनामा', mni: 'হলফনামা',
    brx: 'शपथपत्र', sat: 'ᱥᱚᱯᱚᱛ ᱯᱟᱛᱨᱚ', ks: 'حلف نامہ',
  },
  'verdict': {
    en: 'Verdict', hi: 'फैसला', bn: 'রায়', te: 'తీర్పు', mr: 'निकाल',
    ta: 'தீர்ப்பு', gu: 'ચુકાદો', ur: 'فیصلہ', kn: 'ತೀರ್ಪು', or: 'ରାୟ',
    ml: 'വിധിന്യായം', pa: 'ਫੈਸਲਾ', as: 'ৰায়দান', mai: 'फैसला', sa: 'निर्णयः',
    kok: 'निवाडो', ne: 'फैसला', sd: 'فيصلو', doi: 'फैसला', mni: 'রায়',
    brx: 'रायजों', sat: 'ᱱᱤᱨᱱᱚᱭ', ks: 'فیصلہ',
  },
};

const MAX_CACHE_SIZE = 10000;
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const BATCH_CHUNK_SIZE = 10;
const TRANSLITERATE_MAX_CHARS = 1000;

const TRANSLATE_RATE_LIMIT = 300;
const OTHER_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

export class SarvamAIService extends EventEmitter {
  private cache: Map<string, CacheEntry> = new Map();
  private cacheOrder: string[] = [];
  private cacheTTL: number;
  private apiKey: string;
  private baseURL: string = 'https://api.sarvam.ai';

  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    totalLatencyMs: 0,
    requestsByEndpoint: {} as Record<string, number>,
  };

  private translateBucket: RateLimitBucket;
  private otherBucket: RateLimitBucket;
  private startTime: number;

  private seedTranslations: Map<string, Map<string, string>> = new Map();

  constructor(options?: { cacheTTL?: number }) {
    super();
    this.cacheTTL = options?.cacheTTL ?? DEFAULT_TTL_MS;
    this.apiKey = process.env.SARVAM_API_KEY || process.env.JRX_SARVAM_API_KEY || '';
    this.startTime = Date.now();

    this.translateBucket = {
      tokens: TRANSLATE_RATE_LIMIT,
      lastRefill: Date.now(),
      maxTokens: TRANSLATE_RATE_LIMIT,
      refillRate: TRANSLATE_RATE_LIMIT,
    };

    this.otherBucket = {
      tokens: OTHER_RATE_LIMIT,
      lastRefill: Date.now(),
      maxTokens: OTHER_RATE_LIMIT,
      refillRate: OTHER_RATE_LIMIT,
    };

    this.initializeSeedTranslations();

    logger.info('[SarvamAI] Service initialized');
    logger.info(`[SarvamAI] Supported: ${SUPPORTED_LANGUAGES.length} languages (22 Indian + English)`);
    logger.info(`[SarvamAI] API Key: ${this.apiKey ? 'Configured' : 'Missing (fallback mode)'}`);
    logger.info(`[SarvamAI] Cache TTL: ${this.cacheTTL / 1000}s, Max entries: ${MAX_CACHE_SIZE}`);
  }

  /** Whether live Sarvam translate/detect should run (off by default until keys ready). */
  private sarvamLiveEnabled(): boolean {
    return isSarvamTranslateEnabled() && !!this.apiKey;
  }

  private async geminiLanguageCall(prompt: string): Promise<string> {
    const key = resolveGeminiApiKey();
    if (!key) return '';
    const model = toGeminiApiModelId(process.env.JRX_GEMINI_LANGUAGE_MODEL || getGeminiLanguageModel());
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      + `?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    });
    if (r.ok === false) {
      const errTxt = (await r.text().catch(() => '')).slice(0, 180);
      logger.warn('[GeminiLanguage] generateContent failed', { status: r.status, model, err: errTxt });
      return '';
    }
    const data = await r.json() as any;
    return String(data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '').trim();
  }

  private initializeSeedTranslations(): void {
    for (const [term, translations] of Object.entries(LEGAL_SEED_TRANSLATIONS)) {
      this.seedTranslations.set(term.toLowerCase(), new Map(Object.entries(translations)));
    }
    logger.info(`[SarvamAI] Loaded ${this.seedTranslations.size} legal seed translation keys`);
  }

  private refillBucket(bucket: RateLimitBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    if (elapsed >= RATE_WINDOW_MS) {
      bucket.tokens = bucket.maxTokens;
      bucket.lastRefill = now;
    }
  }

  private consumeToken(bucket: RateLimitBucket): boolean {
    this.refillBucket(bucket);
    if (bucket.tokens > 0) {
      bucket.tokens--;
      return true;
    }
    return false;
  }

  private getCacheKey(prefix: string, ...parts: string[]): string {
    return `${prefix}:${parts.join(':')}`;
  }

  private getFromCache(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      const idx = this.cacheOrder.indexOf(key);
      if (idx !== -1) this.cacheOrder.splice(idx, 1);
      return null;
    }
    entry.hits++;
    entry.accessedAt = Date.now();
    this.stats.cacheHits++;
    return entry.value;
  }

  private setCache(key: string, value: string): void {
    if (this.cache.has(key)) {
      this.cache.get(key)!.value = value;
      this.cache.get(key)!.timestamp = Date.now();
      return;
    }

    while (this.cacheOrder.length >= MAX_CACHE_SIZE) {
      let lruKey = this.cacheOrder[0];
      let lruAccess = this.cache.get(lruKey)?.accessedAt ?? 0;
      for (let i = 1; i < Math.min(this.cacheOrder.length, 50); i++) {
        const candidate = this.cache.get(this.cacheOrder[i]);
        if (candidate && candidate.accessedAt < lruAccess) {
          lruKey = this.cacheOrder[i];
          lruAccess = candidate.accessedAt;
        }
      }
      this.cache.delete(lruKey);
      const idx = this.cacheOrder.indexOf(lruKey);
      if (idx !== -1) this.cacheOrder.splice(idx, 1);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0,
      accessedAt: Date.now(),
    });
    this.cacheOrder.push(key);
  }

  private toSarvamCode(code: string): string {
    if (code.includes('-')) return code;
    return LANGUAGE_CODE_MAP[code] || code;
  }

  private fromSarvamCode(code: string): string {
    return REVERSE_LANGUAGE_MAP[code] || code;
  }

  isLanguageSupported(code: string): boolean {
    const normalized = code.includes('-') ? this.fromSarvamCode(code) : code;
    return SUPPORTED_LANGUAGES.some(l => l.code === normalized);
  }

  getLanguageInfo(code: string): SarvamLanguageInfo | undefined {
    const normalized = code.includes('-') ? this.fromSarvamCode(code) : code;
    return SUPPORTED_LANGUAGES.find(l => l.code === normalized);
  }

  getSupportedLanguages(): SarvamLanguageInfo[] {
    return [...SUPPORTED_LANGUAGES];
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    bucket: RateLimitBucket,
    endpointName: string
  ): Promise<Response> {
    this.stats.totalRequests++;
    this.stats.requestsByEndpoint[endpointName] = (this.stats.requestsByEndpoint[endpointName] || 0) + 1;

    if (!this.consumeToken(bucket)) {
      const err = new Error(`[SarvamAI] Rate limit exceeded for ${endpointName}`);
      this.stats.errors++;
      this.emit('rateLimitExceeded', { endpoint: endpointName });
      throw err;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const start = Date.now();
      try {
        const response = await fetch(url, options);
        const latency = Date.now() - start;
        this.stats.totalLatencyMs += latency;
        this.emit('request', { endpoint: endpointName, latency, status: response.status, attempt });

        if (response.ok) {
          return response;
        }

        if (response.status === 429) {
          bucket.tokens = 0;
          if (attempt < MAX_RETRIES) {
            await this.delay(RETRY_DELAYS_MS[attempt] || 4000);
            continue;
          }
        }

        if (response.status >= 500 && attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAYS_MS[attempt] || 4000);
          continue;
        }

        const errorBody = await response.text().catch(() => '');
        throw new Error(`Sarvam API ${endpointName} error: ${response.status} ${response.statusText} ${errorBody}`);
      } catch (error: any) {
        lastError = error;
        const latency = Date.now() - start;
        this.stats.totalLatencyMs += latency;

        if (error.message?.includes('Sarvam API')) {
          throw error;
        }

        if (attempt < MAX_RETRIES) {
          this.emit('retry', { endpoint: endpointName, attempt: attempt + 1, error: error.message });
          await this.delay(RETRY_DELAYS_MS[attempt] || 4000);
        }
      }
    }

    this.stats.errors++;
    this.emit('error', { endpoint: endpointName, error: lastError?.message });
    throw lastError || new Error(`[SarvamAI] ${endpointName} failed after ${MAX_RETRIES} retries`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'api-subscription-key': this.apiKey,
    };
  }

  async translateRaw(request: TranslateRequest): Promise<TranslateResponse> {
    if (!this.apiKey) {
      return {
        translated_text: request.input,
        source_language_code: request.source_language_code,
        target_language_code: request.target_language_code,
      };
    }

    const response = await this.fetchWithRetry(
      `${this.baseURL}/translate`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          input: request.input,
          source_language_code: request.source_language_code,
          target_language_code: request.target_language_code,
          model: request.model || 'mayura:v1',
          output_script: request.output_script,
          numerals_format: request.numerals_format,
          speaker_gender: request.speaker_gender,
          mode: request.mode,
          enable_preprocessing: request.enable_preprocessing ?? true,
        }),
      },
      this.translateBucket,
      'translate'
    );

    return response.json() as Promise<TranslateResponse>;
  }

  async transliterate(request: TransliterateRequest): Promise<TransliterateResponse> {
    if (request.input.length > TRANSLITERATE_MAX_CHARS) {
      throw new Error(`[SarvamAI] Transliterate input exceeds ${TRANSLITERATE_MAX_CHARS} characters`);
    }

    if (!this.apiKey) {
      return { transliterated_text: request.input };
    }

    const cacheKey = this.getCacheKey('translit', request.source_language_code, request.target_language_code, request.input);
    const cached = this.getFromCache(cacheKey);
    if (cached) return { transliterated_text: cached };

    const response = await this.fetchWithRetry(
      `${this.baseURL}/transliterate`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          input: request.input,
          source_language_code: request.source_language_code,
          target_language_code: request.target_language_code,
          numerals_format: request.numerals_format,
        }),
      },
      this.otherBucket,
      'transliterate'
    );

    const data = await response.json() as TransliterateResponse;
    this.setCache(cacheKey, data.transliterated_text);
    return data;
  }

  async speechToText(request: SpeechToTextRequest): Promise<SpeechToTextResponse> {
    if (!this.apiKey) {
      return { transcript: '', language_code: request.language_code };
    }

    const formData = new FormData();
    const blob = new Blob([request.file as any], { type: 'audio/wav' });
    formData.append('file', blob, request.fileName);
    formData.append('model', request.model || 'saaras:v3');
    formData.append('language_code', request.language_code);
    if (request.mode) formData.append('mode', request.mode);

    const response = await this.fetchWithRetry(
      `${this.baseURL}/speech-to-text`,
      {
        method: 'POST',
        headers: { 'api-subscription-key': this.apiKey },
        body: formData as any,
      },
      this.otherBucket,
      'speech-to-text'
    );

    return response.json() as Promise<SpeechToTextResponse>;
  }

  async textToSpeech(request: TextToSpeechRequest): Promise<TextToSpeechResponse> {
    if (!this.apiKey) {
      return { audios: [] };
    }

    const response = await this.fetchWithRetry(
      `${this.baseURL}/text-to-speech`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          inputs: request.inputs,
          target_language_code: request.target_language_code,
          speaker: request.speaker,
          model: request.model,
          enable_preprocessing: request.enable_preprocessing ?? true,
        }),
      },
      this.otherBucket,
      'text-to-speech'
    );

    return response.json() as Promise<TextToSpeechResponse>;
  }

  async detectLanguage(request: LanguageDetectionRequest): Promise<LanguageDetectionResponse> {
    const cacheKey = this.getCacheKey('detect', request.input.substring(0, 200));
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }

    if (!this.sarvamLiveEnabled()) {
      try {
        const out = await this.geminiLanguageCall(
          `Detect the language of this text. Reply with ONLY a JSON object `
          + `{"language_code":"xx-IN","confidence":0.0-1.0,"script":"..."}.\n`
          + `Use BCP-47 India tags when possible (hi-IN, ta-IN, en-IN, etc.).\n\n`
          + `TEXT:\n${request.input.slice(0, 2000)}`,
        );
        const jsonMatch = out.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const data: LanguageDetectionResponse = {
            language_code: parsed.language_code || 'en-IN',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
            script: parsed.script || 'Latin',
          };
          this.setCache(cacheKey, JSON.stringify(data));
          return data;
        }
      } catch {
        /* fall through */
      }
      return { language_code: 'en-IN', confidence: 0, script: 'Latin' };
    }

    if (!this.apiKey) {
      return { language_code: 'en-IN', confidence: 0, script: 'Latin' };
    }

    // Sarvam renamed /detect-language → /text-lid (verified live 2026-05-09).
    // New response uses `script_code` instead of `script`; normalize for callers.
    const response = await this.fetchWithRetry(
      `${this.baseURL}/text-lid`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ input: request.input }),
      },
      this.otherBucket,
      'text-lid'
    );

    const raw = await response.json() as Record<string, any>;
    const data: LanguageDetectionResponse = {
      language_code: raw.language_code ?? 'en-IN',
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 1,
      script: raw.script ?? raw.script_code ?? 'Latin',
    };
    this.setCache(cacheKey, JSON.stringify(data));
    return data;
  }

  async translateDocument(request: DocumentTranslationRequest): Promise<DocumentTranslationResponse> {
    if (!this.apiKey) {
      return { translated_content: '', page_number: request.page_number };
    }

    const formData = new FormData();
    const blob = new Blob([request.file as any], { type: 'application/pdf' });
    formData.append('file', blob, request.fileName);
    formData.append('page_number', String(request.page_number));
    formData.append('input_lang', request.input_lang);
    formData.append('output_lang', request.output_lang);

    const response = await this.fetchWithRetry(
      `${this.baseURL}/parse/translatepdf`,
      {
        method: 'POST',
        headers: { 'api-subscription-key': this.apiKey },
        body: formData as any,
      },
      this.otherBucket,
      'translatepdf'
    );

    return response.json() as Promise<DocumentTranslationResponse>;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    if (!this.isLanguageSupported(request.targetLanguage)) {
      throw new Error(`[SarvamAI] Unsupported target language: ${request.targetLanguage}`);
    }

    const cacheKey = this.getCacheKey('translate', request.sourceLanguage, request.targetLanguage, request.text);

    if (request.cacheEnabled !== false) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          originalText: request.text,
          translatedText: cached,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          confidence: 1.0,
          provider: 'sarvam',
          cached: true,
          processingTime: Date.now() - startTime,
          metadata: {
            domain: request.domain || 'general',
            qualityScore: 0.95,
            model: 'mayura:v1',
          },
        };
      }
      this.stats.cacheMisses++;
    }

    const seedResult = this.getSeedTranslation(request.text, request.targetLanguage);
    if (seedResult) {
      if (request.cacheEnabled !== false) this.setCache(cacheKey, seedResult);
      return {
        originalText: request.text,
        translatedText: seedResult,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        confidence: 1.0,
        provider: 'sarvam',
        cached: false,
        processingTime: Date.now() - startTime,
        metadata: {
          domain: request.domain || 'legal',
          qualityScore: 1.0,
          model: 'seed',
        },
      };
    }

    if (!this.sarvamLiveEnabled()) {
      try {
        const geminiOut = await this.geminiLanguageCall(
          `You are a legal translation engine for Indian languages.\n`
          + `Translate the text from ${request.sourceLanguage} to ${request.targetLanguage}.\n`
          + `Preserve legal citations, statute names, and proper nouns.\n`
          + `Return ONLY the translated text.\n\nTEXT:\n${request.text.slice(0, 8000)}`,
        );
        if (geminiOut) {
          if (request.cacheEnabled !== false) this.setCache(cacheKey, geminiOut);
          return {
            originalText: request.text,
            translatedText: geminiOut,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            confidence: 0.88,
            provider: 'gemini',
            cached: false,
            processingTime: Date.now() - startTime,
            metadata: {
              domain: request.domain || 'legal',
              qualityScore: 0.88,
              model: process.env.JRX_GEMINI_LANGUAGE_MODEL || getGeminiLanguageModel(),
            },
          };
        }
      } catch {
        /* fall through */
      }
      const fallback = request.text;
      return {
        originalText: request.text,
        translatedText: fallback,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        confidence: 0.0,
        provider: 'fallback',
        cached: false,
        processingTime: Date.now() - startTime,
        metadata: {
          domain: request.domain || 'general',
          qualityScore: 0.0,
          model: 'fallback',
        },
      };
    }

    if (!this.apiKey) {
      const fallback = request.text;
      if (request.cacheEnabled !== false) this.setCache(cacheKey, fallback);
      return {
        originalText: request.text,
        translatedText: fallback,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        confidence: 0.0,
        provider: 'fallback',
        cached: false,
        processingTime: Date.now() - startTime,
        metadata: {
          domain: request.domain || 'general',
          qualityScore: 0.0,
          model: 'fallback',
        },
      };
    }

    try {
      const apiResponse = await this.translateRaw({
        input: request.text,
        source_language_code: this.toSarvamCode(request.sourceLanguage),
        target_language_code: this.toSarvamCode(request.targetLanguage),
        mode: request.mode,
        speaker_gender: request.speakerGender,
        numerals_format: request.numeralsFormat,
        enable_preprocessing: request.enablePreprocessing,
      });

      const translatedText = apiResponse.translated_text || request.text;
      if (request.cacheEnabled !== false) this.setCache(cacheKey, translatedText);

      return {
        originalText: request.text,
        translatedText,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        confidence: 0.95,
        provider: 'sarvam',
        cached: false,
        processingTime: Date.now() - startTime,
        metadata: {
          domain: request.domain || 'general',
          qualityScore: 0.95,
          model: 'mayura:v1',
        },
      };
    } catch (error: any) {
      logger.error(`[SarvamAI] Translation failed, using fallback: ${error.message}`);
      this.stats.errors++;
      this.emit('error', { endpoint: 'translate', error: error.message });

      return {
        originalText: request.text,
        translatedText: request.text,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        confidence: 0.0,
        provider: 'fallback',
        cached: false,
        processingTime: Date.now() - startTime,
        metadata: {
          domain: request.domain || 'general',
          qualityScore: 0.0,
          model: 'fallback',
        },
      };
    }
  }

  async batchTranslate(request: BatchTranslationRequest): Promise<TranslationResponse[]> {
    const results: TranslationResponse[] = [];
    const chunks: string[][] = [];

    for (let i = 0; i < request.texts.length; i += BATCH_CHUNK_SIZE) {
      chunks.push(request.texts.slice(i, i + BATCH_CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(text =>
        this.translate({
          text,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          domain: request.domain as any,
          cacheEnabled: true,
        })
      );
      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
    }

    return results;
  }

  async getAllTranslations(key: string, sourceLanguage: string = 'en'): Promise<Map<string, string>> {
    const translations = new Map<string, string>();
    const seedMap = this.seedTranslations.get(key.toLowerCase());
    if (seedMap) {
      seedMap.forEach((translation, lang) => {
        translations.set(lang, translation);
      });
      return translations;
    }

    for (const lang of SUPPORTED_LANGUAGES) {
      if (lang.code === sourceLanguage) {
        translations.set(lang.code, key);
        continue;
      }
      try {
        const result = await this.translate({
          text: key,
          sourceLanguage,
          targetLanguage: lang.code,
          cacheEnabled: true,
        });
        translations.set(lang.code, result.translatedText);
      } catch {
        translations.set(lang.code, key);
      }
    }

    return translations;
  }

  private getSeedTranslation(text: string, targetLanguage: string): string | null {
    const normalized = text.toLowerCase().trim();
    const seedMap = this.seedTranslations.get(normalized);
    if (seedMap && seedMap.has(targetLanguage)) {
      return seedMap.get(targetLanguage)!;
    }
    return null;
  }

  getStats(): ServiceStatistics {
    return {
      totalRequests: this.stats.totalRequests,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      cacheSize: this.cache.size,
      errors: this.stats.errors,
      avgLatencyMs: this.stats.totalRequests > 0
        ? Math.round(this.stats.totalLatencyMs / this.stats.totalRequests)
        : 0,
      totalLatencyMs: this.stats.totalLatencyMs,
      supportedLanguages: SUPPORTED_LANGUAGES.length,
      apiKeyConfigured: !!this.apiKey,
      rateLimitState: {
        translateRemaining: this.translateBucket.tokens,
        otherRemaining: this.otherBucket.tokens,
      },
      uptime: Date.now() - this.startTime,
    };
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheOrder = [];
    logger.info('[SarvamAI] Cache cleared');
    this.emit('cacheCleared');
  }

  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      totalLatencyMs: 0,
      requestsByEndpoint: {},
    };
    logger.info('[SarvamAI] Statistics reset');
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}

export { SarvamAIService as SarvamTranslationService };

export const sarvamAIService = new SarvamAIService();
export const sarvamTranslationService = sarvamAIService;
