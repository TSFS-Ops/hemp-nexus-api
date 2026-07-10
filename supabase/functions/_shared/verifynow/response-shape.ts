/**
 * Batch V — Redacted response-shape summariser.
 *
 * Produces a *values-free* description of an arbitrary JSON-ish value so
 * we can diagnose why the VerifyNow classifier saw an unrecognised body
 * WITHOUT ever persisting or logging the actual provider values (which
 * may contain identity numbers, names, DoBs, addresses, phone/email,
 * document numbers, tokens, or API-key echoes).
 *
 * Contract:
 *  - Only structural information is retained: key names, primitive
 *    value TYPES ("string" | "number" | "boolean" | "null"), and
 *    array/object indicators (with array length + element-type summary).
 *  - No primitive VALUES are ever included in the output.
 *  - Key names themselves are kept because they are the diagnostic
 *    signal we need (they tell us whether VerifyNow's response uses
 *    `verified`/`result`/`data.*` instead of the `match`/`status` our
 *    classifier recognises).
 *  - Recursion is bounded (depth <= 4, per-object key cap = 50) to
 *    keep the payload small and to defuse pathological inputs.
 *  - Non-JSON / non-object inputs return a safe descriptor.
 */

export type ShapeSummary =
  | { kind: "null" }
  | { kind: "primitive"; type: "string" | "number" | "boolean" }
  | { kind: "array"; length: number; element_types: string[]; truncated?: boolean }
  | { kind: "object"; keys: Record<string, ShapeSummary>; truncated?: boolean }
  | { kind: "non_json"; note: string };

const MAX_DEPTH = 4;
const MAX_KEYS_PER_OBJECT = 50;
const MAX_ARRAY_SAMPLE = 10;

export function summariseResponseShape(input: unknown, depth = 0): ShapeSummary {
  if (input === null) return { kind: "null" };
  const t = typeof input;
  if (t === "string" || t === "number" || t === "boolean") {
    return { kind: "primitive", type: t as "string" | "number" | "boolean" };
  }
  if (t === "undefined") return { kind: "non_json", note: "undefined" };
  if (t === "function" || t === "symbol" || t === "bigint") {
    return { kind: "non_json", note: t };
  }

  if (depth >= MAX_DEPTH) {
    return { kind: "non_json", note: "max_depth" };
  }

  if (Array.isArray(input)) {
    const sample = input.slice(0, MAX_ARRAY_SAMPLE);
    const types = new Set<string>();
    for (const el of sample) {
      const sub = summariseResponseShape(el, depth + 1);
      types.add(sub.kind === "primitive" ? sub.type : sub.kind);
    }
    return {
      kind: "array",
      length: input.length,
      element_types: [...types].sort(),
      truncated: input.length > MAX_ARRAY_SAMPLE || undefined,
    };
  }

  if (t === "object") {
    const rec = input as Record<string, unknown>;
    const allKeys = Object.keys(rec);
    const keys = allKeys.slice(0, MAX_KEYS_PER_OBJECT);
    const out: Record<string, ShapeSummary> = {};
    for (const k of keys) {
      out[k] = summariseResponseShape(rec[k], depth + 1);
    }
    return {
      kind: "object",
      keys: out,
      truncated: allKeys.length > MAX_KEYS_PER_OBJECT || undefined,
    };
  }

  return { kind: "non_json", note: "unknown" };
}
