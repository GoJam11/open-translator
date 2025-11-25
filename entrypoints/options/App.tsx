import { FormEvent, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from '../../src/storage';
import { trackEvent } from '../../src/analytics';
import type { TranslatorSettings } from '../../src/types';
import './App.css';

type StatusState = 'idle' | 'saving' | 'saved' | 'error';

function OptionsApp() {
  const [settings, setSettings] =
    useState<TranslatorSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<StatusState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch((error) => {
        console.error('[options] failed to load settings', error);
        setErrorMessage('无法读取当前配置。');
        setStatus('error');
      });
  }, []);

  const handleChange = <K extends keyof TranslatorSettings>(
    key: K,
    value: TranslatorSettings[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus('saving');
    setErrorMessage('');
    const eventProps = {
      has_base_url: Boolean(settings.baseUrl.trim()),
      has_api_key: Boolean(settings.apiKey.trim()),
      model: settings.model.trim() || 'unset',
      show_floating_button: settings.showFloatingButton,
    };
    try {
      await saveSettings({
        baseUrl: settings.baseUrl.trim(),
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        showFloatingButton: settings.showFloatingButton,
      });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
      void trackEvent('settings_saved', {
        ...eventProps,
        status: 'success',
      });
    } catch (error) {
      console.error('[options] failed to save settings', error);
      setStatus('error');
      const message = '保存失败，请稍后再试。';
      setErrorMessage(message);
      void trackEvent('settings_saved', {
        ...eventProps,
        status: 'error',
        error_message: message,
      });
    }
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    setStatus('idle');
    setErrorMessage('');
  };

  return (
    <main className="options-page">
      <div>
        <h1>纯净式翻译 · Options</h1>
        <p>配置兼容 OpenAI 的 Base URL、API Key 以及模型名称。</p>
      </div>
      <form className="options-form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="base-url">Base URL</label>
          <input
            id="base-url"
            placeholder="https://api.openai.com"
            value={settings.baseUrl}
            onChange={(event) => handleChange('baseUrl', event.target.value)}
            required
          />
          <p className="helper-text">
            末尾无需添加 /v1，系统会自动补齐。支持任意兼容 OpenAI 的服务。
          </p>
        </div>
        <div className="form-field">
          <label htmlFor="api-key">API Key</label>
          <input
            id="api-key"
            type="password"
            placeholder="sk-..."
            value={settings.apiKey}
            onChange={(event) => handleChange('apiKey', event.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            placeholder="gpt-4o-mini"
            value={settings.model}
            onChange={(event) => handleChange('model', event.target.value)}
            required
          />
        </div>
        <div className="form-field form-field-inline">
          <label htmlFor="show-floating">显示悬浮气泡按钮</label>
          <input
            id="show-floating"
            type="checkbox"
            checked={settings.showFloatingButton}
            onChange={(event) =>
              handleChange('showFloatingButton', event.target.checked)
            }
          />
        </div>
        <div className="actions">
          <button
            className="primary"
            type="submit"
            disabled={status === 'saving'}
          >
            {status === 'saving' ? '保存中...' : '保存配置'}
          </button>
          <button className="secondary" type="button" onClick={handleReset}>
            清空表单
          </button>
          <span
            className={`status status-${status}`}
            aria-live="polite"
            role="status"
          >
            {status === 'saved'
              ? '配置已保存。'
              : status === 'error'
                ? errorMessage
                : ''}
          </span>
        </div>
      </form>
    </main>
  );
}

export default OptionsApp;
