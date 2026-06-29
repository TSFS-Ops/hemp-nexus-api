/**
 * credit-checkout-payfast — client helper for the customer-facing
 * `payfast-checkout-public` edge function (Phase 2J).
 *
 * Sits alongside (does NOT replace) `credit-checkout.ts`, which still
 * handles the Paystack path. PayFast credits are issued ONLY by the
 * verified ITN handler (`payfast-itn`); this client does not credit.
 */
import { supabase } from "@/integrations/supabase/client";

export type PayfastCustomerPackageId =
  | "single"
  | "pack_10"
  | "pack_50"
  | "pack_200";

export const PAYFAST_ZAR_PRICES: Readonly<
  Record<PayfastCustomerPackageId, number>
> = Object.freeze({
  single: 20,
  pack_10: 190,
  pack_50: 850,
  pack_200: 3000,
});

export interface StartPayfastCheckoutResult {
  checkoutUrl: string;
  purchaseId: string;
  providerReference: string;
  formFields: Array<{ name: string; value: string }>;
  amountZar: number;
  credits: number;
  packageId: PayfastCustomerPackageId;
}

/**
 * Initiates a PayFast (LIVE, customer-facing) checkout for the given
 * pack. Returns the signed form fields + a checkoutUrl. The caller is
 * responsible for posting the signed form to PayFast's process URL.
 *
 * Throws an Error with a user-readable message on failure.
 */
export async function startPayfastPublicCheckout(
  packageId: PayfastCustomerPackageId,
  options: { callbackUrl?: string; cancelUrl?: string } = {},
): Promise<StartPayfastCheckoutResult> {
  const callbackUrl =
    options.callbackUrl ?? `${window.location.origin}/desk/billing/payfast/return`;
  const cancelUrl =
    options.cancelUrl ?? `${window.location.origin}/desk/billing/payfast/cancel`;

  const { data, error } = await supabase.functions.invoke(
    "payfast-checkout-public",
    {
      body: {
        provider: "payfast",
        mode: "live",
        packageId,
        callbackUrl,
        cancelUrl,
      },
    },
  );

  if (error) {
    const ctx = (error as unknown as { context?: { detail?: string; reason?: string } }).context;
    const detail = ctx?.detail || ctx?.reason || error.message;
    throw new Error(detail || "Could not start PayFast checkout");
  }

  const payload = data as {
    ok?: boolean;
    reason?: string;
    detail?: string;
    checkoutUrl?: string;
    purchaseId?: string;
    providerReference?: string;
    formFields?: Array<{ name: string; value: string }>;
    amountZar?: number;
    credits?: number;
    packageId?: PayfastCustomerPackageId;
  } | null;

  if (
    !payload?.ok
    || !payload.checkoutUrl
    || !payload.purchaseId
    || !payload.providerReference
    || !Array.isArray(payload.formFields)
  ) {
    const msg = payload?.detail || payload?.reason || "PayFast checkout was not accepted";
    throw new Error(msg);
  }

  return {
    checkoutUrl: payload.checkoutUrl,
    purchaseId: payload.purchaseId,
    providerReference: payload.providerReference,
    formFields: payload.formFields,
    amountZar: payload.amountZar ?? PAYFAST_ZAR_PRICES[packageId],
    credits: payload.credits ?? 0,
    packageId: (payload.packageId ?? packageId),
  };
}

/**
 * Build + submit a hidden form to PayFast's process URL using the
 * signed fields. This mirrors what the admin live smoke button does,
 * but with a same-tab navigation (customers expect that).
 */
export function submitPayfastForm(
  checkoutUrl: string,
  formFields: Array<{ name: string; value: string }>,
): void {
  const url = new URL(checkoutUrl);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${url.origin}${url.pathname}`;
  form.style.display = "none";
  for (const { name, value } of formFields) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
