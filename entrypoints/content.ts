import type { LanguagePair, TranslatorSettings } from '../src/types';
import type { RuntimeMessage, RuntimeResponse } from '../src/messages';
import { DEFAULT_SETTINGS, loadLanguagePair, loadSettings } from '../src/storage';
import { trackEvent, trackPageview } from '../src/analytics';

type LayoutMode = 'inline' | 'block';
type ParagraphState = {
  element: HTMLElement;
  text: string;
  layout: LayoutMode;
  container: HTMLElement | null;
  status: 'idle' | 'queued' | 'translating' | 'done' | 'error';
};

const CHUNK_SIZE = 5;
const TRANSLATED_ATTRIBUTE = 'data-ot-translated';
const TRANSLATED_DATA_KEY = 'otTranslated';
const STYLE_ID = 'ot-translation-style';
const SOURCE_COLOR_VAR = '--ot-source-color';
const CONTENT_CLASS = 'ot-translation-content';
const BREAK_CLASS = 'ot-translation-break';
const TRANSLATABLE_SELECTORS =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, a, div, th, td, caption';
const INLINE_DISPLAY_VALUES = new Set(['inline']);
const INLINE_TAGS = new Set(['A']);
const FLOATING_BUTTON_ID = 'ot-translate-fab';
const SETTINGS_STORAGE_KEY = 'ot.settings';

type TranslationSummary = {
  total: number;
  translated: number;
  errors: number;
};

type TranslationTrigger = 'popup' | 'floating_button' | 'unknown';

type ControllerHooks = {
  onStart?: () => void;
  onComplete?: (summary?: TranslationSummary) => void;
  onError?: (message: string) => void;
};
type FloatingVisualState = 'original' | 'translated';

let controller: ImmersiveTranslationController | null = null;
let floatingButtonHost: HTMLElement | null = null;
let floatingButton: HTMLButtonElement | null = null;
let floatingVisualState: FloatingVisualState = 'original';
let floatingBusy = false;
let floatingButtonPosition = 0.82;
let dragStartY: number | null = null;
let dragStartPosition = floatingButtonPosition;
let dragMoved = false;
let suppressClickAfterDrag = false;
let translationActive = false;
let startRequestId = 0;
let cachedPageUrl: string | undefined;
let floatingButtonEnabled = false;
let hasTrackedTranslationPageview = false;

function recordTranslationStart(
  languagePair: LanguagePair,
  trigger: TranslationTrigger,
) {
  if (!hasTrackedTranslationPageview) {
    hasTrackedTranslationPageview = true;
    void trackPageview();
  }
  void trackEvent('translation_started', {
    trigger,
    from_lang: languagePair.fromLang,
    to_lang: languagePair.toLang,
  });
}

function recordTranslationComplete(
  languagePair: LanguagePair,
  trigger: TranslationTrigger,
  summary?: TranslationSummary,
) {
  void trackEvent('translation_completed', {
    trigger,
    from_lang: languagePair.fromLang,
    to_lang: languagePair.toLang,
    total_paragraphs: summary?.total ?? 0,
    translated_paragraphs: summary?.translated ?? 0,
    error_paragraphs: summary?.errors ?? 0,
  });
}

function recordTranslationError(
  languagePair: LanguagePair,
  trigger: TranslationTrigger,
  message: string,
) {
  void trackEvent('translation_failed', {
    trigger,
    from_lang: languagePair.fromLang,
    to_lang: languagePair.toLang,
    error_message: message,
  });
}

function getPageUrlForCache() {
  if (cachedPageUrl) return cachedPageUrl;
  try {
    cachedPageUrl = window.location.href.split('#')[0];
    return cachedPageUrl;
  } catch {
    return undefined;
  }
}

function hasActiveTranslation() {
  if (translationActive) return true;
  if (controller) return true;
  if (floatingBusy || floatingVisualState === 'translated') return true;
  return Boolean(
    document.querySelector(`[${TRANSLATED_ATTRIBUTE}]`) ||
      document.querySelector('.ot-paragraph-translation, .ot-inline-translation'),
  );
}

