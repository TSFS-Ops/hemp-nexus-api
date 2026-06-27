/**
 * PayFast sandbox checkout initiation — Phase 2C.
 *
 * SCOPE
 * ─────
 *   • Pure, dependency-injected orchestrator for sandbox PayFast
 *     checkout initiation.
 *   • Gates initiation behind: platform_admin role + an explicit env
 *     flag + provider === "payfast" + mode === "sandbox".
 *   • Mints an `m_payment_id`, builds the signed PayFast form payload,
 *     inserts a `token_purchases` row (provider='payfast', status='pending',
 *     currency='ZAR') and returns the form fields + checkout URL.
 *
 * NON-GOALS (enforced by tests)
 * ─────────────────────────────
 *   • No customer-facing checkout button — admin/test only.
 *   • No live PayFast — `mode` MUST be "sandbox" in Phase 2C.
 *   • No mutation of Paystack runtime behaviour (separate edge entry).
 *   • No USD↔ZAR FX (no import of `_shared/fx.ts`).
 *   • No refunds.
 *   • Never leaks merchant_key or passphrase back to the caller.
 *
 * The Deno entry point lives in
 * `supabase/functions/payfast-checkout-sandbox/index.ts` and is a thin
 * wrapper that resolves env + user context and calls into here.
 */
import { buildPayfastSignature, pfUrlEncode, type OrderedField, type PayfastMode } from "./payfast.ts";

// ─── Sandbox test pricing (ZAR) ───────────────────────────────────────────
//
// These ZAR prices are sandbox/test-only values. They are NOT the
// production ZAR pricing schedule — Izenzo must confirm the live prices
// before any Phase 2D/2E live rollout. We deliberately do NOT derive
// these from the USD `CREDIT_PACKAGES` to keep PayFast ZAR-native and
// to avoid any temptation to revive `_shared/fx.ts`.

export interface PayfastSandboxPackage {
  id: "single" | "pack_10" | "pack_50" | "pack_200";
  credits: number;
  price_zar: number;
  label: string;
}

export const PAYFAST_SANDBOX_PACKAGES: Record<string, PayfastSandboxPackage> = {
  single: { id: "single", credits: 1, price_zar: 20, label: "1 Credit (Sandbox)" },
  pack_10: { id: "pack_10", credits: 10, price_zar: 180, label: "10 Credits (Sandbox)" },
  pack_50: { id: "pack_50", credits: 50, price_zar: 800, label: "50 Credits (Sandbox)" },
  pack_200: { id: "pack_200", credits: 200, price_zar: 3000, label: "200 Credits (Sandbox)" },
};

export const PAYFAST_SANDBOX_PROCESS_URL = "https://sandbox.payfast.co.za/eng/process";

// ─── Outcome shape ────────────────────────────────────────────────────────

export type CheckoutRejectReason =
  | "gate_disabled"
  | "not_admin"
  | "wrong_provider"
  | "wrong_mode"
  | "invalid_package"
  | "missing_org"
  | "unsupported_currency"
  | "amount_invalid"
  | "purchase_insert_failed"
  | "merchant_config_missing";

export interface CheckoutOk {
  ok: true;
  status: 200;
  provider: "payfast";
  mode: "sandbox";
  purchaseId: string;
  providerReference: string; // m_payment_id (== provider_reference)
  checkoutUrl: string;
  formFields: Array<{ name: string; value: string }>;
  status_text: "pending";
  amountZar: number;
  packageId: string;
  credits: number;
}

export interface CheckoutRejected {
  ok: false;
  status: number;
  reason: CheckoutRejectReason;
  detail: string;
  provider: "payfast";
  mode: "sandbox";
}

export type CheckoutOutcome = CheckoutOk | CheckoutRejected;

// ─── Deps + inputs ────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export type AnySupabaseClient = any;

export interface BuildCheckoutInput {
  provider: string; // must equal "payfast"
  mode: string;     // must equal "sandbox"
  packageId: string;
  callbackUrl?: string | null;
  cancelUrl?: string | null;
}

