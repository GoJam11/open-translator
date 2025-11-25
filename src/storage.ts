import type {
  LanguagePair,
  TranslatorSettings,
  TranslationCacheEntry,
} from './types';
import { DEFAULT_LANGUAGE_PAIR } from './languages';

const SETTINGS_KEY = 'ot.settings';
const LANGUAGE_KEY = 'ot.language';
const TRANSLATION_CACHE_KEY = 'ot.translation-cache';
const MAX_TRANSLATION_CACHE_ENTRIES = 8;

function readEnvDefault(
  key: 'VITE_OT_BASE_URL' | 'VITE_OT_API_KEY' | 'VITE_OT_MODEL',
) {
  if (!import.meta.env.DEV) return undefined;
  const value = import.meta.env[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export const DEFAULT_SETTINGS: TranslatorSettings = {
  baseUrl: readEnvDefault('VITE_OT_BASE_URL') ?? 'http://localhost:11434',
  apiKey: readEnvDefault('VITE_OT_API_KEY') ?? '',
  model: readEnvDefault('VITE_OT_MODEL') ?? 'gemma3:1b',
  showFloatingButton: true,
};

function ensureStorage() {
  if (!browser?.storage?.local) {
    throw new Error('Storage API is not available in this context.');
  }
  return browser.storage.local;
}

export async function loadSettings(): Promise<TranslatorSettings> {
  const storage = ensureStorage();
  const stored = await storage.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored?.[SETTINGS_KEY] ?? {}),
  };
}

export async function saveSettings(settings: TranslatorSettings) {
  const storage = ensureStorage();
  await storage.set({ [SETTINGS_KEY]: settings });
}

export async function updateSettings(partial: Partial<TranslatorSettings>) {
  const next = { ...(await loadSettings()), ...partial };
  await saveSettings(next);
  return next;
}

export async function loadLanguagePair(): Promise<LanguagePair> {
  const storage = ensureStorage();
  const stored = await storage.get(LANGUAGE_KEY);
  return {
    ...DEFAULT_LANGUAGE_PAIR,
    ...(stored?.[LANGUAGE_KEY] ?? {}),
  };
}

export async function saveLanguagePair(pair: LanguagePair) {
  const storage = ensureStorage();
  await storage.set({ [LANGUAGE_KEY]: pair });
}

function normalizeCacheEntries(raw: unknown): TranslationCacheEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const { url, fromLang, toLang, translations, updatedAt } =
        item as TranslationCacheEntry;
      if (
        typeof url !== 'string' ||
        typeof fromLang !== 'string' ||
        typeof toLang !== 'string' ||
        !translations ||
        typeof translations !== 'object'
      ) {
        return null;
      }
      const safeTranslations: Record<string, string> = {};
      Object.entries(translations).forEach(([key, value]) => {
        if (typeof value === 'string') {
          safeTranslations[key] = value;
        }
      });
      return {
        url,
        fromLang,
        toLang,
        translations: safeTranslations,
        updatedAt: typeof updatedAt === 'number' ? updatedAt : Date.now(),
      } satisfies TranslationCacheEntry;
    })
    .filter((entry): entry is TranslationCacheEntry => Boolean(entry));
}

async function loadTranslationCache(): Promise<TranslationCacheEntry[]> {
  const storage = ensureStorage();
  const stored = await storage.get(TRANSLATION_CACHE_KEY);
  return normalizeCacheEntries(stored?.[TRANSLATION_CACHE_KEY]);
}

async function saveTranslationCache(entries: TranslationCacheEntry[]) {
  const storage = ensureStorage();
  await storage.set({ [TRANSLATION_CACHE_KEY]: entries });
}

function matchesCacheEntry(
  entry: TranslationCacheEntry,
  url: string,
  fromLang: string,
  toLang: string,
) {
  return (
    entry.url === url && entry.fromLang === fromLang && entry.toLang === toLang
  );
}

export async function readTranslationCacheEntry(
  url: string,
  fromLang: string,
  toLang: string,
): Promise<TranslationCacheEntry | null> {
  const cache = await loadTranslationCache();
  const entry = cache.find((item) => matchesCacheEntry(item, url, fromLang, toLang));
  return entry ?? null;
}

export async function upsertTranslationCacheEntry(
  url: string,
  fromLang: string,
  toLang: string,
  translations: Record<string, string>,
): Promise<TranslationCacheEntry> {
  const cache = await loadTranslationCache();
  const now = Date.now();
  const existingIndex = cache.findIndex((item) =>
    matchesCacheEntry(item, url, fromLang, toLang),
  );
  const existingTranslations =
    existingIndex >= 0 ? cache[existingIndex]?.translations ?? {} : {};
  const mergedTranslations = {
    ...existingTranslations,
    ...translations,
  };
  const updatedEntry: TranslationCacheEntry = {
    url,
    fromLang,
    toLang,
    translations: mergedTranslations,
    updatedAt: now,
  };
  const remaining =
    existingIndex >= 0
      ? cache.filter((_, index) => index !== existingIndex)
      : cache;
  const nextCache = [updatedEntry, ...remaining].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const trimmed = nextCache.slice(0, MAX_TRANSLATION_CACHE_ENTRIES);
  await saveTranslationCache(trimmed);
  return updatedEntry;
}