function startTranslation(
  languagePair: LanguagePair,
  trigger: TranslationTrigger = 'unknown',
) {
  controller?.destroy();
  resetExistingTranslations();
  translationActive = true;
  setFloatingVisualState('original');
  setFloatingBusy(true);
  recordTranslationStart(languagePair, trigger);
  controller = new ImmersiveTranslationController(languagePair, {
    onStart: () => setFloatingBusy(true),
    onComplete: (summary) => {
      setFloatingBusy(false);
      setFloatingVisualState('translated');
      recordTranslationComplete(languagePair, trigger, summary);
    },
    onError: (message) => recordTranslationError(languagePair, trigger, message),
  });
  controller.start();
}

function initFloatingButton() {
  if (!floatingButtonEnabled) return;
  if (document.body) {
    ensureFloatingButton();
    return;
  }
  const handler = () => {
    ensureFloatingButton();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handler, { once: true });
  } else {
    handler();
  }
}

function teardownFloatingButton() {
  floatingButton?.remove();
  floatingButton = null;
  if (floatingButtonHost?.isConnected) {
    floatingButtonHost.remove();
  }
  floatingButtonHost = null;
}

function applyFloatingButtonVisibility(enabled: boolean) {
  if (floatingButtonEnabled === enabled) return;
  floatingButtonEnabled = enabled;
  if (enabled) {
    initFloatingButton();
  } else {
    teardownFloatingButton();
  }
}