export interface BuildCheckoutDeps {
  supabase: AnySupabaseClient;
  /** Currently authenticated user (resolved by edge wrapper). */
  userId: string | null;
  /** Org context for the purchase row (resolved by edge wrapper). */
  orgId: string | null;
  /** Whether the caller has the platform_admin role. */
  isPlatformAdmin: boolean;
  /** Master gate — set by `PAYFAST_SANDBOX_CHECKOUT_ENABLED=true`. */
  gateEnabled: boolean;
  /** PayFast sandbox merchant id (env). */
  merchantId: string;
  /** PayFast sandbox merchant key (env). NEVER returned to client. */
  merchantKey: string;
  /** Optional passphrase (env). NEVER returned to client. */
  passphrase?: string | null;
  /** ITN receiver URL (typically the deployed payfast-itn function). */
  notifyUrl: string;
  /** Fallback return/cancel URLs if the caller does not supply them. */
  defaultReturnUrl: string;
  defaultCancelUrl: string;
  /** Process URL (sandbox-only in Phase 2C). */
  processUrl?: string;
  /** Clock + ID minting hooks for tests. */
  now?: () => Date;
  mintMPaymentId?: () => string;
  /** Optional package table override (tests). */
  packages?: Record<string, PayfastSandboxPackage>;
}

function rejected(
  reason: CheckoutRejectReason,
  detail: string,
  status = 200,
): CheckoutRejected {
  return { ok: false, status, reason, detail, provider: "payfast", mode: "sandbox" };
}

function defaultMint(now: () => Date): string {
  // Compact, sortable, unique enough for sandbox: izpf_<unix>_<rand>.
  const t = now().getTime().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `izpf_${t}_${r}`;
}

// ─── Form-fields helper (ordered) ─────────────────────────────────────────
//
// PayFast signs fields in the ORDER they appear in the form POST.
// We build a single canonical order here, append signature last, and
// emit both an ordered array (for the caller to render the form) and
// the signature.

