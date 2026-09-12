'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  dictionary,
  Language,
  SUPPORTED_LANGUAGES,
  SupportedLanguageInfo,
  TranslationKey,
} from '@/locales/dictionary';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey | (string & {}), defaultText?: string) => string;
  formatPrice: (amountVnd: number) => string;
  supportedLanguages: readonly SupportedLanguageInfo[];
  currentLanguageInfo: SupportedLanguageInfo;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'hotel_language';

const LOCALE_MAP: Record<Language, string> = {
  vi: 'vi-VN',
  en: 'en-US',
  ru: 'ru-RU',
  zh: 'zh-CN',
  ja: 'ja-JP',
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('vi');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
      if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
        setLanguageState(saved);
        document.documentElement.lang = saved;
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  function setLanguage(lang: Language) {
    if (!SUPPORTED_LANGUAGES.some((l) => l.code === lang)) return;
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
      document.documentElement.lang = lang;
    } catch {
      // Ignore
    }
  }

  function t(key: TranslationKey | (string & {}), defaultText?: string): string {
    const langDict = dictionary[language];
    if (langDict && key in langDict) {
      return (langDict as Record<string, string>)[key];
    }
    const fallbackDict = dictionary.en;
    if (fallbackDict && key in fallbackDict) {
      return (fallbackDict as Record<string, string>)[key];
    }
    return defaultText ?? key;
  }

  function formatPrice(amountVnd: number): string {
    const locale = LOCALE_MAP[language] ?? 'vi-VN';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(amountVnd);
  }

  const currentLanguageInfo =
    SUPPORTED_LANGUAGES.find((l) => l.code === language) ?? SUPPORTED_LANGUAGES[0];

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
        formatPrice,
        supportedLanguages: SUPPORTED_LANGUAGES,
        currentLanguageInfo,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
}
