export const LANGS = [
  { code: "es", nativeName: "Español", flag: "🇪🇸", locale: "es" },
  { code: "pt", nativeName: "Português", flag: "🇵🇹", locale: "pt" },
  { code: "en", nativeName: "English", flag: "🇬🇧", locale: "en" },
  { code: "fr", nativeName: "Français", flag: "🇫🇷", locale: "fr" },
  { code: "de", nativeName: "Deutsch", flag: "🇩🇪", locale: "de" },
  { code: "it", nativeName: "Italiano", flag: "🇮🇹", locale: "it" },
  { code: "nl", nativeName: "Nederlands", flag: "🇳🇱", locale: "nl" },
  { code: "pl", nativeName: "Polski", flag: "🇵🇱", locale: "pl" },
  { code: "ro", nativeName: "Română", flag: "🇷🇴", locale: "ro" },
  { code: "cs", nativeName: "Čeština", flag: "🇨🇿", locale: "cs" },
  { code: "sv", nativeName: "Svenska", flag: "🇸🇪", locale: "sv" },
  { code: "da", nativeName: "Dansk", flag: "🇩🇰", locale: "da" },
  { code: "ru", nativeName: "Русский", flag: "🇷🇺", locale: "ru" },
  { code: "tr", nativeName: "Türkçe", flag: "🇹🇷", locale: "tr" },
  { code: "ar", nativeName: "العربية", flag: "🇸🇦", locale: "ar" },
  { code: "zh", nativeName: "中文", flag: "🇨🇳", locale: "zh-CN" },
  { code: "ja", nativeName: "日本語", flag: "🇯🇵", locale: "ja" },
  { code: "ko", nativeName: "한국어", flag: "🇰🇷", locale: "ko" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];

export const LANG_CODES: Lang[] = LANGS.map((l) => l.code);

const LANG_SET = new Set<string>(LANG_CODES);

export function isLang(value: string): value is Lang {
  return LANG_SET.has(value);
}

export function localeFor(lang: string): string {
  return LANGS.find((l) => l.code === lang)?.locale ?? "en";
}

export const LANG_PICKER_LABELS: Record<string, string> = Object.fromEntries(
  LANGS.map((l) => [l.code, `${l.flag} ${l.nativeName}`]),
);
