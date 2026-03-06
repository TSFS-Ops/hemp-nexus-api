import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getConsoleUrl } from "@/lib/hostname";
import { PublicPageLayout } from "@/components/PublicPageLayout";

const packages = [
  {
    name: "Starter",
    price: 1799,
    credits: 20,
    perCredit: "89.95",
    description: "For small businesses testing the waters",
    features: [
      "20 Proof-of-Intent credits",
      "Full API access",
      "Email support",
      "7-day refund on unused credits",
    ],
    popular: false,
  },
  {
    name: "Professional",
    price: 6299,
    credits: 100,
    perCredit: "62.99",
    description: "For growing businesses with regular trading",
    features: [
      "100 Proof-of-Intent credits",
      "Full API access",
      "Priority email support",
      "Webhook integrations",
      "7-day refund on unused credits",
    ],
    popular: true,
  },
  {
    name: "Enterprise",
    price: 26999,
    credits: 500,
    perCredit: "54.00",
    description: "For high-volume traders and institutions",
    features: [
      "500 Proof-of-Intent credits",
      "Full API access",
      "Dedicated support",
      "Webhook integrations",
      "Custom integrations",
      "7-day refund on unused credits",
    ],
    popular: false,
  },
];

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
            Purchase prepaid credits to record Proof-of-Intent for your trade compliance needs.
          </p>
          <p className="text-sm text-muted-foreground">
            All prices in ZAR. No hidden fees. Unused credits refundable within 7 days.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-16 md:pb-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {packages.map((pkg) => (
              <Card 
                key={pkg.name} 
                className={`relative flex flex-col ${pkg.popular ? 'border-primary shadow-lg scale-105' : ''}`}
              >
                {pkg.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    Most Popular
                  </Badge>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-xl">{pkg.name}</CardTitle>
                  <CardDescription>{pkg.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="text-center mb-6">
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-4xl font-bold text-foreground">R{pkg.price.toLocaleString()}</span>
                      <span className="text-muted-foreground">ZAR</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {pkg.credits} credits · R{pkg.perCredit}/credit
                    </p>
                  </div>
                  <ul className="space-y-3">
                    {pkg.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button asChild className="w-full" variant={pkg.popular ? "default" : "outline"}>
                    <a href={consoleBillingUrl}>Get Started</a>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="py-16 bg-muted/30 border-t border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Need an Annual Licence?
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-6">
            For high-volume institutional trading, we offer annual licence agreements 
            starting at $25,000/year with dedicated support and custom integrations.
          </p>
          <Button asChild variant="outline">
            <a href="mailto:support@izenzo.co.za">Contact Sales</a>
          </Button>
        </div>
      </section>

    </PublicPageLayout>
  );
}