function ensureFloatingButton(): HTMLButtonElement | null {
  if (!floatingButtonEnabled) return null;
  if (floatingButton?.isConnected) return floatingButton;
  if (!document.body) return null;

  if (!floatingButtonHost || !floatingButtonHost.isConnected) {
    floatingButtonHost =
      (document.getElementById(FLOATING_BUTTON_ID) as HTMLElement | null) ??
      document.createElement('div');
    floatingButtonHost.id = FLOATING_BUTTON_ID;
    floatingButtonHost.style.position = 'fixed';
    floatingButtonHost.style.right = '-20px';
    floatingButtonHost.style.top = `${floatingButtonPosition * 100}vh`;
    floatingButtonHost.style.bottom = 'auto';
    floatingButtonHost.style.zIndex = '2147483646';
    floatingButtonHost.style.pointerEvents = 'none';
    document.body.appendChild(floatingButtonHost);
  }

  const shadow =
    floatingButtonHost.shadowRoot ??
    floatingButtonHost.attachShadow({ mode: 'open' });
  shadow.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .ot-fab {
      position: relative;
      appearance: none;
      border: 1px solid rgba(37, 99, 235, 0.16);
      outline: none;
      width: 40px;
      height: 40px;
      border-radius: 999px;
      background: #fff;
      color: #2563eb;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 0.01em;
      cursor: pointer;
      display: inline-grid;
      place-items: center;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
      transition: transform 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease, border-color 0.16s ease;
      pointer-events: auto;
      opacity: 0.94;
    }
    .ot-fab:hover,
    .ot-fab:focus-visible {
      background: #e7f0ff;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14);
      transform: translateX(-20px);
    }
    .ot-fab:active {
      background: #dbe8ff;
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.14);
      opacity: 0.98;
    }
    .ot-fab.is-busy {
      cursor: progress;
      opacity: 0.9;
    }
    .ot-fab.is-translated {
      background: #f0f5ff;
      border-color: rgba(37, 99, 235, 0.26);
      box-shadow: 0 7px 20px rgba(15, 23, 42, 0.14);
    }
    .ot-fab .ot-fab-icon {
      display: inline-block;
      font-size: 16px;
      font-weight: 800;
      line-height: 1;
    }
    .ot-fab .ot-fab-check {
      position: absolute;
      right: -4px;
      bottom: -4px;
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: #1d4ed8;
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      display: none;
      place-items: center;
      box-shadow: 0 6px 12px rgba(37, 99, 235, 0.28);
      pointer-events: none;
    }
    .ot-fab.is-busy .ot-fab-check,
    .ot-fab.is-translated .ot-fab-check {
      display: grid;
    }
    .ot-fab .ot-fab-spinner {
      display: none;
    }
    @media (prefers-color-scheme: dark) {
      .ot-fab {
        background: #fff;
        color: #2563eb;
        border-color: rgba(59, 130, 246, 0.22);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.34);
      }
      .ot-fab.is-busy {
        opacity: 0.9;
      }
      .ot-fab.is-translated {
        background: #f0f5ff;
        color: #1d4ed8;
        border-color: rgba(37, 99, 235, 0.32);
        box-shadow: 0 7px 20px rgba(0, 0, 0, 0.36);
      }
    }
  `;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ot-fab';
  button.title = '翻译当前页面';
  button.setAttribute('aria-label', '翻译当前页面');
  button.addEventListener('click', handleFloatingButtonClick);
  button.addEventListener('mousedown', handleFloatingButtonDragStart);

  const icon = document.createElement('span');
  icon.className = 'ot-fab-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'A';

  const check = document.createElement('span');
  check.className = 'ot-fab-check';
  check.textContent = '✓';

  button.append(icon, check);
  shadow.append(style, button);

  floatingButton = button;
  setFloatingVisualState(floatingVisualState, button);
  setFloatingBusy(floatingBusy, button);
  return floatingButton;
}

function setFloatingVisualState(
  state: FloatingVisualState,
  target?: HTMLButtonElement | null,
) {
  floatingVisualState = state;
  const button = target ?? floatingButton ?? ensureFloatingButton();
  if (!button) return;
  button.classList.toggle('is-translated', state === 'translated');
}

function setFloatingBusy(busy: boolean, target?: HTMLButtonElement | null) {
  floatingBusy = busy;
  const button = target ?? floatingButton ?? ensureFloatingButton();
  if (!button) return;
  button.classList.toggle('is-busy', busy);
  button.disabled = false;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

async function handleFloatingButtonClick() {
  if (suppressClickAfterDrag) {
    suppressClickAfterDrag = false;
    return;
  }
  if (hasActiveTranslation()) {
    startRequestId += 1;
    restoreOriginalPage();
    void trackEvent('translation_reset', { trigger: 'floating_button' });
    return;
  }
  const requestId = ++startRequestId;
  setFloatingBusy(true);
  try {
    const languagePair = await loadLanguagePair();
    if (requestId !== startRequestId) {
      return;
    }
    startTranslation(languagePair, 'floating_button');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '无法加载语言设置。';
    showToast(message, 3600);
    setFloatingBusy(false);
    void trackEvent('translation_failed', {
      trigger: 'floating_button',
      error_message: message,
    });
  }
}

function restoreOriginalPage() {
  controller?.destroy();
  controller = null;
  resetExistingTranslations();
  translationActive = false;
  setFloatingBusy(false);
  setFloatingVisualState('original');
}

function clampPosition(position: number) {
  return Math.min(0.95, Math.max(0.05, position));
}

function handleFloatingButtonDragStart(event: MouseEvent) {
  if (event.button !== 0) return;
  dragStartY = event.clientY;
  dragStartPosition = floatingButtonPosition;
  dragMoved = false;
  suppressClickAfterDrag = false;
  document.addEventListener('mousemove', handleFloatingButtonDragMove);
  document.addEventListener('mouseup', handleFloatingButtonDragEnd, {
    once: true,
  });
  document.body.style.userSelect = 'none';
}

function handleFloatingButtonDragMove(event: MouseEvent) {
  if (dragStartY === null) return;
  const delta = event.clientY - dragStartY;
  const nextPosition = clampPosition(
    dragStartPosition + delta / window.innerHeight,
  );
  if (Math.abs(delta) > 4) {
    dragMoved = true;
    suppressClickAfterDrag = true;
  }
  floatingButtonPosition = nextPosition;
  if (floatingButtonHost) {
    floatingButtonHost.style.top = `${floatingButtonPosition * 100}vh`;
  }
}

function handleFloatingButtonDragEnd() {
  document.removeEventListener('mousemove', handleFloatingButtonDragMove);
  document.body.style.userSelect = '';
  dragStartY = null;
  dragStartPosition = floatingButtonPosition;
}

async function bootstrapFloatingButtonVisibility() {
  try {
    const settings = await loadSettings();
    applyFloatingButtonVisibility(
      settings.showFloatingButton ?? DEFAULT_SETTINGS.showFloatingButton,
    );
  } catch (error) {
    console.warn(
      '[open-translate] failed to load settings, fallback to defaults',
      error,
    );
    applyFloatingButtonVisibility(DEFAULT_SETTINGS.showFloatingButton);
  }
}

function subscribeToSettingsChanges() {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
    const next = changes[SETTINGS_STORAGE_KEY]
      .newValue as TranslatorSettings | undefined;
    const enabled =
      next?.showFloatingButton ?? DEFAULT_SETTINGS.showFloatingButton;
    applyFloatingButtonVisibility(enabled);
  });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    console.log('[open-translate] content script loaded');
    ensureStyle();
    subscribeToSettingsChanges();
    void bootstrapFloatingButtonVisibility();

    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message?.type === 'start-translation') {
        startTranslation(message.payload, 'popup');
        return Promise.resolve<RuntimeResponse>({ ok: true });
      }
      return undefined;
    });
  },
});

class ImmersiveTranslationController {
  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private states = new Map<HTMLElement, ParagraphState>();
  private queue: ParagraphState[] = [];
  private flushTimer: number | null = null;
  private processing = false;
  private pendingCount = 0;
  private destroyed = false;
  private active = false;
  private errorEmitted = false;

  constructor(
    private readonly languagePair: LanguagePair,
    private readonly hooks?: ControllerHooks,
  ) {}

  start() {
    this.destroyed = false;
    this.active = true;
    this.hooks?.onStart?.();
    const root = document.body;
    if (!root) {
      showToast('页面尚未准备完成，请稍后再试。');
      this.notifyComplete();
      return;
    }

    this.intersectionObserver = new IntersectionObserver(
      this.handleIntersect,
      {
        root: null,
        rootMargin: '400px',
        threshold: 0.05,
      },
    );
    this.scanAndObserve(root);

    const initialTargets = this.states.size;
    if (!initialTargets) {
      showToast('没有需要翻译的段落。');
      this.notifyComplete();
    } else {
      showToast(`已准备 ${initialTargets} 个段落，滚动以继续翻译。`, 2200);
    }

    this.mutationObserver = new MutationObserver(this.handleMutations);
    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  destroy() {
    this.destroyed = true;
    this.queue = [];
    this.states.clear();
    this.pendingCount = 0;
    this.active = false;
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  private handleIntersect: IntersectionObserverCallback = (
    entries,
    observer,
  ) => {
    if (this.destroyed) return;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target;
      if (!(element instanceof HTMLElement)) continue;
      observer.unobserve(element);
      this.enqueue(element);
    }
  };

  private handleMutations = (records: MutationRecord[]) => {
    if (this.destroyed) return;
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          this.scanAndObserve(node);
        }
      });
    }
  };

  private scanAndObserve(root: HTMLElement) {
    const nodes = collectParagraphElements(root);
    nodes.forEach((element) => {
      if (this.states.has(element)) return;
      if (element.dataset[TRANSLATED_DATA_KEY]) return;
      if (element.getAttribute(TRANSLATED_ATTRIBUTE) === 'true') return;
      const text = extractParagraphText(element);
      if (!text) return;
      const layout = determineLayout(element);
      const state: ParagraphState = {
        element,
        text,
        layout,
        container: null,
        status: 'idle',
      };
      this.states.set(element, state);
      this.intersectionObserver?.observe(element);
    });
  }

  private enqueue(element: HTMLElement) {
    const state = this.states.get(element);
    if (!state || state.status !== 'idle') return;
    this.markActive();
    const container = ensureTranslationContainer(
      element,
      state.layout,
      state.container,
    );
    setLoadingState(container);
    state.container = container;
    state.status = 'queued';
    element.setAttribute(TRANSLATED_ATTRIBUTE, 'pending');
    this.queue.push(state);
    this.pendingCount += 1;
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushQueue();
    }, 60);
  }

  private async flushQueue() {
    if (this.processing || this.destroyed) return;
    this.processing = true;
    try {
      while (!this.destroyed && this.queue.length) {
        this.sortQueueByLength();
        const chunk = this.queue.splice(0, CHUNK_SIZE);
        chunk.forEach((state) => (state.status = 'translating'));
        try {
          const response = (await browser.runtime.sendMessage({
            type: 'translate-paragraphs',
            payload: {
              paragraphs: chunk.map((state) => state.text),
              fromLang: this.languagePair.fromLang,
              toLang: this.languagePair.toLang,
              pageUrl: getPageUrlForCache(),
            },
          })) as RuntimeResponse;
          if (!response || response.ok === false) {
            throw new Error(response?.error ?? '翻译失败，请稍后重试。');
          }
          const translations = response.data?.translations;
          if (!translations) {
            throw new Error('翻译结果缺失。');
          }
          chunk.forEach((state, index) => {
            const translation = translations[index] ?? '';
            this.applyTranslation(state, translation);
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : '翻译失败，请稍后重试。';
          chunk.forEach((state) => this.markStateError(state, message));
          showToast(message, 4000);
          if (!this.errorEmitted) {
            this.errorEmitted = true;
            this.hooks?.onError?.(message);
          }
        }
      }
    } finally {
      this.processing = false;
      this.maybeComplete();
    }
  }

  private sortQueueByLength() {
    this.queue.sort((a, b) => b.text.length - a.text.length);
  }

  private applyTranslation(state: ParagraphState, translation: string) {
    if (this.destroyed) return;
    if (!state.element.isConnected) {
      this.finishState();
      return;
    }
    const sourceText = state.text.trim();
    const translatedText = (translation ?? '').trim();
    if (translatedText === sourceText) {
      this.clearTranslationContainer(state);
      state.status = 'done';
      state.element.setAttribute(TRANSLATED_ATTRIBUTE, 'true');
      state.element.dataset[TRANSLATED_DATA_KEY] = 'true';
      this.finishState();
      return;
    }
    const container = ensureTranslationContainer(
      state.element,
      state.layout,
      state.container,
    );
    state.container = container;
    container.classList.remove('ot-translation-error');
    const content = ensureTranslationContent(container, state.layout, state.element);
    content.textContent = translation?.trim() ? translation : '(空)';
    container.removeAttribute('aria-busy');
    state.status = 'done';
    state.element.setAttribute(TRANSLATED_ATTRIBUTE, 'true');
    state.element.dataset[TRANSLATED_DATA_KEY] = 'true';
    this.finishState();
  }

  private clearTranslationContainer(state: ParagraphState) {
    const targetClass =
      state.layout === 'inline'
        ? 'ot-inline-translation'
        : 'ot-paragraph-translation';
    const container =
      state.container?.isConnected &&
      state.container.classList.contains(targetClass)
        ? state.container
        : findDirectChild(state.element, targetClass);
    if (container) {
      container.remove();
    }
    state.container = null;
  }

  private markStateError(state: ParagraphState, _message: string) {
    if (this.destroyed) return;
    if (!state.element.isConnected) {
      this.finishState();
      return;
    }
    if (state.container?.isConnected) {
      state.container.remove();
    }
    state.container = null;
    state.status = 'error';
    state.element.removeAttribute(TRANSLATED_ATTRIBUTE);
    delete state.element.dataset[TRANSLATED_DATA_KEY];
    this.finishState();
  }

  private finishState() {
    this.pendingCount = Math.max(0, this.pendingCount - 1);
    this.maybeComplete();
  }

  private maybeComplete() {
    if (
      !this.pendingCount &&
      !this.queue.length &&
      !this.processing &&
      !this.destroyed
    ) {
      showToast('翻译完成。', 2000);
      this.notifyComplete();
    }
  }

  private markActive() {
    if (this.destroyed || this.active) return;
    this.active = true;
    this.hooks?.onStart?.();
  }

  private summarizeStates(): TranslationSummary {
    let translated = 0;
    let errors = 0;
    this.states.forEach((state) => {
      if (state.status === 'done') translated += 1;
      if (state.status === 'error') errors += 1;
    });
    return {
      total: this.states.size,
      translated,
      errors,
    };
  }

  private notifyComplete() {
    if (this.destroyed || !this.active) return;
    this.active = false;
    this.hooks?.onComplete?.(this.summarizeStates());
  }
}

function collectParagraphElements(root: HTMLElement): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  if (root.matches(TRANSLATABLE_SELECTORS)) {
    candidates.push(root);
  }
  root
    .querySelectorAll<HTMLElement>(TRANSLATABLE_SELECTORS)
    .forEach((element) => candidates.push(element));
  if (!candidates.length) return [];
  const unique = Array.from(new Set(candidates));
  const textCache = new WeakMap<HTMLElement, string>();
  const layoutCache = new WeakMap<HTMLElement, LayoutMode>();
  const getText = (element: HTMLElement) => {
    const cached = textCache.get(element);
    if (cached !== undefined) return cached;
    const text = extractParagraphText(element);
    textCache.set(element, text);
    return text;
  };
  const getLayout = (element: HTMLElement) => {
    const cached = layoutCache.get(element);
    if (cached !== undefined) return cached;
    const layout = determineLayout(element);
    layoutCache.set(element, layout);
    return layout;
  };
  const filtered = unique.filter((element) => {
    if (!element.isConnected) return false;
    if (element.closest('.ot-paragraph-translation, .ot-inline-translation')) {
      return false;
    }
    const text = getText(element);
    if (!text) return false;

    const layout = getLayout(element);

    if (layout === 'inline') {
      // Prefer translating the surrounding block when it carries additional text
      // so linked words don't split a full sentence into fragments. Skip wrapper
      // blocks that only aggregate multiple blocks (e.g., nav containers).
      const isNavigationLink = Boolean(
        element.tagName === 'A' &&
          element.closest('nav, [role="navigation"], menu'),
      );
      const hasTextRichBlockAncestor = unique.some((other) => {
        if (other === element || !other.contains(element)) return false;
        if (getLayout(other) !== 'block') return false;
        const parentText = getText(other);
        if (!parentText) return false;
        const hasNestedBlockCandidate = unique.some(
          (nested) =>
            nested !== other &&
            other.contains(nested) &&
            getLayout(nested) === 'block',
        );
        if (hasNestedBlockCandidate) return false;
        return parentText.length > text.length;
      });
      if (hasTextRichBlockAncestor && !isNavigationLink) {
        return false;
      }
    }

    if (layout === 'block') {
      // Avoid duplicating translation when a block only wraps a single inline node.
      const inlineChildren = unique.filter(
        (other) =>
          other !== element &&
          element.contains(other) &&
          getLayout(other) === 'inline',
      );
      if (inlineChildren.length === 1 && getText(inlineChildren[0]) === text) {
        return false;
      }
    }

    const hasChildBlockCandidate = unique.some(
      (other) =>
        other !== element &&
        element.contains(other) &&
        getLayout(other) === 'block',
    );
    return !hasChildBlockCandidate;
  });
  return filtered;
}

function extractParagraphText(element: HTMLElement): string {
  return element.innerText.replace(/\s+/g, ' ').trim();
}

function determineLayout(element: HTMLElement): LayoutMode {
  const display = window.getComputedStyle(element).display;
  if (INLINE_TAGS.has(element.tagName) || INLINE_DISPLAY_VALUES.has(display)) {
    return 'inline';
  }
  return 'block';
}

function ensureTranslationContainer(
  element: HTMLElement,
  layout: LayoutMode,
  existing?: HTMLElement | null,
): HTMLElement {
  const targetClass =
    layout === 'inline' ? 'ot-inline-translation' : 'ot-paragraph-translation';
  if (existing?.isConnected && existing.classList.contains(targetClass)) {
    existing.dataset.otLayout = layout;
    applySourceColor(existing, element);
    syncTextStyles(existing, element);
    ensureBreak(existing, layout);
    ensureTranslationContent(existing, layout, element);
    return existing;
  }
  const found = findDirectChild(element, targetClass);
  if (found) {
    found.dataset.otLayout = layout;
    applySourceColor(found, element);
    syncTextStyles(found, element);
    ensureBreak(found, layout);
    ensureTranslationContent(found, layout, element);
    return found;
  }
  const node = document.createElement('span');
  node.className = `${targetClass} notranslate`;
  node.dataset.otLayout = layout;
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('role', 'note');
  node.textContent = '';
  element.appendChild(node);
  applySourceColor(node, element);
  syncTextStyles(node, element);
  ensureBreak(node, layout);
  ensureTranslationContent(node, layout, element);
  return node;
}

function findDirectChild(
  element: HTMLElement,
  targetClass: string,
): HTMLElement | null {
  const children = Array.from(element.children);
  for (const child of children) {
    if (child instanceof HTMLElement && child.classList.contains(targetClass)) {
      return child;
    }
  }
  return null;
}

function applySourceColor(block: HTMLElement, element: HTMLElement) {
  const color = window.getComputedStyle(element).color;
  if (color) {
    block.style.setProperty(SOURCE_COLOR_VAR, color);
  } else {
    block.style.removeProperty(SOURCE_COLOR_VAR);
  }
}

function syncTextStyles(target: HTMLElement, source: HTMLElement) {
  const style = window.getComputedStyle(source);
  target.style.fontFamily = style.fontFamily;
  target.style.fontSize = style.fontSize;
  target.style.fontWeight = style.fontWeight;
  target.style.lineHeight = style.lineHeight;
  target.style.fontStyle = style.fontStyle;
  target.style.letterSpacing = style.letterSpacing;
  target.style.textAlign = style.textAlign;
  target.style.color = style.color || '';
  target.style.whiteSpace = style.whiteSpace;
}

function ensureTranslationContent(
  container: HTMLElement,
  layout: LayoutMode,
  source: HTMLElement,
): HTMLElement {
  let content = container.querySelector<HTMLElement>(`.${CONTENT_CLASS}`);
  if (!content) {
    content = document.createElement('span');
    content.className = `${CONTENT_CLASS} notranslate`;
    container.appendChild(content);
  }
  content.dataset.otLayout = layout;
  syncTextStyles(content, source);
  return content;
}

function ensureBreak(container: HTMLElement, layout: LayoutMode) {
  const existing = container.querySelector<HTMLElement>(`.${BREAK_CLASS}`);
  if (layout === 'block') {
    if (!existing) {
      const br = document.createElement('br');
      br.className = BREAK_CLASS;
      br.ariaHidden = 'true';
      container.prepend(br);
    }
  } else if (existing) {
    existing.remove();
  }
}

function resetExistingTranslations() {
  document
    .querySelectorAll<HTMLElement>(
      '.ot-translation-block, .ot-paragraph-translation, .ot-inline-translation',
    )
    .forEach((node) => node.remove());
  document
    .querySelectorAll<HTMLElement>(`[${TRANSLATED_ATTRIBUTE}]`)
    .forEach((element) => {
      element.removeAttribute(TRANSLATED_ATTRIBUTE);
      delete (element.dataset as Record<string, string | undefined>)[
        TRANSLATED_DATA_KEY
      ];
    });
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ot-paragraph-translation,
    .ot-inline-translation {
      font-family: inherit;
      font-weight: inherit;
      font-size: inherit;
      line-height: inherit;
      color: var(${SOURCE_COLOR_VAR}, inherit);
      background: none;
      border: none;
      border-radius: 0;
      padding: 0;
      margin: 0;
    }
    .ot-paragraph-translation *,
    .ot-inline-translation * {
      font: inherit;
      line-height: inherit;
      color: inherit;
    }
    .${BREAK_CLASS} {
      display: block;
      line-height: inherit;
    }
    .${CONTENT_CLASS} {
      display: inline;
      font: inherit;
      line-height: inherit;
      color: inherit;
      white-space: inherit;
    }
    .ot-paragraph-translation {
      display: inline;
      margin-top: 0;
    }
    .ot-inline-translation {
      display: inline;
      margin-left: 0.25em;
    }
    .ot-translation-error {
      color: #7f1d1d !important;
      background: none !important;
      border: none !important;
    }
    .ot-loading {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 999px;
      animation: ot-spin 0.8s linear infinite;
      vertical-align: middle;
    }
    @keyframes ot-spin {
      to {
        transform: rotate(360deg);
      }
    }
    .ot-toast {
      position: fixed;
      top: 24px;
      right: 24px;
      padding: 12px 16px;
      background: #0f172a;
      color: #fff;
      border-radius: 999px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
      z-index: 2147483647;
      font-size: 0.9rem;
      transition: opacity 0.2s ease;
    }
  `;
  document.head.appendChild(style);
}

let toastTimer: number | null = null;
function showToast(message: string, duration = 3000) {
  const existing = document.querySelector('.ot-toast');
  const toast =
    existing instanceof HTMLElement
      ? existing
      : Object.assign(document.createElement('div'), {
          className: 'ot-toast',
        });
  toast.textContent = message;
  if (!existing) {
    document.body.appendChild(toast);
  }
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toast.style.opacity = '1';
  toastTimer = window.setTimeout(() => {
    toast.style.opacity = '0';
    toastTimer = window.setTimeout(() => toast.remove(), 300);
  }, duration);
}

function setLoadingState(container: HTMLElement) {
  container.classList.remove('ot-translation-error');
  container.setAttribute('aria-busy', 'true');
  const content = ensureTranslationContent(
    container,
    (container.dataset.otLayout as LayoutMode) || 'block',
    container.parentElement || container,
  );
  content.textContent = '';
  const spinner =
    content.querySelector<HTMLElement>('.ot-loading') ??
    Object.assign(document.createElement('span'), {
      className: 'ot-loading',
      ariaHidden: 'true',
    });
  if (!spinner.isConnected) {
    content.appendChild(spinner);
  }
}
