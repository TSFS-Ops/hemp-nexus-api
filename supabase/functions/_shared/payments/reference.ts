/**
 * Provider-reference helpers — Phase 1 (PayFast-readiness scaffolding).
 *
 * Today every paid checkout writes its provider reference into
 * `token_purchases.paystack_reference` and `audit_logs.metadata`
 * (under `payment_reference` / `reference`). That is fine while
 * Paystack is the only provider. PayFast (Phase 2) cannot reuse
 * `paystack_reference` semantically — it is a Paystack-specific
 * column name and a Paystack-formatted opaque string.
 *
 * This module defines the FORWARD-COMPATIBLE keys both providers
 * will read/write into `metadata` so PayFast rows can land without
 * a destructive rename of the historical column:
 *
 *   metadata.provider           – stable provider id ("paystack" | "payfast")
 *   metadata.provider_reference – the provider's opaque reference
 *
 * Paystack code already writes `metadata.provider: "paystack"` on
 * webhook init/finalise paths and the missing-metadata recovery path
 * already searches `metadata->>provider_reference` (see
 * `paystack-webhook-missing-metadata-containment.test.ts` and
 * `payment-metadata-recovery-payfast-ready.test.ts`). The helpers
 * below codify the read/write side so Phase 2 PayFast code and any
 * future provider stay consistent without copy-paste drift.
 *
 * IMPORTANT: these helpers are additive. `paystack_reference` stays
 * as the canonical column for Paystack rows. Nothing here renames,
 * drops or backfills the existing column — that is a Phase 2 DB
 * decision, not a Phase 1 code change.
 */
import type { PaymentProviderId } from "./provider.ts";

/** Canonical metadata keys used across all providers. */
export const PROVIDER_METADATA_KEYS = {
  provider: "provider",
  providerReference: "provider_reference",
} as const;

/**
 * Builds the metadata fragment every provider should merge into the
 * `audit_logs.metadata` / `token_purchases.metadata` blobs so the
 * provider identity and reference are queryable in a provider-agnostic
 * way.
 *
 * Example:
 *   metadata: { ...existing, ...buildProviderMetadata("paystack", ref) }
 *
 * Phase 1 callers are tests and future PayFast wiring only — the live
 * Paystack initiation path in `token-purchase/index.ts` already writes
 * `provider: "paystack"` inline and is not being rewired here.
 */
export function buildProviderMetadata(
  provider: PaymentProviderId,
  providerReference: string,
): Record<string, string> {
  if (!providerReference) {
    throw new Error("[payments] providerReference is required");
  }
  return {
    [PROVIDER_METADATA_KEYS.provider]: provider,
    [PROVIDER_METADATA_KEYS.providerReference]: providerReference,
  };
}

/**
 * Reads the provider reference from a metadata blob, preferring the
 * new provider-agnostic key but falling back to the legacy Paystack
 * keys (`payment_reference`, `reference`) so historical rows keep
 * resolving. Returns `null` when no reference can be found.
 *
 * This mirrors the OR clause used by the Paystack webhook missing-
 * metadata recovery path:
 *   metadata->>payment_reference.eq.X,
 *   metadata->>reference.eq.X,
 *   metadata->>provider_reference.eq.X
 */
export function readProviderReference(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const candidate =
    m[PROVIDER_METADATA_KEYS.providerReference] ??
    m["payment_reference"] ??
    m["reference"];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

/**
 * Reads the provider id from a metadata blob, defaulting to "paystack"
 * when absent so historical rows (which predate the explicit
 * `provider` field) continue to resolve as Paystack — which they were.
 *
 * This default is SAFE because PayFast is not live in Phase 1; the
 * earliest a row can carry `provider: "payfast"` is after Phase 2
 * ships. Any historical row without the field is, by construction,
 * a Paystack row.
 */
export function readProviderId(
  metadata: Record<string, unknown> | null | undefined,
): PaymentProviderId {
  if (metadata && typeof metadata === "object") {
    const raw = (metadata as Record<string, unknown>)[PROVIDER_METADATA_KEYS.provider];
    if (raw === "paystack" || raw === "payfast") return raw;
  }
  return "paystack";
}
