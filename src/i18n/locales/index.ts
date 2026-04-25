/**
 * Translation catalogue type + locale registry.
 *
 * The `en` catalogue is the source of truth — every key MUST exist there.
 * Other locales are `Partial<Catalog>` so translation can roll out
 * incrementally without breaking the build (missing keys fall back to `en`).
 *
 * Convention: keys are dot-namespaced. The `wad.attest.*` namespace owns
 * all attestation-flow strings; future surfaces should claim their own
 * namespace (`auth.*`, `match.*`, etc.).
 */

import { en } from "./en";

export const DEFAULT_LOCALE = "en" as const;

export type Catalog = typeof en;
export type TranslationKey = keyof Catalog;

export const CATALOGS = {
  en,
  // Add future locales here, e.g.:
  // af: () => import("./af").then(m => m.af),
  // zu: () => import("./zu").then(m => m.zu),
} as const;

export type Locale = keyof typeof CATALOGS;