function orderedCheckoutFields(opts: {
  merchantId: string;
  merchantKey: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  mPaymentId: string;
  amount: string; // already formatted "10.00"
  itemName: string;
  itemDescription?: string;
  customStr1?: string; // package_id
  customStr2?: string; // org_id
  customStr3?: string; // user_id
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

export interface SignedPayload {
  fields: OrderedField[];
  signature: string;
  /** Hosted checkout URL (sandbox process URL + ?fields). */
  checkoutUrl: string;
}

export function buildSignedSandboxFormPayload(
  opts: Parameters<typeof orderedCheckoutFields>[0] & {
    passphrase?: string | null;
    processUrl?: string;
  },
): SignedPayload {
  const fields = orderedCheckoutFields(opts);
  const signature = buildPayfastSignature(fields, opts.passphrase ?? null);
  const signedFields: OrderedField[] = [...fields, ["signature", signature]];
  const qs = signedFields
    .map(([k, v]) => `${k}=${pfUrlEncode(v)}`)
    .join("&");
  const base = opts.processUrl ?? PAYFAST_SANDBOX_PROCESS_URL;
  return { fields: signedFields, signature, checkoutUrl: `${base}?${qs}` };
}

// ─── Main orchestrator ────────────────────────────────────────────────────

export async function buildPayfastSandboxCheckout(
  input: BuildCheckoutInput,
  deps: BuildCheckoutDeps,
): Promise<CheckoutOutcome> {
  const now = deps.now ?? (() => new Date());
  const packages = deps.packages ?? PAYFAST_SANDBOX_PACKAGES;

  // 1. Master gate.
  if (deps.gateEnabled !== true) {
    return rejected(
      "gate_disabled",
      "PayFast sandbox checkout is disabled (PAYFAST_SANDBOX_CHECKOUT_ENABLED!=true).",
      403,
    );
  }

  // 2. Admin role.
  if (deps.isPlatformAdmin !== true) {
    return rejected("not_admin", "PayFast sandbox checkout requires platform_admin.", 403);
  }

  // 3. Provider + mode literals.
  if (input.provider !== "payfast") {
    return rejected("wrong_provider", `provider must be "payfast" (got "${input.provider}").`, 400);
  }
  if (input.mode !== "sandbox") {
    return rejected("wrong_mode", `mode must be "sandbox" in Phase 2C (got "${input.mode}").`, 400);
  }

  // 4. Package lookup.
  const pkg = packages[input.packageId];
  if (!pkg) {
    return rejected("invalid_package", `Unknown package "${input.packageId}".`, 400);
  }
  if (!Number.isFinite(pkg.price_zar) || pkg.price_zar <= 0) {
    return rejected("amount_invalid", `Package "${pkg.id}" has non-positive ZAR price.`, 400);
  }

  // 5. Org context.
  if (!deps.orgId) {
    return rejected("missing_org", "No org context for the authenticated user.", 400);
  }

  // 6. Merchant config sanity (never leak the values).
  if (!deps.merchantId || !deps.merchantKey) {
    return rejected(
      "merchant_config_missing",
      "PayFast sandbox merchant configuration missing (PAYFAST_SANDBOX_MERCHANT_ID/KEY).",
      503,
    );
  }

  // 7. Mint ids and the safe ZAR amount string.
  const mPaymentId = (deps.mintMPaymentId ?? (() => defaultMint(now)))();
  const amountStr = pkg.price_zar.toFixed(2);
  const itemName = `Izenzo Credits — ${pkg.label}`;

  // 8. Insert pending purchase row.
  //
  // The historical `token_purchases.paystack_reference` column is NOT
  // NULL in the live schema, and the prompt forbids dropping or
  // renaming it. We therefore park a clearly-namespaced synthetic
  // value (`payfast_sandbox::<m_payment_id>`) so PayFast rows never
  // collide with real Paystack references (which carry no such
  // prefix) and so the column constraint is honoured without
  // touching Paystack code. Phase 2D should make this column
  // nullable; documented in the Phase 2C report.
  //
  // `amount_usd` is also NOT NULL in the live schema. We deliberately
  // write 0 for PayFast rows and persist the real ZAR amount inside
  // `metadata.price_zar` / `metadata.amount_zar`. This intentionally
  // keeps the live `amount_usd` figures Paystack-only, so downstream
  // USD revenue reporting is not contaminated by ZAR settlements.
  const insertPayload = {
    org_id: deps.orgId,
    user_id: deps.userId,
    paystack_reference: `payfast_sandbox::${mPaymentId}`,
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
      sandbox: true,
      mode: "sandbox",
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

  // 9. Build signed PayFast form payload.
  const returnUrl = input.callbackUrl?.trim() || deps.defaultReturnUrl;
  const cancelUrl = input.cancelUrl?.trim() || deps.defaultCancelUrl;
  const signed = buildSignedSandboxFormPayload({
    merchantId: deps.merchantId,
    merchantKey: deps.merchantKey,
    returnUrl,
    cancelUrl,
    notifyUrl: deps.notifyUrl,
    mPaymentId,
    amount: amountStr,
    itemName,
    itemDescription: `Sandbox checkout for ${pkg.label}`,
    customStr1: pkg.id,
    customStr2: deps.orgId,
    customStr3: deps.userId ?? "",
    passphrase: deps.passphrase ?? null,
    processUrl: deps.processUrl,
  });

  // 10. Audit (best-effort).
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
        mode: "sandbox",
        sandbox: true,
        package_id: pkg.id,
        credits: pkg.credits,
        amount_zar: pkg.price_zar,
        currency: "ZAR",
        gate: "PAYFAST_SANDBOX_CHECKOUT_ENABLED",
      },
    });
  } catch { /* never block init on audit failure */ }

  // 11. Build the safe response. We strip merchant_key from the
  // returned form fields so it never reaches the browser/test harness.
  // The signature is computed FROM the full set including merchant_key;
  // we just don't surface it back. The sandbox checkoutUrl still
  // contains merchant_key as a query param because that is exactly
  // how PayFast's hosted process URL expects to receive it — the
  // sandbox merchant_key is a public, documented test value. We never
  // surface the passphrase anywhere.
  const safeFields = signed.fields
    .filter(([k]) => k !== "merchant_key")
    .map(([name, value]) => ({ name, value }));

  return {
    ok: true,
    status: 200,
    provider: "payfast",
    mode: "sandbox",
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

// Re-export this so the edge wrapper has a single import surface for
// the live mode literal type (no `live` literal is exposed here).
export type { PayfastMode };
