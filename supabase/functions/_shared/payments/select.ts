/**
 * Provider registry / selector — Phase 1 (PayFast-readiness scaffolding).
 *
 * Single source of truth for which payment providers exist in this
 * build. Paystack is registered and live. PayFast is intentionally
 * NOT registered in Phase 1 — Phase 2 will add it as a sandbox-only
 * provider before any live wiring.
 *
 * This module is import-safe in both Deno (edge functions) and Node
 * (Vitest) — it has no runtime side effects and no env lookups.
 */
import type { PaymentProvider, PaymentProviderId } from "./provider.ts";
import { PAYSTACK_PROVIDER } from "./paystack.ts";

// Phase 2B note: the PayFast descriptor exists in `./payfast.ts` (the
// sandbox ITN edge function imports it directly), but it is NOT
// registered here. Keeping `payfast: undefined` means any code path
// that resolves a "live customer-facing provider" via this registry
// still fails loudly for PayFast, which is the Phase 2B contract:
// no customer-facing PayFast checkout yet.
const REGISTRY: Record<PaymentProviderId, PaymentProvider | undefined> = {
  paystack: PAYSTACK_PROVIDER,
  payfast: undefined,
};

/**
 * Returns the registered provider for `id`, or throws if the provider
 * is not registered in this build. Callers (Phase 2+) should treat the
 * throw as a wiring bug, not a user-input error.
 */
export function selectProvider(id: PaymentProviderId): PaymentProvider {
  const provider = REGISTRY[id];
  if (!provider) {
    throw new Error(
      `[payments] provider "${id}" is not registered in this build. ` +
        `Paystack is the only live provider in Phase 1; PayFast lands in Phase 2.`,
    );
  }
  return provider;
}

/**
 * Returns the default provider for new customer-facing checkouts.
 * Phase 1: Paystack. Phase 2/3 may switch this based on org currency
 * preference, but ONLY behind a feature flag and ONLY after PayFast
 * has been proven in sandbox.
 */
export function defaultProvider(): PaymentProvider {
  return PAYSTACK_PROVIDER;
}

/** Returns every provider currently registered as live. */
export function listLiveProviders(): PaymentProvider[] {
  return Object.values(REGISTRY).filter(
    (p): p is PaymentProvider => Boolean(p?.liveEnabled),
  );
}
