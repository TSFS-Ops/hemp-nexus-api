import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Coins, CheckCircle2, AlertTriangle } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import { useAsyncAction } from "@/hooks/use-async-action";
import { apiFetch, generateIdempotencyKey } from "@/lib/api-client";
import { toast } from "sonner";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  currency: string;
  popular?: boolean;
  features: string[];
}

const PACKAGES: CreditPackage[] = [
  {
    id: "starter",
    name: "Starter",
    credits: 20,
    price: 1799,
    currency: "ZAR",
    features: ["20 credits", "Basic API access", "Email support"],
  },
  {
    id: "professional",
    name: "Professional",
    credits: 100,
    price: 6299,
    currency: "ZAR",
    popular: true,
    features: ["100 credits", "Full API access", "Priority support", "Webhook delivery"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    credits: 500,
    price: 26999,
    currency: "ZAR",
    features: ["500 credits", "Full API access", "Dedicated support", "SLA guarantee", "Custom integrations"],
  },
];

export function BillingCheckout() {
  const { session } = useAuth();

  const purchaseAction = useCallback(
    async (pkg: CreditPackage) => {
      if (!session) throw new Error("Please sign in to purchase credits");

      const idempotencyKey = generateIdempotencyKey("purchase");

      const data = await apiFetch<{
        authorization_url?: string;
        reference?: string;
      }>("token-purchase", {
        method: "POST",
        idempotencyKey,
        body: JSON.stringify({
          action: "initialize",
          package_id: pkg.id,
          amount: pkg.price,
          credits: pkg.credits,
          currency: pkg.currency,
        }),
      });

      if (data?.authorization_url) {
        window.location.href = data.authorization_url;
      } else if (data?.reference) {
        toast.success("Purchase initiated", { description: `Reference: ${data.reference}` });
      } else {
        toast.info("Purchase request submitted. Check your billing history for status.");
      }
    },
    [session]
  );

  const { run: handlePurchase, loading: purchasing } = useAsyncAction<[CreditPackage]>(
    purchaseAction,
    { errorMessage: "Failed to initiate purchase" }
  );

  const formatPrice = (amount: number) => {
    return `R ${(amount / 100).toLocaleString("en-ZA", { minimumFractionDigits: 0 })}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Purchase Credits</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Credits are consumed when you confirm intent, run screenings, or generate evidence packs.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PACKAGES.map((pkg) => (
          <Card key={pkg.id} className={`relative ${pkg.popular ? "border-primary shadow-md" : ""}`}>
            {pkg.popular && (
              <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                Most Popular
              </Badge>
            )}
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{pkg.name}</CardTitle>
              <div className="mt-2">
                <span className="text-3xl font-bold">{formatPrice(pkg.price)}</span>
              </div>
              <CardDescription>{pkg.credits} credits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {pkg.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <LoadingButton
                className="w-full"
                variant={pkg.popular ? "default" : "outline"}
                onClick={() => handlePurchase(pkg)}
                loading={purchasing}
                loadingText="Processing…"
              >
                <Coins className="h-4 w-4 mr-2" />Buy {pkg.credits} Credits
              </LoadingButton>
            </CardContent>
          </Card>
        ))}
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          All prices are in ZAR. No VAT charged — supplier not VAT registered in South Africa. 
          Charged by Starfair162 (Pty) Ltd t/a Izenzo. Credits are non-refundable once used.
        </AlertDescription>
      </Alert>
    </div>
  );
}