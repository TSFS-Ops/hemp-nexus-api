/**
 * PayFast customer-facing checkout initiation — Phase 2J.
 *
 * SCOPE
 * ─────
 *   • Pure, dependency-injected orchestrator for LIVE PayFast checkout
 *     initiation for normal authenticated customers (non-admin).
 *   • Gates initiation behind:
 *       - master gate `PAYFAST_PUBLIC_ENABLED=true`
 *       - global `PAYFAST_MODE=live`
 *       - request body `provider="payfast"` AND `mode="live"`
 *       - `packageId` is one of the fixed customer packs
 *         (`single` / `pack_10` / `pack_50` / `pack_200`)
 *   • Reuses the proven signed-form builder
 *     (`buildSignedLiveFormPayload` from `payfast-live-checkout.ts`)
 *     and live merchant credentials.
 *   • Inserts a `token_purchases` row with `provider='payfast'`,
 *     `currency='ZAR'`, `status='pending'`, `provider_reference=m_payment_id`,
 *     `paystack_reference='payfast_live::<m_payment_id>'` (NOT NULL park).
 *   • Writes a `credits.purchase_initiated` audit row.
 *
 * NON-GOALS (enforced by tests)
 * ─────────────────────────────
 *   • No FX (no import of `_shared/fx.ts`).
 *   • No sandbox creds — LIVE-only, by design.
 *   • No admin requirement — this is the customer path.
 *   • No mutation of Paystack runtime behaviour.
 *   • Never returns merchant_key or passphrase.
 *
 * The Deno entry point lives in
 * `supabase/functions/payfast-checkout-public/index.ts`.
 */
import { buildSignedLiveFormPayload } from "./payfast-live-checkout.ts";
import type { PayfastMode } from "./payfast.ts";
import {
  getPayfastCustomerPackage,
  type PayfastCustomerPackage,
} from "./payfast-customer-packages.ts";

export type PublicCheckoutRejectReason =
  | "gate_disabled"
  | "mode_not_live"
  | "wrong_provider"
  | "wrong_mode"
  | "invalid_package"
  | "missing_org"
  | "merchant_config_missing"
  | "urls_missing"
  | "purchase_insert_failed";

export interface PublicCheckoutOk {
  ok: true;
  status: 200;
  provider: "payfast";
  mode: "live";
  purchaseId: string;
  providerReference: string;
  checkoutUrl: string;
  formFields: Array<{ name: string; value: string }>;
  status_text: "pending";
  amountZar: number;
  packageId: PayfastCustomerPackage["id"];
  credits: number;
}

export interface PublicCheckoutRejected {
  ok: false;
  status: number;
  reason: PublicCheckoutRejectReason;
  detail: string;
  provider: "payfast";
  mode: "live";
}

export type PublicCheckoutOutcome = PublicCheckoutOk | PublicCheckoutRejected;

// deno-lint-ignore no-explicit-any
export type AnySupabaseClient = any;

export interface PublicCheckoutInput {
  provider: string;
  mode: string;
  packageId?: string;
  callbackUrl?: string | null;
  cancelUrl?: string | null;
}

export interface PublicCheckoutDeps {
  supabase: AnySupabaseClient;
  userId: string | null;
  orgId: string | null;
  /** Master gate — PAYFAST_PUBLIC_ENABLED == "true". */
  publicEnabled: boolean;
  /** Global mode — must be "live". */
  globalMode: PayfastMode;
  merchantIdLive: string;
  merchantKeyLive: string;
  passphraseLive?: string | null;
  notifyUrlLive: string;
  defaultReturnUrlLive: string;
  defaultCancelUrlLive: string;
  processUrl?: string;
  now?: () => Date;
  mintMPaymentId?: () => string;
}

function rejected(
  reason: PublicCheckoutRejectReason,
  detail: string,
  status = 200,
): PublicCheckoutRejected {
  return { ok: false, status, reason, detail, provider: "payfast", mode: "live" };
}

function defaultMint(now: () => Date): string {
  const t = now().getTime().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `izpf_pub_${t}_${r}`;
}

