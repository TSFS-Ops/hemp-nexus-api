/**
 * PayFast LIVE checkout initiation — Phase 2G.
 *
 * SCOPE
 * ─────
 *   • Pure, dependency-injected orchestrator for LIVE PayFast checkout
 *     initiation, intended ONLY for an admin-driven live smoke test.
 *   • Gates initiation behind:
 *       - master gate `PAYFAST_LIVE_SMOKE_ENABLED=true`
 *       - global `PAYFAST_MODE=live`
 *       - caller is `platform_admin`
 *       - request body `provider="payfast"` AND `mode="live"`
 *   • Mints an `m_payment_id`, builds the signed PayFast LIVE form
 *     payload, inserts a `token_purchases` row
 *     (provider='payfast', currency='ZAR', status='pending',
 *      paystack_reference parked as `payfast_live::<m_payment_id>`),
 *     and returns the form fields + live checkout URL.
 *
 * NON-GOALS (enforced by tests)
 * ─────────────────────────────
 *   • NOT a customer-facing checkout. Admin smoke only.
 *   • No FX (no import of `_shared/fx.ts`).
 *   • No mutation of Paystack runtime behaviour.
 *   • Never leaks merchant_key or passphrase back to the caller.
 *   • NEVER usable in sandbox mode. Sandbox creds are NEVER read here.
 *
 * The Deno entry point lives in
 * `supabase/functions/payfast-checkout-live/index.ts`.
 */
import { buildPayfastSignature, pfUrlEncode, type OrderedField, type PayfastMode } from "./payfast.ts";

// ─── Live test pricing (ZAR) ──────────────────────────────────────────────
//
// Live smoke uses the smallest acceptable PayFast charge. PayFast's
// documented live minimum is R5.00. We default to that for the
// `live_smoke` package id. Operators can override the amount via
// PAYFAST_LIVE_SMOKE_AMOUNT_ZAR (resolved in the edge wrapper).

export interface PayfastLivePackage {
  id: string;
  credits: number;
  price_zar: number;
  label: string;
}

export const DEFAULT_PAYFAST_LIVE_SMOKE_PACKAGE: PayfastLivePackage = {
  id: "live_smoke",
  credits: 1,
  price_zar: 5,
  label: "Live Smoke Test (1 Credit)",
};

export const PAYFAST_LIVE_PROCESS_URL = "https://www.payfast.co.za/eng/process";

// ─── Outcome shape ────────────────────────────────────────────────────────

export type LiveCheckoutRejectReason =
  | "gate_disabled"
  | "mode_not_live"
  | "not_admin"
  | "wrong_provider"
  | "wrong_mode"
  | "invalid_package"
  | "missing_org"
  | "amount_invalid"
  | "purchase_insert_failed"
  | "merchant_config_missing"
  | "urls_missing";

export interface LiveCheckoutOk {
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
  packageId: string;
  credits: number;
}

export interface LiveCheckoutRejected {
  ok: false;
  status: number;
  reason: LiveCheckoutRejectReason;
  detail: string;
  provider: "payfast";
  mode: "live";
}

export type LiveCheckoutOutcome = LiveCheckoutOk | LiveCheckoutRejected;

// ─── Deps + inputs ────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export type AnySupabaseClient = any;

export interface LiveCheckoutInput {
  provider: string; // must equal "payfast"
  mode: string;     // must equal "live"
  packageId?: string;
  callbackUrl?: string | null;
  cancelUrl?: string | null;
}

export interface LiveCheckoutDeps {
  supabase: AnySupabaseClient;
  userId: string | null;
  orgId: string | null;
  isPlatformAdmin: boolean;
  /** Master gate — PAYFAST_LIVE_SMOKE_ENABLED == "true". */
  smokeEnabled: boolean;
  /** Global mode — must be "live" for this path to work at all. */
  globalMode: PayfastMode;
  /** PayFast LIVE merchant id. NEVER falls back to sandbox. */
  merchantIdLive: string;
  /** PayFast LIVE merchant key. NEVER returned to client. */
  merchantKeyLive: string;
  /** PayFast LIVE passphrase. NEVER returned to client. */
  passphraseLive?: string | null;
  /** LIVE notify URL. */
  notifyUrlLive: string;
  /** LIVE return / cancel URL defaults. */
  defaultReturnUrlLive: string;
  defaultCancelUrlLive: string;
  /** LIVE process URL override (tests). */
  processUrl?: string;
  now?: () => Date;
  mintMPaymentId?: () => string;
  livePackage?: PayfastLivePackage;
}

function rejected(
  reason: LiveCheckoutRejectReason,
  detail: string,
  status = 200,
): LiveCheckoutRejected {
  return { ok: false, status, reason, detail, provider: "payfast", mode: "live" };
}

function defaultMint(now: () => Date): string {
  const t = now().getTime().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `izpf_live_${t}_${r}`;
}

