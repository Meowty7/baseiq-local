import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isLang, type Lang } from "./langs";
import { STRINGS, type StringKey } from "./strings";
import { QUESTIONS, setQuestionOverlay } from "./questions";
import { translateBatch, unloadTranslator } from "../lib/qvac";

export { LANGS, LANG_CODES, LANG_PICKER_LABELS, isLang, localeFor, type Lang } from "./langs";
export { getQuestion, QUESTIONS, QUESTION_FIELDS } from "./questions";
export { STRINGS, type StringKey } from "./strings";

export type Vars = Record<string, string | number>;
export type TranslateFn = (key: string, vars?: Vars) => string;

const CACHE_VERSION = 1;
const stringOverlay: Record<string, Record<string, string>> = {};
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeI18n(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (
    vars[name] != null ? String(vars[name]) : whole
  ));
}

function lookup(key: string, lang: string): string {
  return stringOverlay[lang]?.[key]
    ?? (STRINGS as Record<string, Record<string, string>>)[lang]?.[key]
    ?? STRINGS.en[key as StringKey]
    ?? STRINGS.es[key as StringKey]
    ?? key;
}

export function t(key: string, lang: string, vars?: Vars): string {
  return interpolate(lookup(key, lang), vars);
}

export function modalityLabels(lang: string): Record<string, string> {
  return {
    resonador: t("modality.resonador", lang),
    tomografo: t("modality.tomografo", lang),
    ecografo: t("modality.ecografo", lang),
    "rayos-x": t("modality.rayos-x", lang),
    mamografo: t("modality.mamografo", lang),
    otra: t("modality.otra", lang),
  };
}

export function statusLabels(lang: string): Record<string, string> {
  return {
    Confirmado: t("status.Confirmado", lang),
    Reportado: t("status.Reportado", lang),
    Estimado: t("status.Estimado", lang),
    Desconocido: t("status.Desconocido", lang),
  };
}

export function freshnessLabel(value: string, lang: string): string {
  const key = value === "por verificar" ? "freshness.por_verificar" : `freshness.${value.replace(/ /g, "_")}`;
  const out = t(key, lang);
  return out === key ? value : out;
}

function protect(s: string): { text: string; slots: string[] } {
  const slots: string[] = [];
  const text = s.replace(/\{(\w+)\}/g, (_, name: string) => {
    const i = slots.length;
    slots.push(name);
    return `⟦${i}⟧`;
  });
  return { text, slots };
}

function unprotect(s: string, slots: string[]): string {
  return s.replace(/⟦\s*(\d+)\s*⟧/g, (whole, n: string) => {
    const name = slots[Number(n)];
    return name ? `{${name}}` : whole;
  });
}

async function cacheFile(lang: string): Promise<string | null> {
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const root = FileSystem.documentDirectory;
    if (!root) return null;
    const dir = `${root}i18n`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    return `${dir}/${lang}.json`;
  } catch {
    return null;
  }
}

async function readCache(lang: string): Promise<{ strings: Record<string, string>; questions: Record<string, string> } | null> {
  const path = await cacheFile(lang);
  if (!path) return null;
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as { v?: number; strings?: Record<string, string>; questions?: Record<string, string> };
    if (parsed.v !== CACHE_VERSION || !parsed.strings || !parsed.questions) return null;
    return { strings: parsed.strings, questions: parsed.questions };
  } catch {
    return null;
  }
}

async function writeCache(lang: string, payload: { strings: Record<string, string>; questions: Record<string, string> }): Promise<void> {
  const path = await cacheFile(lang);
  if (!path) return;
  try {
    const FileSystem = await import("expo-file-system/legacy");
    await FileSystem.writeAsStringAsync(path, JSON.stringify({ v: CACHE_VERSION, ...payload }));
  } catch {
    /* tests / missing FS */
  }
}

function applyOverlay(lang: string, strings: Record<string, string>, questions: Record<string, string>): void {
  stringOverlay[lang] = strings;
  setQuestionOverlay(lang, questions);
}

/** Translate EN UI + questions into L via TranslatePsy, cache on disk. ES/EN are handwritten. */
export async function localizeUi(lang: string, onProgress?: (pct: number) => void): Promise<void> {
  if (!isLang(lang) || lang === "es" || lang === "en") {
    onProgress?.(100);
    return;
  }
  if (stringOverlay[lang] && Object.keys(stringOverlay[lang]).length > 0) {
    onProgress?.(100);
    return;
  }
  const cached = await readCache(lang);
  if (cached) {
    applyOverlay(lang, cached.strings, cached.questions);
    notify();
    onProgress?.(100);
    return;
  }

  onProgress?.(8);
  const keys = Object.keys(STRINGS.en) as StringKey[];
  const qKeys = Object.keys(QUESTIONS.en);
  const protectedStrings = keys.map((k) => protect(STRINGS.en[k]));
  const protectedQuestions = qKeys.map((k) => protect(QUESTIONS.en[k]));
  const texts = [...protectedStrings.map((p) => p.text), ...protectedQuestions.map((p) => p.text)];
  const batch = await translateBatch("en", lang, texts, 180000, onProgress);
  if (!batch || batch.translations.length !== texts.length) {
    console.warn(`▸ i18n localizeUi failed for ${lang}`);
    return;
  }
  const strings: Record<string, string> = {};
  keys.forEach((k, i) => { strings[k] = unprotect(batch.translations[i], protectedStrings[i].slots); });
  const questions: Record<string, string> = {};
  qKeys.forEach((k, i) => { questions[k] = unprotect(batch.translations[keys.length + i], protectedQuestions[i].slots); });
  applyOverlay(lang, strings, questions);
  await writeCache(lang, { strings, questions });
  notify();
  await unloadTranslator("en", lang);
  onProgress?.(100);
}

interface I18nContextValue {
  lang: Lang;
  localizing: boolean;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ lang, localizing = false, children }: { lang: Lang; localizing?: boolean; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeI18n(() => setTick((n) => n + 1)), []);
  const value = useMemo<I18nContextValue>(() => ({
    lang,
    localizing,
    t: (key, vars) => t(key, lang, vars),
  }), [lang, localizing, tick]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
