/** Tiny typed i18n: English is the source of keys; Portuguese must translate every key. */
import { useCallback } from 'react';
import { type Language, useSettings } from '../state/settings.ts';
import { en } from './en.ts';
import { pt } from './pt.ts';

export type TKey = keyof typeof en;
export type Vars = Record<string, string | number>;
export type Translate = (key: TKey, vars?: Vars) => string;

const dictionaries: Record<Language, Record<TKey, string>> = { en, pt };

export function translate(language: Language, key: TKey, vars?: Vars): string {
  const text = dictionaries[language][key] ?? en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : text;
}

export function useT(): Translate {
  const language = useSettings((s) => s.language);
  return useCallback((key: TKey, vars?: Vars) => translate(language, key, vars), [language]);
}

export function useLanguage(): Language {
  return useSettings((s) => s.language);
}

/** Picks the right string from a { en, pt } pair. */
export function useLocalized(): (value: { en: string; pt: string }) => string {
  const language = useLanguage();
  return useCallback((value) => value[language], [language]);
}
