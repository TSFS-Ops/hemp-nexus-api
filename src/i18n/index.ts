/**
 * Minimal i18n primitives.
 *
 * Goals:
 *  - Centralise user-facing strings so they can be translated later.
 *  - Zero runtime deps (no i18next), tree-shakeable, type-safe keys.
 *  - Support {placeholder} interpolation and a simple {count, plural} form.
 *  - Fall through unknown locales to `en` so missing translations never
 *    render an empty string.
 *
 * To add a new locale: create `src/i18n/locales/<code>.ts` exporting a
 * `Partial<Catalog>` and register it in `src/i18n/locales/index.ts`.
 */

import type { Catalog, TranslationKey } from "./locales";
import { CATALOGS, DEFAULT_LOCALE, type Locale } from "./locales";

const LOCALE_STORAGE_KEY = "locale";

let activeLocale: Locale = DEFAULT_LOCALE;

function pickInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && stored in CATALOGS) return stored as Locale;
  } catch {
    /* storage unavailable */
  }
  const nav =
    typeof navigator !== "undefined" ? navigator.language?.toLowerCase() : "";
  if (nav) {
    // exact match, then language-only match (e.g. "en-GB" -> "en")
    if (nav in CATALOGS) return nav as Locale;
    const base = nav.split("-")[0];
    if (base in CATALOGS) return base as Locale;
  }
  return DEFAULT_LOCALE;
}

activeLocale = pickInitialLocale();

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(locale: Locale): void {
  if (!(locale in CATALOGS)) return;
  activeLocale = locale;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent("i18n:localechange", { detail: { locale } })
    );
  }
}

function lookup(locale: Locale, key: TranslationKey): string | undefined {
  const cat = CATALOGS[locale] as Partial<Catalog> | undefined;
  return cat?.[key];
}

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  // Handle {count, plural, one {…} other {…}} (very small subset of ICU).
  let out = template.replace(
    /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
    (_, name: string, one: string, other: string) => {
      const n = Number(params[name] ?? 0);
      return n === 1 ? one : other;
    }
  );
  // Then plain {placeholder} substitution.
  out = out.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`
  );
  return out;
}

/**
 * Translate a key with optional params. Falls back through:
 * active locale → default locale (`en`) → the key itself (so missing
 * translations are visible during development).
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const template =
    lookup(activeLocale, key) ?? lookup(DEFAULT_LOCALE, key) ?? key;
  return format(template, params);
}

export type { Locale, TranslationKey };
