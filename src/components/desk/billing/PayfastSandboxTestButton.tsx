/**
 * PayfastSandboxTestButton — Phase 2F operator unblocker.
 *
 * Admin-only, sandbox-only test button that calls the existing
 * `payfast-checkout-sandbox` edge function so a non-technical
 * platform_admin operator can click through one controlled PayFast
 * sandbox round-trip.
 *
 * This is NOT a customer payment option:
 *   • only rendered when the viewer has the `platform_admin` role;
 *   • explicitly labelled "Sandbox / Test only";
 *   • posts `provider:"payfast"`, `mode:"sandbox"`;
 *   • all live-gate enforcement still lives server-side
 *     (PAYFAST_SANDBOX_CHECKOUT_ENABLED + role + mode literal).
 *
 * Paystack is the unchanged customer-facing path. PayFast remains
 * sandbox-only and no live PayFast credentials are read here.
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, FlaskConical } from "lucide-react";
import { toast } from "sonner";

const SANDBOX_TEST_PACKAGE_ID = "single"; // smallest, $1 USD equivalent

export function PayfastSandboxTestButton() {
  const { session, isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);

  // Hard client gate. The real authority lives in the edge function.
  if (!isAdmin) return null;

  const handleClick = async () => {
    if (!session?.access_token) {
      toast.error("Sign in required");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "payfast-checkout-sandbox",
        {
          body: {
            provider: "payfast",
            mode: "sandbox",
            packageId: SANDBOX_TEST_PACKAGE_ID,
          },
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (error) throw error;
      const payload = data as {
        ok?: boolean;
        reason?: string;
        detail?: string;
        error?: string;
        checkoutUrl?: string;
        formFields?: Array<{ name: string; value: string }>;
      };
      if (!payload?.ok || !payload.checkoutUrl || !Array.isArray(payload.formFields)) {
        const msg =
          payload?.detail ??
          payload?.reason ??
          payload?.error ??
          "unknown";
        toast.error(`Sandbox checkout rejected: ${msg}`);
        return;
      }
      // PayFast's hosted process URL accepts the signed fields as query
      // params (the checkoutUrl we got back already encodes them), so we
      // can just open it in a new tab. We still build a POST form as a
      // belt-and-braces fallback for environments that prefer POST.
      const url = new URL(payload.checkoutUrl);
      const form = document.createElement("form");
      form.method = "POST";
      form.action = `${url.origin}${url.pathname}`;
      form.target = "_blank";
      for (const { name, value } of payload.formFields) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      form.remove();
      toast.success("PayFast sandbox page opened in a new tab");

    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sandbox checkout failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-amber-600" />
          <CardTitle className="text-lg">PayFast Sandbox Test (Admin Only)</CardTitle>
        </div>
        <CardDescription>
          Controlled Phase 2F round-trip. Sandbox / test only — no real money
          moves and no customer ever sees this button.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <AlertDescription className="text-xs">
            This calls the admin-gated <code>payfast-checkout-sandbox</code>{" "}
            edge function with the smallest test package. PayFast live is
            disabled. Paystack is unaffected.
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={handleClick}
          disabled={loading}
          className="border-amber-400"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Opening sandbox…
            </>
          ) : (
            "Start PayFast Sandbox Test"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
