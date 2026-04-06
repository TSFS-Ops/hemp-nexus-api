import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Coins, CreditCard, TrendingUp, AlertTriangle, History, 
  Shield, Building2, FileText, Check, Mail, Info
} from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/ui/section-header";
import { TokenBalanceDisplay } from "@/components/TokenBalanceDisplay";
import { cn } from "@/lib/utils";

// ==============================================
// CREDIT PACKAGES (ZAR pricing)
// ==============================================
const CREDIT_PACKAGES = [
  { 
    id: 'single',
    credits: 1, 
    priceZar: 10,
    label: 'Proof-of-Intent',
    pricePerCredit: '10.00',
    description: 'R10 per POI — pay as you go',
    popular: true,
  },
];

// ==============================================
// ANNUAL LICENCES (manual invoice)
// ==============================================
const LICENCE_TIERS = [
  { name: 'Professional', price: '$25,000/year', description: 'Standard API access with SLA' },
  { name: 'Institutional', price: '$75k–$150k/year', description: 'Enhanced limits and dedicated support' },
  { name: 'Corridor / Network', price: '$250k+/year', description: 'Custom integration and white-label options' },
];

// ==============================================
// CHARGING ENTITY
// ==============================================
const CHARGING_ENTITY = {
  name: "Starfair162 (Pty) Ltd t/a Izenzo",
  registration: "2018 / 331720 / 07",
  address: "44 Campbell Street, Port Alfred, South Africa",
  supportEmail: "support@izenzo.co.za",
  vatNote: "No VAT charged — supplier not VAT registered in South Africa.",
};