export async function buildPayfastPublicCheckout(
  input: PublicCheckoutInput,
  deps: PublicCheckoutDeps,
): Promise<PublicCheckoutOutcome> {
  const now = deps.now ?? (() => new Date());

  // 1. Master gate.
  if (deps.publicEnabled !== true) {
    return rejected(
      "gate_disabled",
      "PayFast customer checkout is disabled (PAYFAST_PUBLIC_ENABLED!=true).",
      403,
    );
  }
  // 2. Global mode must be live — sandbox creds are never read here.
  if (deps.globalMode !== "live") {
    return rejected(
      "mode_not_live",
      "PayFast customer checkout requires PAYFAST_MODE=live.",
      403,
    );
  }
  // 3. Provider + mode literals from the request body.
  if (input.provider !== "payfast") {
    return rejected(
      "wrong_provider",
      `provider must be "payfast" (got "${input.provider}").`,
      400,
    );
  }
  if (input.mode !== "live") {
    return rejected(
      "wrong_mode",
      `mode must be "live" (got "${input.mode}").`,
      400,
    );
  }
  // 4. Org context.
  if (!deps.orgId) {
    return rejected("missing_org", "No org context for the authenticated user.", 400);
  }
  // 5. Package must be a customer pack — never `live_smoke`.
  const pkg = getPayfastCustomerPackage(input.packageId ?? null);
  if (!pkg) {
    return rejected(
      "invalid_package",
      `Customer checkout requires one of: single, pack_10, pack_50, pack_200 (got "${
        input.packageId ?? ""
      }").`,
      400,
    );
  }
  // 6. Merchant config sanity — LIVE only, no sandbox fallback.
  if (!deps.merchantIdLive || !deps.merchantKeyLive) {
    return rejected(
      "merchant_config_missing",
      "PayFast LIVE merchant configuration missing (PAYFAST_MERCHANT_ID_LIVE/PAYFAST_MERCHANT_KEY_LIVE).",
      503,
    );
  }
  // 7. URL config sanity.
  if (!deps.notifyUrlLive || !deps.defaultReturnUrlLive || !deps.defaultCancelUrlLive) {
    return rejected(
      "urls_missing",
      "PayFast LIVE URLs missing (PAYFAST_NOTIFY_URL_LIVE / PAYFAST_RETURN_URL_LIVE / PAYFAST_CANCEL_URL_LIVE).",
      503,
    );
  }

  // 8. Mint ids and the safe ZAR amount string.
  const mPaymentId = (deps.mintMPaymentId ?? (() => defaultMint(now)))();
  const amountStr = pkg.price_zar.toFixed(2);
  const itemName = `Izenzo Credits — ${pkg.label}`;

  // 9. Insert pending purchase row.
  const insertPayload = {
    org_id: deps.orgId,
    user_id: deps.userId,
    paystack_reference: `payfast_live::${mPaymentId}`,
    provider: "payfast" as const,
    provider_reference: mPaymentId,
    package_id: pkg.id,
    token_amount: pkg.credits,
    amount_usd: 0,
    currency: "ZAR",
    status: "pending",
    metadata: {
      provider: "payfast",
      provider_reference: mPaymentId,
      m_payment_id: mPaymentId,
      sandbox: false,
      mode: "live",
      smoke_test: false,
      customer_facing: true,
      package_id: pkg.id,
      package_label: pkg.label,
      token_amount: pkg.credits,
      amount_zar: pkg.price_zar,
      price_zar: pkg.price_zar,
      currency: "ZAR",
      user_id: deps.userId,
      org_id: deps.orgId,
      expected_itn_reference_rule: "ITN m_payment_id must equal provider_reference",
      created_at: now().toISOString(),
      gate: "PAYFAST_PUBLIC_ENABLED",
    },
  };

  const { data: insertedRow, error: insertErr } = await deps.supabase
    .from("token_purchases")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertErr || !insertedRow?.id) {
    return rejected(
      "purchase_insert_failed",
      `token_purchases insert failed: ${
        (insertErr as { message?: string } | null)?.message ?? "unknown"
      }`,
      500,
    );
  }

  // 10. Build signed PayFast LIVE form payload.
  const returnUrl = input.callbackUrl?.trim() || deps.defaultReturnUrlLive;
  const cancelUrl = input.cancelUrl?.trim() || deps.defaultCancelUrlLive;
  const signed = buildSignedLiveFormPayload({
    merchantId: deps.merchantIdLive,
    merchantKey: deps.merchantKeyLive,
    returnUrl,
    cancelUrl,
    notifyUrl: deps.notifyUrlLive,
    mPaymentId,
    amount: amountStr,
    itemName,
    itemDescription: `Customer checkout for ${pkg.label}`,
    customStr1: pkg.id,
    customStr2: deps.orgId,
    customStr3: deps.userId ?? "",
    passphrase: deps.passphraseLive ?? null,
    processUrl: deps.processUrl,
  });

  // 11. Audit (best-effort).
  try {
    await deps.supabase.from("audit_logs").insert({
      org_id: deps.orgId,
      actor_user_id: deps.userId,
      action: "credits.purchase_initiated",
      entity_type: "token_purchase",
      entity_id: insertedRow.id,
      metadata: {
        provider: "payfast",
        provider_reference: mPaymentId,
        m_payment_id: mPaymentId,
        mode: "live",
        customer_facing: true,
        package_id: pkg.id,
        credits: pkg.credits,
        amount_zar: pkg.price_zar,
        currency: "ZAR",
        gate: "PAYFAST_PUBLIC_ENABLED",
      },
    });
  } catch { /* never block init on audit failure */ }

  // 12. Build the safe response. merchant_key is required as a form
  // field by PayFast itself, but the passphrase is NEVER returned.
  const safeFields = signed.fields.map(([name, value]) => ({ name, value }));

  return {
    ok: true,
    status: 200,
    provider: "payfast",
    mode: "live",
    purchaseId: insertedRow.id,
    providerReference: mPaymentId,
    checkoutUrl: signed.checkoutUrl,
    formFields: safeFields,
    status_text: "pending",
    amountZar: pkg.price_zar,
    packageId: pkg.id,
    credits: pkg.credits,
  };
}

export type { PayfastMode };
