import { useEffect, useState, useCallback } from "react";
import {
  t as translate,
  getLocale,
  setLocale as setLocaleGlobal,
  type Locale,
  type TranslationKey,
} from "@/i18n";

/**
 * React binding for the i18n module. Re-renders when the active locale
 * changes (via `setLocale` in any component).
 */
export function useTranslation() {
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ locale: Locale }>).detail;
      if (detail?.locale) setLocaleState(detail.locale);
    };
    window.addEventListener("i18n:localechange", handler as EventListener);
    return () =>
      window.removeEventListener(
        "i18n:localechange",
        handler as EventListener
      );
  }, []);

  // `locale` is captured so memoised consumers re-render on language change.
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(key, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale]
  );

  return { t, locale, setLocale: setLocaleGlobal };
}
