/**
 * credit-checkout — client helper for the `token-purchase` edge function.
 *
 * Centralises:
 *   - initiating Paystack checkout (`startCreditCheckout`)
 *   - verifying a Paystack reference after redirect (`verifyCreditCheckout`)
 *   - the canonical `PackageId` union understood by the backend
 *
 * Keeping this in one module ensures every Purchase button across the
 * desk (BillingOverview, TokenBalanceTab, CreditProvisioningPanel) talks
 * to the same backend contract — preventing the UI/backend drift that
 * caused the original "checkout coming online soon" stub.
 */
import { supabase } from "@/integrations/supabase/client";

export type CreditPackageId = "single" | "pack_10" | "pack_50" | "pack_200";

export interface StartCheckoutResult {
  checkoutUrl: string;
  reference: string;
}

/**
 * Initiates a Paystack checkout session for the given package and
 * returns the hosted-checkout URL. The caller is responsible for the
 * redirect (so it can decide between full-page navigate vs popup).
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
  });

  if (error) {
    throw new Error(error.message ?? "Could not start checkout");
  }
  if (!data?.checkoutUrl || !data?.reference) {
    throw new Error(data?.error ?? "Payment provider did not return a checkout URL");
  }
  return { checkoutUrl: data.checkoutUrl as string, reference: data.reference as string };
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
 * webhook hasn't already done so. Safe to call repeatedly — the
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
