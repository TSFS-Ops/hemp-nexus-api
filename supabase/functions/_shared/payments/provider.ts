/**
 * Payment provider abstraction — Phase 1 (PayFast-readiness scaffolding).
 *
 * This module defines the *shape* a payment provider must satisfy so the
 * codebase can host more than one provider (Paystack today, PayFast next)
 * without rewriting `token-purchase/index.ts`, the wallet, the ledger,
 * the audit trail or the reconciliation cron.
 *
 * IMPORTANT — Phase 1 is scaffolding only:
 *   • Nothing here changes Paystack runtime behaviour.
 *   • Nothing here is wired into the live `token-purchase` request path.
 *   • The existing inline Paystack code in `token-purchase/index.ts`
 *     remains the source of truth for current production behaviour.
 *   • PayFast is NOT implemented in Phase 1 — only the slot for it exists.
 *
 * Phase 2 will plug a `PayfastProvider` into the same interface and a
 * separate `payfast-itn` edge function will mount it. The shared wallet,
 * `atomic_paid_credit_purchase` RPC, `token_ledger`, `audit_logs` and
 * `transaction-reconciliation` cron stay unchanged across providers.
 */

/**
 * Stable provider identifiers. These values are written verbatim into
 * `audit_logs.metadata.provider`, `token_purchases.metadata.provider`,
 * and the `p_provider` argument of payment RPCs. They MUST NOT be
 * renamed once a row has been written with them — historical Paystack
 * rows depend on the literal `"paystack"`.
 */
export type PaymentProviderId = "paystack" | "payfast";

/**
 * Provider settlement currency. Paystack runs USD-native today
 * (cutover 2026-05-01). PayFast is a ZAR-only lane in Phase 2.
 * The legacy USD→ZAR FX helper (`_shared/fx.ts`) is intentionally
 * NOT referenced — PayFast will sell ZAR-priced packs directly.
 */
export type ProviderCurrency = "USD" | "ZAR";

/**
 * Minimal provider descriptor surfaced to callers / tests. Concrete
 * checkout/verify/webhook implementations live in the provider module
 * (e.g. `paystack.ts`) and are not exposed on this descriptor in
 * Phase 1 — wiring them into `token-purchase/index.ts` is explicitly
 * out of scope until Phase 2.
 */
export interface PaymentProvider {
  /** Stable, lower-case provider id. Persisted in audit/ledger metadata. */
  readonly id: PaymentProviderId;
  /** Human label used in logs and operator dashboards. */
  readonly label: string;
  /** Settlement currency this provider charges in. */
  readonly currency: ProviderCurrency;
  /**
   * Whether the provider is enabled for live customer-facing checkout
   * in this build. Paystack = true. PayFast = false until Phase 2/3.
   */
  readonly liveEnabled: boolean;
  /**
   * The column on `token_purchases` that today stores this provider's
   * reference. For Paystack: `paystack_reference` (legacy). For
   * PayFast (Phase 2 onwards): the planned shared `provider_reference`
   * column — see Phase 2 migration recommendation in the Phase 1 report.
   */
  readonly referenceColumn: "paystack_reference" | "provider_reference";
}
