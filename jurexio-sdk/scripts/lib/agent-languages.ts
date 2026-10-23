/**
 * Jurexio v5.0.1 — Per-jurisdiction supportedLanguages map.
 *
 * Restores v2 41-language parity for IN; jurisdiction-appropriate subsets
 * for the others.
 */

export type Jurisdiction = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG' | 'Default';

const IN_LANGUAGES = [
  'en', 'hi', 'bn', 'te', 'mr', 'ta', 'ur', 'gu', 'kn', 'ml',
  'or', 'pa', 'as', 'mai', 'sat', 'ks', 'ne', 'sd', 'doi', 'kok',
  'mni', 'brx', 'sa',
  'es', 'fr', 'de', 'zh', 'ja', 'ko', 'pt', 'ar', 'it', 'nl',
  'ru', 'pl', 'tr', 'th', 'vi', 'id', 'ms', 'fa',
];

const UK_LANGUAGES = [
  'en', 'cy', 'gd', 'ga', 'fr', 'de', 'es', 'it', 'pl', 'ar', 'zh', 'ur',
];

const EU_LANGUAGES = [
  'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'sv', 'fi', 'da',
  'cs', 'hu', 'el', 'ro', 'bg', 'hr', 'sk', 'sl', 'lt', 'lv', 'et',
  'mt', 'ga',
];

const US_LANGUAGES = [
  'en', 'es', 'fr', 'zh', 'tl', 'vi', 'ar', 'ko', 'ru', 'pt', 'de', 'ja',
];

const GC_LANGUAGES = ['en', 'ar', 'fa', 'ur', 'hi', 'tl', 'ml', 'ta'];

const SG_LANGUAGES = ['en', 'zh', 'ms', 'ta', 'hi', 'id'];

export function getJurisdictionLanguages(jur: string): string[] {
  switch (jur) {
    case 'IN':
      return [...IN_LANGUAGES];
    case 'UK':
      return [...UK_LANGUAGES];
    case 'EU':
      return [...EU_LANGUAGES];
    case 'US':
      return [...US_LANGUAGES];
    case 'GC':
      return [...GC_LANGUAGES];
    case 'SG':
      return [...SG_LANGUAGES];
    case 'Default':
      return [...IN_LANGUAGES];
    default:
      return [...IN_LANGUAGES];
  }
}

export const EXPECTED_LANG_COUNTS: Record<Jurisdiction, number> = {
  IN: IN_LANGUAGES.length,
  UK: UK_LANGUAGES.length,
  EU: EU_LANGUAGES.length,
  US: US_LANGUAGES.length,
  GC: GC_LANGUAGES.length,
  SG: SG_LANGUAGES.length,
  Default: IN_LANGUAGES.length,
};