export default function Billing() {
  const { session, isAdmin } = useAuth();
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentFailure, setPaymentFailure] = useState<string | null>(null);
  const [paymentCancelled, setPaymentCancelled] = useState(false);
  const queryClient = useQueryClient();
  const verifyAttempted = useRef(false);

  // Auto-verify payment when returning from Paystack checkout
  useEffect(() => {
    if (!session || verifyAttempted.current) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const reference = params.get("reference") || params.get("trxref");

    // Clean URL immediately regardless of outcome
    if (status || reference) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Handle cancelled/abandoned checkout
    if (status === "cancelled" || status === "cancel") {
      setPaymentCancelled(true);
      return;
    }

    // Handle explicit failure status from payment provider
    if (status === "failed" || status === "error") {
      setPaymentFailure("Your payment was not successful. Your card was not charged. Please try again or use a different payment method. If the problem persists, contact support@izenzo.co.za.");
      toast.error(
        "Payment failed. Your card was not charged.",
        { duration: 8000 }
      );
      return;
    }

    // Handle case where user returns from Paystack without explicit success status
    // (e.g. user closes checkout, Paystack redirects with just trxref)
    if (!status && reference) {
      verifyAttempted.current = true;
      // Verify the transaction — it may have succeeded even without status=success
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("token-purchase/verify", {
            method: "POST",
            body: { reference },
          });
          if (error) {
            toast.info(
              "We couldn't confirm your payment. If credits don't appear within 5 minutes, email support@izenzo.co.za with your payment reference.",
              { duration: 10000 }
            );
            return;
          }
          if (data?.success) {
            if (data.alreadyCredited) {
              toast.success("Credits already applied to your account.");
            } else {
              toast.success(`${data.credits} credits added. New balance: ${data.newBalance?.toLocaleString() ?? "updated"}.`);
            }
            queryClient.invalidateQueries({ queryKey: ["credit-balance-billing"] });
            queryClient.invalidateQueries({ queryKey: ["recent-credit-transactions"] });
            queryClient.invalidateQueries({ queryKey: ["credit-usage-stats"] });
            queryClient.invalidateQueries({ queryKey: ["token-balance"] });
            queryClient.invalidateQueries({ queryKey: ["token-balance-confirm-single"] });
          } else {
            const paystackStatus = data?.paystackStatus;
            if (paystackStatus === "abandoned") {
              toast.info("Payment was not completed. No credits were charged.");
            } else if (paystackStatus === "failed") {
              setPaymentFailure("Your payment was not successful. Your card was not charged. Please try again below or use a different payment method.");
              toast.error("Payment failed. Your card was not charged.", { duration: 8000 });
            } else {
              toast.info("Payment is still being processed. Credits will appear shortly. If they don't arrive within 5 minutes, contact support@izenzo.co.za.");
            }
          }
        } catch (err) {
          console.error("Verify error:", err);
          toast.info(
            "We couldn't confirm your payment status. If you were charged, credits will appear within 5 minutes. Otherwise, email support@izenzo.co.za.",
            { duration: 10000 }
          );
        }
      })();
      return;
    }

    if (status === "success" && reference) {
      verifyAttempted.current = true;
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("token-purchase/verify", {
            method: "POST",
            body: { reference },
          });
          if (error) {
            console.error("Verify error:", error);
            toast.error(
              "Could not verify payment. If credits don't appear within 5 minutes, email support@izenzo.co.za with your payment reference."
            );
            return;
          }
          if (data?.success) {
            if (data.alreadyCredited) {
              toast.success("Credits already applied to your account.");
            } else {
              toast.success(`${data.credits} credits added. New balance: ${data.newBalance?.toLocaleString() ?? "updated"}.`);
            }
            // Refresh ALL balance queries across the app
            queryClient.invalidateQueries({ queryKey: ["credit-balance-billing"] });
            queryClient.invalidateQueries({ queryKey: ["recent-credit-transactions"] });
            queryClient.invalidateQueries({ queryKey: ["credit-usage-stats"] });
            queryClient.invalidateQueries({ queryKey: ["token-balance"] });
            queryClient.invalidateQueries({ queryKey: ["token-balance-confirm-single"] });
          } else {
            const paystackStatus = data?.paystackStatus;
            if (paystackStatus === "abandoned") {
              toast.info("Payment was not completed. No credits were charged.");
            } else if (paystackStatus === "failed") {
              toast.error("Payment failed. Your card was not charged. Please try again or use a different payment method.");
            } else {
              toast.info("Payment is still being processed. Credits will appear shortly. If they don't arrive within 5 minutes, contact support@izenzo.co.za.");
            }
          }
        } catch (err) {
          console.error("Verify error:", err);
          toast.error(
            "Could not verify payment. If credits don't appear within 5 minutes, email support@izenzo.co.za with your payment reference."
          );
        }
      })();
    }
  }, [session, queryClient]);

  // Fetch credit balance
  const { data: balance } = useQuery({
    queryKey: ["credit-balance-billing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_balances")
        .select("balance, minimum_required")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  // Fetch credit usage stats
  const { data: usageStats } = useQuery({
    queryKey: ["credit-usage-stats"],
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const { data, error } = await supabase
        .from("token_ledger")
        .select("tokens_burned, action_type, created_at")
        .gte("created_at", monthStart.toISOString());
      
      if (error) throw error;
      
      const totalBurned = data?.reduce((sum, e) => sum + Math.max(0, e.tokens_burned || 0), 0) || 0;
      const actionBreakdown: Record<string, number> = {};
      for (const entry of data || []) {
        if (entry.action_type && entry.tokens_burned > 0) {
          actionBreakdown[entry.action_type] = (actionBreakdown[entry.action_type] || 0) + entry.tokens_burned;
        }
      }
      
      return { totalBurned, actionBreakdown, transactionCount: data?.length || 0 };
    },
    enabled: !!session,
  });

  // Fetch recent transactions
  const { data: recentTransactions } = useQuery({
    queryKey: ["recent-credit-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_ledger")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  const handlePurchase = async (packageId: string) => {
    if (!session) {
      toast.error("Please sign in to purchase credits.");
      return;
    }

    setIsProcessing(true);
    setSelectedPackage(packageId);
    
    try {
      const { data, error } = await supabase.functions.invoke("token-purchase", {
        method: "POST",
        body: { 
          packageId,
          callbackUrl: `${window.location.origin}/billing?status=success`,
          cancelUrl: `${window.location.origin}/billing?status=cancelled`,
        },
      });

      if (error) {
        // Try to surface structured errors returned by the backend function
        const anyError = error as unknown as {
          message?: string;
          context?: { body?: any };
        };

        const rawBody = anyError?.context?.body;
        let body: any = rawBody;
        if (typeof rawBody === "string") {
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = { error: rawBody };
          }
        }

        const providerCode = body?.providerCode as string | undefined;
        const providerMessage = body?.providerMessage as string | undefined;
        const fallbackMessage = body?.error || anyError?.message;

        const message =
          providerCode === "unsupported_currency"
            ? "Your Paystack account is not enabled for USD. Enable USD on your Paystack integration (or tell me to switch pricing to ZAR)."
            : providerMessage || fallbackMessage || "Failed to initiate purchase. Please try again.";

        console.error("Purchase error:", error);
        toast.error(message);
        return;
      }

      if (data?.checkoutUrl) {
        // Start a timeout: if we're still on this page after 8s, the redirect failed
        const redirectTimeout = setTimeout(() => {
          setIsProcessing(false);
          setSelectedPackage(null);
          toast.error(
            "Redirect to payment page did not complete. Please try again, or copy this link and open it manually.",
            { duration: 10000 }
          );
        }, 8000);
        // Store timeout so cleanup can clear it if page actually unloads
        (window as any).__billingRedirectTimeout = redirectTimeout;
        window.location.href = data.checkoutUrl;
      } else {
        toast.error("No checkout URL was returned. Please try again or contact support@izenzo.co.za.");
        setIsProcessing(false);
        setSelectedPackage(null);
      }
    } catch (err) {
      console.error("Purchase error:", err);
      toast.error("Failed to initiate purchase. Please try again.");
      setIsProcessing(false);
      setSelectedPackage(null);
    }
  };

  const currentBalance = balance?.balance || 0;
  const minimumRequired = balance?.minimum_required || 0;
  const isLow = minimumRequired > 0 && currentBalance <= minimumRequired * 1.2;
  const isCritical = minimumRequired > 0 && currentBalance <= minimumRequired + 1000;

  return (
    <DashboardLayout isAdmin={isAdmin}>
      <div className="space-y-6">
        <SectionHeader
          title="API Credits"
          description="Purchase credits to use the Compliance Matching API"
        />

        {/* Payment cancellation banner — persists until dismissed */}
        {paymentCancelled && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-foreground">Payment cancelled</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Your payment was not processed and no credits were charged. You can select a package below to try again.
                </p>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setPaymentCancelled(false)}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Payment failure banner — persists until dismissed */}
        {paymentFailure && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>{paymentFailure}</span>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setPaymentFailure(null)}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Current Balance Card */}
        <Card className={cn(
          isCritical && "border-amber-500",
          isLow && !isCritical && "border-yellow-500"
        )}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Credit Balance
            </CardTitle>
            <CardDescription>
              Your current credit balance and usage this month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Current Balance</p>
                <p className={cn(
                  "text-3xl font-bold",
                  isCritical && "text-amber-600",
                  isLow && !isCritical && "text-yellow-600"
                )}>
                  {currentBalance.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Minimum required: {minimumRequired.toLocaleString()}
                </p>
              </div>
              
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Used This Month</p>
                <p className="text-3xl font-bold">
                  {(usageStats?.totalBurned || 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {usageStats?.transactionCount || 0} transactions
                </p>
              </div>
              
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Available for Actions</p>
                <p className="text-3xl font-bold text-primary">
                  {Math.max(0, currentBalance - minimumRequired).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  After minimum reserve
                </p>
              </div>
            </div>

            {isCritical && (
              <div className="mt-4 flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-md text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">Balance is critically low</p>
                  <p className="text-sm opacity-80">
                    Top up soon to avoid service interruption
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Credit Packages */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Purchase Credits</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {CREDIT_PACKAGES.map((pkg) => (
              <Card 
                key={pkg.id}
                className={cn(
                  "relative transition-all hover:border-primary",
                  pkg.popular && "border-primary ring-1 ring-primary"
                )}
              >
                {pkg.popular && (
                  <Badge className="absolute -top-2 left-1/2 -translate-x-1/2">
                    Most Popular
                  </Badge>
                )}
                <CardHeader className="pb-2 text-center">
                  <CardTitle className="text-lg">{pkg.label}</CardTitle>
                  <CardDescription>{pkg.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-center">
                  <div className="mb-4">
                    <span className="text-4xl font-bold">R{pkg.priceZar.toLocaleString()}</span>
                    <span className="text-muted-foreground"> ZAR</span>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground mb-6">
                    <div className="flex items-center justify-center gap-2">
                      <Coins className="h-4 w-4 text-primary" />
                      <span>{pkg.credits} credits</span>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      <span>R{pkg.pricePerCredit} per credit</span>
                    </div>
                  </div>
                  <Button 
                    className="w-full" 
                    variant={pkg.popular ? "default" : "outline"}
                    onClick={() => handlePurchase(pkg.id)}
                    disabled={isProcessing}
                  >
                    {isProcessing && selectedPackage === pkg.id ? (
                      <>
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Redirecting to payment…
                      </>
                    ) : isProcessing ? (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        Buy Now
                      </>
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        Buy Now
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Payment troubleshooting */}
        <Card className="border-border">
          <CardContent className="py-4">
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground transition-colors">
                Paid but credits not showing?
              </summary>
              <div className="mt-3 space-y-2 text-muted-foreground">
                <p>Credits are usually applied within 30 seconds of payment. If they haven't appeared:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Refresh this page — your balance updates automatically.</li>
                  <li>Check your email for a Paystack receipt confirming the payment went through.</li>
                  <li>If the receipt shows "successful" but credits aren't here after 5 minutes, email <a href={`mailto:${CHARGING_ENTITY.supportEmail}`} className="text-primary hover:underline">{CHARGING_ENTITY.supportEmail}</a> with your payment reference.</li>
                </ol>
                <p className="text-xs mt-2">
                  Include your payment reference (starts with "TRX_") and the email you signed up with. We'll resolve it within 1 business day.
                </p>
              </div>
            </details>
          </CardContent>
        </Card>

        <Separator />

        {/* Annual Licences */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle>Annual Licences</CardTitle>
            </div>
            <CardDescription>
              For institutional access with priority support and custom terms
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              {LICENCE_TIERS.map((tier) => (
                <div key={tier.name} className="p-4 rounded-lg border bg-card">
                  <h4 className="font-semibold">{tier.name}</h4>
                  <p className="text-2xl font-bold text-primary mt-1">{tier.price}</p>
                  <p className="text-sm text-muted-foreground mt-2">{tier.description}</p>
                </div>
              ))}
            </div>
            <Alert className="mt-4">
              <FileText className="h-4 w-4" />
              <AlertDescription>
                Licences are billed via manual invoice. Contact{" "}
                <a href={`mailto:${CHARGING_ENTITY.supportEmail}`} className="text-primary hover:underline">
                  {CHARGING_ENTITY.supportEmail}
                </a>{" "}
                to discuss your requirements.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* Refund Policy */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-lg">Refund Policy</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>• <strong>Unused credits:</strong> Refundable within 7 days of purchase</p>
            <p>• <strong>Consumed credits:</strong> Non-refundable</p>
            <p>• <strong>POI, WaD, and Licences:</strong> Non-refundable once issued</p>
          </CardContent>
        </Card>


        {/* Usage Breakdown */}
        {usageStats?.actionBreakdown && Object.keys(usageStats.actionBreakdown).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Usage Breakdown
              </CardTitle>
              <CardDescription>
                Credit usage by action type this month
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(usageStats.actionBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([action, credits]) => (
                    <div key={action} className="flex items-center justify-between">
                      <span className="text-sm capitalize">
                        {action.replace(/_/g, ' ')}
                      </span>
                      <span className="font-medium">
                        {credits.toLocaleString()} credits
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Recent Credit Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentTransactions && recentTransactions.length > 0 ? (
              <div className="space-y-2">
                {recentTransactions.map((tx) => (
                  <div 
                    key={tx.id} 
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium capitalize">
                        {(tx.action_type || tx.endpoint || 'API Call').replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(tx.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn(
                        "text-sm font-medium",
                        tx.tokens_burned < 0 && "text-green-600",
                        tx.outcome === 'blocked' && "text-destructive"
                      )}>
                        {tx.outcome === 'blocked' ? 'Blocked' : 
                         tx.tokens_burned < 0 ? `+${Math.abs(tx.tokens_burned)}` : 
                         `-${tx.tokens_burned}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Balance: {tx.remaining_balance?.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recent credit activity
              </p>
            )}
          </CardContent>
        </Card>

        {/* Billing Entity */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Billing Entity</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="font-medium">{CHARGING_ENTITY.name}</p>
            <p className="text-muted-foreground">Reg: {CHARGING_ENTITY.registration}</p>
            <p className="text-muted-foreground">{CHARGING_ENTITY.address}</p>
            <div className="flex items-center gap-2 mt-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <a href={`mailto:${CHARGING_ENTITY.supportEmail}`} className="text-primary hover:underline">
                {CHARGING_ENTITY.supportEmail}
              </a>
            </div>
            <p className="text-muted-foreground mt-2 italic">{CHARGING_ENTITY.vatNote}</p>
          </CardContent>
        </Card>

        {/* Payment Security Note */}
        <p className="text-center text-xs text-muted-foreground">
          Payments processed securely by Paystack. All amounts in ZAR.
        </p>
      </div>
    </DashboardLayout>
  );
}