function orderedCheckoutFields(opts: {
  merchantId: string;
  merchantKey: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  mPaymentId: string;
  amount: string;
  itemName: string;
  itemDescription?: string;
  customStr1?: string;
  customStr2?: string;
  customStr3?: string;
}): OrderedField[] {
  const fields: Array<[string, string]> = [
    ["merchant_id", opts.merchantId],
    ["merchant_key", opts.merchantKey],
    ["return_url", opts.returnUrl],
    ["cancel_url", opts.cancelUrl],
    ["notify_url", opts.notifyUrl],
    ["m_payment_id", opts.mPaymentId],
    ["amount", opts.amount],
    ["item_name", opts.itemName],
  ];
  if (opts.itemDescription) fields.push(["item_description", opts.itemDescription]);
  if (opts.customStr1) fields.push(["custom_str1", opts.customStr1]);
  if (opts.customStr2) fields.push(["custom_str2", opts.customStr2]);
  if (opts.customStr3) fields.push(["custom_str3", opts.customStr3]);
  return fields as OrderedField[];
}

export interface SignedLivePayload {
  fields: OrderedField[];
  signature: string;
  checkoutUrl: string;
}

export function buildSignedLiveFormPayload(
  opts: Parameters<typeof orderedCheckoutFields>[0] & {
    passphrase?: string | null;
    processUrl?: string;
  },
): SignedLivePayload {
  const fields = orderedCheckoutFields(opts);
  const signature = buildPayfastSignature(fields, opts.passphrase ?? null);
  const signedFields: OrderedField[] = [...fields, ["signature", signature]];
  const qs = signedFields
    .map(([k, v]) => `${k}=${pfUrlEncode(v)}`)
    .join("&");
  const base = opts.processUrl ?? PAYFAST_LIVE_PROCESS_URL;
  return { fields: signedFields, signature, checkoutUrl: `${base}?${qs}` };
}

// ─── Main orchestrator ────────────────────────────────────────────────────

export async function buildPayfastLiveCheckout(
  input: LiveCheckoutInput,
  deps: LiveCheckoutDeps,
): Promise<LiveCheckoutOutcome> {
  const now = deps.now ?? (() => new Date());
  const pkg = deps.livePackage ?? DEFAULT_PAYFAST_LIVE_SMOKE_PACKAGE;

  // 1. Master gate.
  if (deps.smokeEnabled !== true) {
    return rejected(
      "gate_disabled",
      "PayFast LIVE smoke is disabled (PAYFAST_LIVE_SMOKE_ENABLED!=true).",
      403,
    );
  }

  // 2. Global mode must be live.
  if (deps.globalMode !== "live") {
    return rejected(
      "mode_not_live",
      "PayFast LIVE smoke requires PAYFAST_MODE=live.",
      403,
    );
  }

  // 3. Admin role.
  if (deps.isPlatformAdmin !== true) {
    return rejected("not_admin", "PayFast LIVE smoke requires platform_admin.", 403);
  }

  // 4. Provider + mode literals.
  if (input.provider !== "payfast") {
    return rejected("wrong_provider", `provider must be "payfast" (got "${input.provider}").`, 400);
  }
  if (input.mode !== "live") {
    return rejected("wrong_mode", `mode must be "live" (got "${input.mode}").`, 400);
  }

  // 5. Org context.
  if (!deps.orgId) {
    return rejected("missing_org", "No org context for the authenticated user.", 400);
  }

  // 6. Merchant config sanity (live only — never falls back to sandbox).
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

  // 8. Package sanity.
  if (!Number.isFinite(pkg.price_zar) || pkg.price_zar <= 0) {
    return rejected("amount_invalid", `Live package "${pkg.id}" has non-positive ZAR price.`, 400);
  }
  if (input.packageId && input.packageId !== pkg.id) {
    return rejected(
      "invalid_package",
      `Live smoke only supports package "${pkg.id}" (got "${input.packageId}").`,
      400,
    );
  }

  // 9. Mint ids and the safe ZAR amount string.
  const mPaymentId = (deps.mintMPaymentId ?? (() => defaultMint(now)))();
  const amountStr = pkg.price_zar.toFixed(2);
  const itemName = `Izenzo Credits — ${pkg.label}`;

  // 10. Insert pending purchase row.
  //
  // Same constraints as the sandbox path: `paystack_reference` is NOT
  // NULL in the live schema and we park `payfast_live::<m_payment_id>`
  // there to keep Paystack reporting isolated; `amount_usd` is written
  // as 0 with real ZAR held in metadata.
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
      smoke_test: true,
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

  // 11. Build signed PayFast LIVE form payload.
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
    itemDescription: `Live smoke checkout for ${pkg.label}`,
    customStr1: pkg.id,
    customStr2: deps.orgId,
    customStr3: deps.userId ?? "",
    passphrase: deps.passphraseLive ?? null,
    processUrl: deps.processUrl,
  });

  // 12. Audit (best-effort).
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
        smoke_test: true,
        package_id: pkg.id,
        credits: pkg.credits,
        amount_zar: pkg.price_zar,
        currency: "ZAR",
        gate: "PAYFAST_LIVE_SMOKE_ENABLED",
      },
    });
  } catch { /* never block init on audit failure */ }

  // 13. Build the safe response. The merchant_key is required as a
  // form field by PayFast itself, but the passphrase is NEVER surfaced.
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
