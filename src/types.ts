export type TranslatorSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  showFloatingButton: boolean;
};

export type LanguagePair = {
  fromLang: string;
  toLang: string;
};

export type TranslationJobRequest = {
  paragraphs: string[];
  fromLang: string;
  toLang: string;
  pageUrl?: string;
};

export type TranslationResponse = {
  translations: string[];
};

export type TranslationCacheEntry = {
  url: string;
  fromLang: string;
  toLang: string;
  translations: Record<string, string>;
  updatedAt: number;
};
