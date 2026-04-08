import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

import { getConsoleUrl } from "@/lib/hostname";
import { PublicPageLayout } from "@/components/PublicPageLayout";

const POI_PRICE_ZAR = 10;

export default function Pricing() {
  const consoleAuthUrl = getConsoleUrl("/auth");
  const consoleBillingUrl = getConsoleUrl("/billing");

  return (
    <PublicPageLayout>

      {/* Hero */}
      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-2">
            One price. No tiers. No hidden fees.
          </p>
        </div>
      </section>

      {/* Single Price Card */}
      <section className="pb-16 md:pb-24">
        <div className="max-w-md mx-auto px-4 sm:px-6">
          <Card className="border-primary shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-xl">Proof-of-Intent</CardTitle>
              <CardDescription>Per transaction, pay as you go</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-6">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-bold text-foreground">R{POI_PRICE_ZAR}</span>
                  <span className="text-muted-foreground">ZAR</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">per Proof-of-Intent</p>
              </div>
              <ul className="space-y-3">
                {[
                  "Full API access",
                  "Webhook integrations",
                  "Email support",
                  "All prices in ZAR - no hidden fees",
                ].map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full">
                <a href={consoleBillingUrl}>Get Started</a>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>

    </PublicPageLayout>
  );
}
