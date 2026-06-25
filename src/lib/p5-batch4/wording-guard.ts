/**
 * P-5 Batch 4 — Wording guard (pure).
 *
 * Provider-dependent records must never render as
 * "verified" / "compliant" / "bankable" / "live-provider verified".
 * The list of forbidden words comes from the Stage 1 SSOT.
 */
import { P5B4_FORBIDDEN_PROVIDER_WORDS } from "./constants";

export interface P5B4WordingScan {
  ok: boolean;
  matches: string[];
}

export function scanForbidden(text: string | null | undefined): P5B4WordingScan {
  if (!text) return { ok: true, matches: [] };
  const lower = text.toLowerCase();
  const matches = P5B4_FORBIDDEN_PROVIDER_WORDS.filter((w) => lower.includes(w));
  return { ok: matches.length === 0, matches: [...matches] };
}

/** Throws if any forbidden word appears. Use in tests + guards, not at runtime. */
export function assertSafeWording(text: string, ctx: string): void {
  const r = scanForbidden(text);
  if (!r.ok) {
    throw new Error(`P5B4 forbidden wording in ${ctx}: ${r.matches.join(", ")}`);
  }
}

/** Safe label for provider-dependent rendering. */
export const P5B4_PROVIDER_DEPENDENT_SAFE_LABEL = "Provider-Dependent";
