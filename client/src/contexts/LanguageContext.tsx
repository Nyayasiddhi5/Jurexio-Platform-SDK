import React, { createContext, useContext, useState } from 'react';

export type SupportedLanguage = 
  | 'en' | 'hi' | 'ta' | 'te' | 'kn' | 'ml' | 'mr' | 'gu' | 'pa' | 'bn'
  | 'or' | 'as' | 'ur' | 'sa' | 'ne' | 'si' | 'kok' | 'mai' | 'doi' | 'ks'
  | 'mni' | 'sat';

export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'हिंदी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  kn: 'ಕನ್ನಡ',
  ml: 'മലയാളം',
  mr: 'मराठी',
  gu: 'ગુજરાતી',
  pa: 'ਪੰਜਾਬੀ',
  bn: 'বাংলা',
  or: 'ଓଡ଼ିଆ',
  as: 'অসমীয়া',
  ur: 'اردو',
  sa: 'संस्कृत',
  ne: 'नेपाली',
  si: 'සිංහල',
  kok: 'कोंकणी',
  mai: 'मैथिली',
  doi: 'डोगरी',
  ks: 'كٲشُر',
  mni: 'মৈতৈলোন্',
  sat: 'ᱥᱟᱱᱛᱟᱲᱤ',
};

interface LanguageContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: string) => string;
  isLoadingTranslations: boolean;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
  t: (key: string) => key,
  isLoadingTranslations: false,
});

interface LanguageProviderProps {
  children: React.ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguage] = useState<SupportedLanguage>('en');
  const [isLoadingTranslations] = useState(false);

  const t = (key: string) => key;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isLoadingTranslations }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
