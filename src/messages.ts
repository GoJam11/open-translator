import type { LanguagePair, TranslationJobRequest, TranslationResponse } from './types';

export type RuntimeMessage =
  | {
      type: 'start-translation';
      payload: LanguagePair;
    }
  | {
    type: 'translate-paragraphs';
    payload: TranslationJobRequest;
  };

export type RuntimeResponse =
  | { ok: true; data?: TranslationResponse }
  | { ok: false; error: string };
