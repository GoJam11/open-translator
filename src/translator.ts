import type { TranslationJobRequest, TranslatorSettings } from './types';

export class MissingSettingsError extends Error {
  constructor() {
    super('请先在 Options 页面配置 Base URL、API Key 和 Model。');
  }
}

function assertSettings(settings: TranslatorSettings) {
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new MissingSettingsError();
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function buildChatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith('/v1')) {
    return `${normalized}/chat/completions`;
  }
  if (normalized.includes('/v1/')) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

function buildPrompt({ paragraphs, fromLang, toLang }: TranslationJobRequest) {
  const payload = JSON.stringify(paragraphs);
  return `Translate the following paragraphs from ${fromLang} to ${toLang}. Always translate general words, sentences, and prose into natural ${toLang}. Keep proper nouns, brand or product names, code snippets, commands, and strings that are mostly symbols/numbers unchanged when translation is inappropriate. Respond with a valid JSON array of strings with the same length and order as the input. Do not include explanations, code fences, or additional keys.\nExamples:\n["GPT-5.1","GPT-5.1"]\n["GPT-5.1-Codex-Max is built for long-running, detailed work.","GPT-5.1-Codex-Max 旨在处理长时间、详细的工作。"]\n["Product","产品"]\nInput:\n${payload}`;
}

function parseTranslations(
  rawContent: string,
  expectedSize: number,
): string[] {
  const cleaned = rawContent.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown) => String(item ?? ''));
    }
    if (Array.isArray(parsed.translations)) {
      return parsed.translations.map((item: unknown) => String(item ?? ''));
    }
  } catch {
    // fall through to naive splitting
  }
  return cleaned
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, expectedSize);
}

export async function requestTranslation(
  payload: TranslationJobRequest,
  settings: TranslatorSettings,
) {
  assertSettings(settings);
  const url = buildChatCompletionsUrl(settings.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a precise translation engine. Always translate sentences and paragraphs into clear target-language text. Keep proper nouns, brand/product names, and untranslatable code/commands or symbol-only strings unchanged. Do not provide explanations.',
        },
        {
          role: 'user',
          content: buildPrompt(payload),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `翻译接口调用失败（${response.status} ${response.statusText}）：${errorText}`,
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('模型返回为空，请稍后再试。');
  }
  const translations = parseTranslations(content, payload.paragraphs.length);
  if (!translations.length) {
    throw new Error('无法解析翻译结果，请检查提示词。');
  }
  return translations;
}
