/**
 * Lightweight, client-side feature flag registry for staged rollouts.
 *
 * Resolution order (first wins):
 *   1. localStorage override:  `ff:<key>` = "on" | "off"
 *      (set via `setFeatureFlagOverride` or `window.__ff.set('key','on')`)
 *   2. Environment variable:   `import.meta.env.VITE_FF_<KEY>` = "on" | "off"
 *      where KEY is the flag key uppercased and `-`/`.` replaced with `_`.
 *   3. The `defaultEnabled` value declared in `FEATURE_FLAGS`.
 *
 * Flags are intentionally kept in a single registry so additions are
 * grep-able and the default-state is auditable in code review.
 *
 * NOTE: This is a presentation-layer toggle. It is NOT an authorisation
 * boundary — never use it to gate security-sensitive behaviour.
 */

export type FeatureFlagKey = "wad.statusSpecificAttestationCopy";

interface FeatureFlagDef {
  /** Stable key used everywhere (also the localStorage suffix). */
  key: FeatureFlagKey;
  /** Short human description for changelog / debug panel. */
  description: string;
  /** Default state when no override / env value is present. */
  defaultEnabled: boolean;
}

export const FEATURE_FLAGS: Record<FeatureFlagKey, FeatureFlagDef> = {
  "wad.statusSpecificAttestationCopy": {
    key: "wad.statusSpecificAttestationCopy",
    description:
      "Show status-specific attestation next-action copy (awaiting / sealed / draft) " +
      "instead of generic buyer/seller-signatory text.",
    defaultEnabled: false,
  },
};

const STORAGE_PREFIX = "ff:";

function envKey(key: FeatureFlagKey): string {
  return `VITE_FF_${key.toUpperCase().replace(/[-.]/g, "_")}`;
}

function readEnv(key: FeatureFlagKey): boolean | null {
  try {
    // import.meta.env values are baked at build time.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const raw = env?.[envKey(key)];
    if (raw == null) return null;
    const v = String(raw).trim().toLowerCase();
    if (v === "on" || v === "true" || v === "1") return true;
    if (v === "off" || v === "false" || v === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function readOverride(key: FeatureFlagKey): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (raw == null) return null;
    const v = raw.trim().toLowerCase();
    if (v === "on" || v === "true" || v === "1") return true;
    if (v === "off" || v === "false" || v === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  const override = readOverride(key);
  if (override !== null) return override;
  const fromEnv = readEnv(key);
  if (fromEnv !== null) return fromEnv;
  return FEATURE_FLAGS[key]?.defaultEnabled ?? false;
}

export function setFeatureFlagOverride(
  key: FeatureFlagKey,
  value: boolean | null
): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    } else {
      window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value ? "on" : "off");
    }
    window.dispatchEvent(new CustomEvent("feature-flags:changed", { detail: { key } }));
  } catch {
    /* storage unavailable — ignore */
  }
}

export function listFeatureFlags(): Array<{
  key: FeatureFlagKey;
  description: string;
  defaultEnabled: boolean;
  envValue: boolean | null;
  override: boolean | null;
  effective: boolean;
}> {
  return (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).map((key) => ({
    key,
    description: FEATURE_FLAGS[key].description,
    defaultEnabled: FEATURE_FLAGS[key].defaultEnabled,
    envValue: readEnv(key),
    override: readOverride(key),
    effective: isFeatureEnabled(key),
  }));
}

// Dev-mode helper exposed on `window.__ff` for QA / staged rollout toggling.
// Safe to leave in production: only flips presentation flags.
if (typeof window !== "undefined") {
  (window as unknown as { __ff?: unknown }).__ff = {
    list: listFeatureFlags,
    get: isFeatureEnabled,
    set: (key: FeatureFlagKey, value: boolean | null) =>
      setFeatureFlagOverride(key, value),
    reset: (key: FeatureFlagKey) => setFeatureFlagOverride(key, null),
  };
}
