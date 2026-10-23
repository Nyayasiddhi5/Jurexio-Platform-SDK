export { AdvancedLanguageSwitchingService, advancedLanguageSwitchingService } from './advanced-language-switching-service.js';
export { MultiLanguageSandbox } from './multi-language-sandbox.js';
export { SarvamAIService, SarvamTranslationService, sarvamAIService, sarvamTranslationService } from './sarvam-translation-service.js';

export const i18nPackageInfo = {
  name: 'jurexio-sdk-i18n',
  version: '2.0.0',
  services: [
    'sarvam-translation-service',
    'advanced-language-switching-service',
    'multi-language-sandbox'
  ],
  capabilities: [
    'Sarvam AI Translation',
    '22 Indian Languages',
    '12 Global Languages',
    'Language Switching',
    'Multi-language Sandbox'
  ],
  supportedLanguages: {
    indian: ['hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'or', 'pa', 'as', 'ur', 'mai', 'sat', 'ks', 'ne', 'sd', 'kok', 'mni', 'doi', 'sa', 'bo'],
    global: ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'nl']
  }
};
