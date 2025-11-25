import { useEffect, useState } from 'react';
import {
  LANGUAGE_OPTIONS,
  DEFAULT_LANGUAGE_PAIR,
} from '../../src/languages';
import {
  loadLanguagePair,
  loadSettings,
  saveLanguagePair,
} from '../../src/storage';
import { trackEvent } from '../../src/analytics';
import type { LanguagePair, TranslatorSettings } from '../../src/types';
import './App.css';

type StatusState =
  | { type: 'idle'; message?: string }
  | { type: 'running'; message?: string }
  | { type: 'done'; message?: string }
  | { type: 'error'; message: string };

function isSettingsConfigured(settings: TranslatorSettings) {
  return Boolean(
    settings.baseUrl?.trim() &&
      settings.apiKey?.trim() &&
      settings.model?.trim(),
  );
}

function App() {
  const [languagePair, setLanguagePair] =
    useState<LanguagePair>(DEFAULT_LANGUAGE_PAIR);
  const [status, setStatus] = useState<StatusState>({ type: 'idle' });

  useEffect(() => {
    loadLanguagePair()
      .then(setLanguagePair)
      .catch((error) =>
        console.error('[popup] Failed to load language pair', error),
      );
  }, []);

  const handleChange = (key: keyof LanguagePair, value: string) => {
    setLanguagePair((prev) => ({ ...prev, [key]: value }));
  };

  const handleTranslate = async () => {
    setStatus({ type: 'running', message: '正在翻译页面...' });
    const eventProps = {
      from_lang: languagePair.fromLang,
      to_lang: languagePair.toLang,
      trigger: 'popup',
    };
    try {
      const settings = await loadSettings().catch(() => null);
      if (!settings || !isSettingsConfigured(settings)) {
        const message = '请先在“配置 API”页面填写 Base URL、API Key 和 Model。';
        setStatus({ type: 'error', message });
        void trackEvent('translation_request', {
          ...eventProps,
          status: 'missing_settings',
        });
        return;
      }
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        throw new Error('未找到当前标签页。');
      }
      await browser.tabs.sendMessage(tab.id, {
        type: 'start-translation',
        payload: languagePair,
      });
      await saveLanguagePair(languagePair);
      setStatus({ type: 'done', message: '翻译请求已发送。' });
      void trackEvent('translation_request', {
        ...eventProps,
        status: 'sent',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '无法发送翻译请求。';
      setStatus({ type: 'error', message });
      void trackEvent('translation_request', {
        ...eventProps,
        status: 'failed',
        error_message: message,
      });
    }
  };

  const openOptions = () => {
    void trackEvent('open_options', { trigger: 'popup' });
    if (browser.runtime?.openOptionsPage) {
      browser.runtime.openOptionsPage();
    } else {
      window.open('chrome://extensions/?options=' + browser.runtime.id);
    }
  };

  return (
    <div className="popup">
      <h1>纯净式翻译（Open Translate）</h1>
      <p className="description">
        选择源语言和目标语言，然后点击翻译即可在页面中查看结果。
      </p>
      <div className="field">
        <label htmlFor="from-language">From</label>
        <select
          id="from-language"
          value={languagePair.fromLang}
          onChange={(event) => handleChange('fromLang', event.target.value)}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="to-language">To</label>
        <select
          id="to-language"
          value={languagePair.toLang}
          onChange={(event) => handleChange('toLang', event.target.value)}
        >
          {LANGUAGE_OPTIONS.filter((option) => option.value !== 'auto').map(
            (option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ),
          )}
        </select>
      </div>
      <button
        className="primary"
        onClick={handleTranslate}
        disabled={status.type === 'running'}
      >
        {status.type === 'running' ? '翻译中...' : '开始翻译'}
      </button>
      <button className="link" onClick={openOptions}>
        配置 API
      </button>
      <p
        className={`status status-${status.type}`}
        role="status"
        aria-live="polite"
      >
        {status.message ??
          (status.type === 'idle' ? '等待操作。' : '已完成。')}
      </p>
    </div>
  );
}

export default App;
