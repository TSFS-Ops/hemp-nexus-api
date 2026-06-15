/**
 * credit-checkout - client helper for the `token-purchase` edge function.
 *
 * Centralises:
 *   - initiating Paystack checkout (`startCreditCheckout`)
 *   - verifying a Paystack reference after redirect (`verifyCreditCheckout`)
 *   - the canonical `CreditPackageId` union understood by the backend
 *
 * Keeping this in one module ensures every Purchase button across the
 * desk talks to the same backend contract - preventing the UI/backend
 * drift that originally caused the "checkout coming online soon" stub.
 */
import { supabase } from "@/integrations/supabase/client";
import { recordPaystackAttempt } from "@/components/desk/billing/PaymentReferenceStatus";
import { generateIdempotencyKey } from "@/lib/api-client";

export type CreditPackageId = "single" | "pack_10" | "pack_50" | "pack_200";

const EXPECTED_CREDITS: Record<CreditPackageId, number> = {
  single: 1,
  pack_10: 10,
  pack_50: 50,
  pack_200: 200,
};

export interface StartCheckoutResult {
  checkoutUrl: string;
  reference: string;
}

/**
 * Initiates a Paystack checkout session for the given package and
 * returns the hosted-checkout URL. The caller is responsible for the
 * redirect (so it can decide between full-page navigate vs popup).
 *
 * Throws an Error with a user-readable message on failure. The message
 * is taken from the backend's structured response when available so the
 * caller can surface it verbatim in the UI.
 */
export async function startCreditCheckout(
  packageId: CreditPackageId,
  options: { callbackUrl?: string; cancelUrl?: string } = {}
): Promise<StartCheckoutResult> {
  const callbackUrl =
    options.callbackUrl ?? `${window.location.origin}${window.location.pathname}`;
  const cancelUrl = options.cancelUrl ?? callbackUrl;

  const { data, error } = await supabase.functions.invoke("token-purchase", {
    body: { packageId, callbackUrl, cancelUrl },
    headers: { "Idempotency-Key": generateIdempotencyKey(`credit_purchase_${packageId}`) },
  });

  if (error) {
    // supabase.functions.invoke wraps non-2xx responses. The body is
    // exposed via error.context in newer SDKs; fall back to message.
    const ctx = (error as unknown as { context?: { error?: string; providerMessage?: string } }).context;
    const detail = ctx?.providerMessage || ctx?.error || error.message;
    throw new Error(detail || "Could not start checkout");
  }
  if (!data?.checkoutUrl || !data?.reference) {
    const detail =
      data?.providerMessage || data?.error || "Payment provider did not return a checkout URL";
    throw new Error(detail);
  }
  const reference = data.reference as string;
  // Persist locally so the Billing page can render this reference
  // immediately on return (with status pending → credited) even if the
  // ledger row hasn't appeared yet.
  recordPaystackAttempt({
    reference,
    packageId,
    expectedCredits: EXPECTED_CREDITS[packageId],
    startedAt: new Date().toISOString(),
  });
  return { checkoutUrl: data.checkoutUrl as string, reference };
}

export interface VerifyCheckoutResult {
  success: boolean;
  alreadyCredited?: boolean;
  credits?: number;
  newBalance?: number;
  message?: string;
}

/**
 * Verifies a Paystack reference and credits the org wallet if the
 * webhook hasn't already done so. Safe to call repeatedly - the
 * backend has both soft and hard idempotency guards.
 */
export async function verifyCreditCheckout(
  reference: string
): Promise<VerifyCheckoutResult> {
  const { data, error } = await supabase.functions.invoke("token-purchase/verify", {
    body: { reference },
  });
  if (error) {
    throw new Error(error.message ?? "Could not verify payment");
  }
  return (data ?? { success: false }) as VerifyCheckoutResult;
}
