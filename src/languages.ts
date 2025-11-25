export type LanguageOption = {
  value: string;
  label: string;
};

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'English', label: 'English' },
  { value: 'Chinese (Simplified)', label: '简体中文' },
  { value: 'Chinese (Traditional)', label: '繁體中文' },
  { value: 'Japanese', label: '日本語' },
  { value: 'Korean', label: '한국어' },
  { value: 'Spanish', label: 'Español' },
  { value: 'French', label: 'Français' },
  { value: 'German', label: 'Deutsch' },
];

export const DEFAULT_LANGUAGE_PAIR = {
  fromLang: 'auto',
  toLang: 'Chinese (Simplified)',
};

export function getLanguageLabel(value: string): string {
  return LANGUAGE_OPTIONS.find((lng) => lng.value === value)?.label ?? value;
}
