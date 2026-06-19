/**
 * Evidence-pack SHA-256 sealing — Facilitation Batch 10.
 *
 * Pure helper. No external dependencies. Web Crypto only.
 *
 * The seal is computed over a *canonical JSON* serialisation of the pack body
 * (deterministic key ordering, no trailing whitespace, UTF-8), NOT over the
 * sealed envelope itself. That way the digest can be independently recomputed
 * by anyone who has the pack object.
 *
 * Imported by:
 *   - supabase/functions/facilitation-export-evidence-pack/index.ts
 *   - src/tests/facilitation-batch10-evidence-pack-seal.test.ts (vitest)
 *
 * MUST NOT mutate the input pack.
 * MUST NOT perform any network or storage I/O.
 */

export const SEAL_ALGO = "sha-256" as const;
export const SEAL_FUNCTION_VERSION = "facilitation-export-evidence-pack@batch-10" as const;

export type EvidencePackSeal = {
  algo: typeof SEAL_ALGO;
  digest_hex: string;          // 64 hex chars
  canonical_bytes: number;     // length of canonical JSON in UTF-8 bytes
  sealed_at: string;           // ISO-8601 UTC
  function_version: string;    // pinned identifier of the producing function
};

export type SealedEvidencePack<T = unknown> = {
  pack: T;
  seal: EvidencePackSeal;
};

/**
 * Deterministic JSON serialiser.
 *
 * Rules:
 *   - object keys are sorted lexicographically at every level;
 *   - arrays preserve their order;
 *   - `undefined` properties are dropped (matches JSON.stringify);
 *   - `null` is kept;
 *   - numbers / strings / booleans serialise via JSON.stringify;
 *   - no whitespace, no trailing newline;
 *   - cycles throw.
 *
 * NOTE: an empty array `[]` and a missing field produce DIFFERENT canonical
 * strings (the missing field is simply absent, the empty array becomes `[]`),
 * so their digests differ — this is asserted by the test suite.
 */
export function canonicalJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const enc = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("canonicalJsonStringify: non-finite number");
      return JSON.stringify(v);
    }
    if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "bigint") throw new Error("canonicalJsonStringify: bigint not supported");
    if (typeof v === "undefined" || typeof v === "function" || typeof v === "symbol") {
      // Mirrors JSON.stringify: these are dropped at the object-property level
      // (handled by the caller). At top level we encode them as `null` to keep
      // the result deterministic.
      return "null";
    }
    if (Array.isArray(v)) {
      if (seen.has(v)) throw new Error("canonicalJsonStringify: cycle detected");
      seen.add(v);
      const parts = v.map((item) => {
        if (typeof item === "undefined" || typeof item === "function" || typeof item === "symbol") {
          return "null";
        }
        return enc(item);
      });
      seen.delete(v);
      return "[" + parts.join(",") + "]";
    }
    if (typeof v === "object") {
      if (seen.has(v as object)) throw new Error("canonicalJsonStringify: cycle detected");
      seen.add(v as object);
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const child = obj[k];
        if (typeof child === "undefined" || typeof child === "function" || typeof child === "symbol") continue;
        parts.push(JSON.stringify(k) + ":" + enc(child));
      }
      seen.delete(v as object);
      return "{" + parts.join(",") + "}";
    }
    throw new Error("canonicalJsonStringify: unsupported value");
  };

  return enc(value);
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16);
    out += h.length === 1 ? "0" + h : h;
  }
  return out;
}

/**
 * Compute the SHA-256 digest of a canonical JSON pack body.
 *
 * Returns { digest_hex, canonical_bytes } so callers can populate the
 * EvidencePackSeal record without re-canonicalising.
 */
export async function sha256OfCanonicalPack(pack: unknown): Promise<{ digest_hex: string; canonical_bytes: number; canonical: string }> {
  const canonical = canonicalJsonStringify(pack);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { digest_hex: toHex(digest), canonical_bytes: bytes.byteLength, canonical };
}

/**
 * Build a sealed envelope around the given pack body. The pack object is
 * passed through unchanged; only the surrounding envelope is new.
 */
export async function sealEvidencePack<T>(
  pack: T,
  opts?: { function_version?: string; now?: () => Date },
): Promise<SealedEvidencePack<T>> {
  const { digest_hex, canonical_bytes } = await sha256OfCanonicalPack(pack);
  const now = (opts?.now ?? (() => new Date()))();
  const seal: EvidencePackSeal = {
    algo: SEAL_ALGO,
    digest_hex,
    canonical_bytes,
    sealed_at: now.toISOString(),
    function_version: opts?.function_version ?? SEAL_FUNCTION_VERSION,
  };
  return { pack, seal };
}

/**
 * Runtime shape check used by the seal-contract guard and by tests to
 * validate envelopes returned from the edge function.
 */
export function isEvidencePackSeal(v: unknown): v is EvidencePackSeal {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return s.algo === SEAL_ALGO
    && typeof s.digest_hex === "string"
    && /^[0-9a-f]{64}$/.test(s.digest_hex)
    && typeof s.canonical_bytes === "number"
    && Number.isInteger(s.canonical_bytes)
    && s.canonical_bytes > 0
    && typeof s.sealed_at === "string"
    && !Number.isNaN(Date.parse(s.sealed_at))
    && typeof s.function_version === "string"
    && s.function_version.length > 0;
}
