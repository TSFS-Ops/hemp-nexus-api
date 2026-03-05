import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Coins, Zap, Crown, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
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
  const [purchasing, setPurchasing] = useState<string | null>(null);

  const handlePurchase = async (pkg: CreditPackage) => {
    if (!session) {
      toast.error("Please sign in to purchase credits");
      return;
    }

    setPurchasing(pkg.id);
    try {
      const { data, error } = await supabase.functions.invoke("token-purchase", {
        method: "POST",
        body: {
          action: "initialize",
          package_id: pkg.id,
          amount: pkg.price,
          credits: pkg.credits,
          currency: pkg.currency,
        },
      });

      if (error) throw error;

      if (data?.authorization_url) {
        window.location.href = data.authorization_url;
      } else if (data?.reference) {
        toast.success("Purchase initiated", { description: `Reference: ${data.reference}` });
      } else {
        toast.info("Purchase request submitted. Check your billing history for status.");
      }
    } catch (err: any) {
      console.error("Purchase error:", err);
      toast.error("Failed to initiate purchase", { description: err.message });
    } finally {
      setPurchasing(null);
    }
  };

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
              <Button
                className="w-full"
                variant={pkg.popular ? "default" : "outline"}
                onClick={() => handlePurchase(pkg)}
                disabled={purchasing !== null}
              >
                {purchasing === pkg.id ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</>
                ) : (
                  <><Coins className="h-4 w-4 mr-2" />Buy {pkg.credits} Credits</>
                )}
              </Button>
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
