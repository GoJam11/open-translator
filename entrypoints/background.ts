import type { RuntimeMessage, RuntimeResponse } from '../src/messages';
import type { TranslationJobRequest } from '../src/types';
import { requestTranslation, MissingSettingsError } from '../src/translator';
import {
  loadSettings,
  readTranslationCacheEntry,
  upsertTranslationCacheEntry,
} from '../src/storage';

const ORIGIN_RULE_ID = 1001;

export default defineBackground(() => {
  console.log('[open-translate] background ready', { id: browser.runtime.id });
  browser.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse) => {
      if (message?.type !== 'translate-paragraphs') {
        return undefined;
      }
      handleTranslationRequest(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => {
          const messageText =
            error instanceof Error
              ? error.message
              : '翻译接口调用时发生未知错误。';
          sendResponse({ ok: false, error: messageText });
        });
      return true;
    },
  );

  syncOriginHeaderRule();
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes['ot.settings']) return;
    syncOriginHeaderRule();
  });
});

async function handleTranslationRequest(
  payload: TranslationJobRequest,
): Promise<RuntimeResponse> {
  const { pageUrl, paragraphs, fromLang, toLang } = payload;
  const cacheUrl = normalizePageUrl(pageUrl);
  try {
    const settings = await loadSettings();
    const cachedEntry = cacheUrl
      ? await readTranslationCacheEntry(cacheUrl, fromLang, toLang)
      : null;
    const cachedTranslations = cachedEntry?.translations ?? {};

    const missingParagraphs: string[] = [];
    const missingIndices: number[] = [];
    const results = paragraphs.map((paragraph, index) => {
      if (
        cachedEntry &&
        Object.prototype.hasOwnProperty.call(cachedTranslations, paragraph)
      ) {
        return cachedTranslations[paragraph];
      }
      missingParagraphs.push(paragraph);
      missingIndices.push(index);
      return '';
    });

    if (!missingParagraphs.length) {
      if (cacheUrl) {
        await upsertTranslationCacheEntry(cacheUrl, fromLang, toLang, {});
      }
      return {
        ok: true,
        data: {
          translations: results,
        },
      };
    }

    const freshTranslations = await requestTranslation(
      {
        paragraphs: missingParagraphs,
        fromLang,
        toLang,
      },
      settings,
    );

    missingIndices.forEach((originalIndex, position) => {
      results[originalIndex] = freshTranslations[position] ?? '';
    });

    if (cacheUrl) {
      const additions: Record<string, string> = {};
      missingIndices.forEach((originalIndex, position) => {
        additions[paragraphs[originalIndex]] = freshTranslations[position] ?? '';
      });
      await upsertTranslationCacheEntry(cacheUrl, fromLang, toLang, additions);
    }

    return {
      ok: true,
      data: {
        translations: results,
      },
    };
  } catch (error) {
    if (error instanceof MissingSettingsError) {
      return { ok: false, error: error.message };
    }
    const message =
      error instanceof Error ? error.message : '翻译接口调用时发生未知错误。';
    return { ok: false, error: message };
  }
}

function normalizePageUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

async function syncOriginHeaderRule() {
  try {
    const settings = await loadSettings();
    const origin = toOrigin(settings.baseUrl);
    await updateOriginRule(origin);
  } catch (error) {
    console.warn('[open-translate] Failed to sync origin rule', error);
  }
}

function toOrigin(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function updateOriginRule(origin: string | null) {
  if (!browser?.declarativeNetRequest) return;
  type UpdateOptions = Parameters<
    typeof browser.declarativeNetRequest.updateDynamicRules
  >[0];
  type DnrRule = NonNullable<UpdateOptions['addRules']>[number];

  const addRules: DnrRule[] = origin
    ? [
        {
          id: ORIGIN_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'origin', operation: 'set', value: origin },
            ],
          },
          condition: {
            urlFilter: `|${origin}/`,
            resourceTypes: ['xmlhttprequest', 'other'],
          },
        },
      ]
    : [];

  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ORIGIN_RULE_ID],
    addRules,
  });
}
