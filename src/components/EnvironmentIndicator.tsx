import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import {
  FlaskConical,
  Sparkles,
  CheckCircle2,
  Loader2,
  Database,
  Signal,
  Handshake,
} from "lucide-react";
import { toast } from "sonner";

// ── Preview Banner (for unauthenticated / public search) ──────────────

interface DemoModeBannerProps {
  variant?: "compact" | "full";
}

export function DemoModeBanner({ variant = "full" }: DemoModeBannerProps) {
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-lg mb-6">
        <span className="text-xs font-medium text-muted-foreground">Preview</span>
        <span className="text-xs text-muted-foreground">— Sign in to search real counterparties and create matches.</span>
        <Link to="/auth" className="ml-auto">
          <button className="px-3 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-accent transition-colors">
            Sign in
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-4 bg-muted/30 border border-border rounded-lg mb-6">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground mb-1">Preview mode</p>
        <p className="text-sm text-muted-foreground">
          You are viewing sample results.{" "}
          <Link to="/auth" className="text-primary hover:underline">Sign in</Link> or{" "}
          <Link to="/auth" className="text-primary hover:underline">create an account</Link> to search real counterparties and create matches.
        </p>
      </div>
    </div>
  );
}

// ── Sandbox Indicator (for authenticated console) ───────────────────────

interface SandboxIndicatorProps {
  isSandbox?: boolean;
}

export function SandboxIndicator({ isSandbox = true }: SandboxIndicatorProps) {
  const [generatingSamples, setGeneratingSamples] = useState(false);
  const [sampleStats, setSampleStats] = useState<{
    signals?: number;
    matches?: number;
    webhooks?: number;
  } | null>(null);

  const generateSampleData = async () => {
    setGeneratingSamples(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in to generate sample data");
        return;
      }

      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

      const signalPromises = [
        {
          type: "buyer",
          content: {
            what: "Surgical Masks (FFP2)",
            how_much: 10000,
            unit: "units",
            where: "Johannesburg",
            when: "2024-Q1",
            budget: 50000,
            currency: "ZAR",
          },
        },
        {
          type: "seller",
          content: {
            what: "Industrial Safety Gloves",
            how_much: 5000,
            unit: "pairs",
            where: "Durban",
            when: "2024-Q1",
          },
        },
        {
          type: "buyer",
          content: {
            what: "Medical Sanitiser (70% Alcohol)",
            how_much: 500,
            unit: "litres",
            where: "Cape Town",
            when: "2024-Q1",
            budget: 25000,
            currency: "ZAR",
          },
        },
      ].map((body) =>
        fetch(`${baseUrl}/signals`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        })
      );

      await Promise.all(signalPromises);

      const matchPromises = [
        {
          buyer: { id: "SAMPLE_BUYER_001", name: "Sample Buyer Corp" },
          seller: { id: "SAMPLE_SELLER_001", name: "Sample Seller Inc" },
          commodity: "PPE Equipment Bundle",
          quantity: { amount: 1000, unit: "units" },
          price: { amount: 15000, currency: "ZAR" },
          terms: "Sample test match for demonstration",
        },
        {
          buyer: { id: "SAMPLE_BUYER_002", name: "Test Buyer Ltd" },
          seller: { id: "SAMPLE_SELLER_002", name: "Test Seller Co" },
          commodity: "Medical Supplies",
          quantity: { amount: 500, unit: "kg" },
          price: { amount: 25000, currency: "ZAR" },
          terms: "Sample sandbox match",
        },
      ].map((body) =>
        fetch(`${baseUrl}/match`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `sample-${Date.now()}-${Math.random()}`,
          },
          body: JSON.stringify(body),
        })
      );

      await Promise.all(matchPromises);

      setSampleStats({ signals: 3, matches: 2, webhooks: 0 });
      toast.success("Sample data generated successfully!");
    } catch (error) {
      console.error("Error generating sample data:", error);
      toast.error("Failed to generate sample data");
    } finally {
      setGeneratingSamples(false);
    }
  };

  if (!isSandbox) return null;

  return (
    <div className="mb-6">
      <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
        <FlaskConical className="h-4 w-4 text-amber-600 shrink-0" />
        <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
            <Badge
              variant="outline"
              className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 border-amber-300 shrink-0 w-fit"
            >
              <FlaskConical className="h-3 w-3 mr-1" />
              Sandbox Environment
            </Badge>
            <span className="text-sm text-amber-800 dark:text-amber-200">
              You're in a safe testing environment. All data is isolated and can be deleted anytime.
            </span>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0 w-fit">
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Sample Data
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate Sample Data</DialogTitle>
                <DialogDescription>
                  Populate your sandbox with sample signals and matches for testing. This data is safe to
                  delete and won't affect production.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <Alert>
                  <Database className="h-4 w-4" />
                  <AlertDescription>
                    <strong>What will be created:</strong>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                      <li>3 sample signals (2 buyer, 1 seller)</li>
                      <li>2 sample matches with test data</li>
                      <li>Audit trail entries for all actions</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                {sampleStats && (
                  <Card className="border-green-500 bg-green-50 dark:bg-green-950">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-300">
                        <CheckCircle2 className="h-4 w-4" />
                        Sample Data Generated
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <Signal className="h-4 w-4" />
                          Signals
                        </span>
                        <Badge variant="secondary">{sampleStats.signals}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <Handshake className="h-4 w-4" />
                          Matches
                        </span>
                        <Badge variant="secondary">{sampleStats.matches}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Button onClick={generateSampleData} disabled={generatingSamples} className="w-full">
                  {generatingSamples ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Sample Data
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  💡 Sample data uses your sandbox API key and appears in all dashboard views
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </AlertDescription>
      </Alert>
    </div>
  );
}
