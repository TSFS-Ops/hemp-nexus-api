import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Coins, CreditCard, TrendingUp, AlertTriangle, History, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { TokenBalanceDisplay } from "@/components/TokenBalanceDisplay";
import { cn } from "@/lib/utils";

// Token packages from Price List (NGN pricing for Africa via Paystack)
const TOKEN_PACKAGES = [
  { 
    id: 'starter',
    tokens: 10000, 
    price_usd: 500,
    price_ngn: 400000, 
    label: 'Starter',
    pricePerToken: 0.05,
    discount: null,
  },
  { 
    id: 'growth',
    tokens: 50000, 
    price_usd: 2250,
    price_ngn: 1800000, 
    label: 'Growth',
    pricePerToken: 0.045,
    discount: '10% off',
    popular: true,
  },
  { 
    id: 'scale',
    tokens: 100000, 
    price_usd: 4000,
    price_ngn: 3200000, 
    label: 'Scale',
    pricePerToken: 0.04,
    discount: '20% off',
  },
  { 
    id: 'enterprise',
    tokens: 500000, 
    price_usd: 17500,
    price_ngn: 14000000, 
    label: 'Enterprise',
    pricePerToken: 0.035,
    discount: '30% off',
  },
];

export default function Billing() {
  const { session, isAdmin } = useAuth();
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch token balance
  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ["token-balance-billing"],
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

  // Fetch token usage stats
  const { data: usageStats } = useQuery({
    queryKey: ["token-usage-stats"],
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const { data, error } = await supabase
        .from("token_ledger")
        .select("tokens_burned, action_type, created_at")
        .gte("created_at", monthStart.toISOString());
      
      if (error) throw error;
      
      const totalBurned = data?.reduce((sum, e) => sum + (e.tokens_burned || 0), 0) || 0;
      const actionBreakdown: Record<string, number> = {};
      for (const entry of data || []) {
        if (entry.action_type) {
          actionBreakdown[entry.action_type] = (actionBreakdown[entry.action_type] || 0) + (entry.tokens_burned || 0);
        }
      }
      
      return { totalBurned, actionBreakdown, transactionCount: data?.length || 0 };
    },
    enabled: !!session,
  });

  // Fetch recent transactions
  const { data: recentTransactions } = useQuery({
    queryKey: ["recent-token-transactions"],
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
    setIsProcessing(true);
    setSelectedPackage(packageId);
    
    try {
      const pkg = TOKEN_PACKAGES.find(p => p.id === packageId);
      if (!pkg) throw new Error("Package not found");

      const { data, error } = await supabase.functions.invoke("token-purchase", {
        body: { packageId },
      });

      if (error) throw error;

      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        toast.error("No checkout URL returned");
      }
    } catch (err) {
      console.error("Purchase error:", err);
      toast.error("Failed to initiate purchase. Please try again.");
    } finally {
      setIsProcessing(false);
      setSelectedPackage(null);
    }
  };

  const currentBalance = balance?.balance || 0;
  const minimumRequired = balance?.minimum_required || 5000;
  const isLow = currentBalance <= 6000;
  const isCritical = currentBalance <= minimumRequired + 1000;

  return (
    <DashboardLayout activeSection="usage" onSectionChange={() => {}} isAdmin={isAdmin}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Usage & Billing</h1>
          <p className="text-muted-foreground">
            Manage your token balance and purchase additional tokens
          </p>
        </header>

        {/* Current Balance Card */}
        <Card className={cn(
          isCritical && "border-amber-500",
          isLow && !isCritical && "border-yellow-500"
        )}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Token Balance
            </CardTitle>
            <CardDescription>
              Your current token balance and usage this month
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
                <p className="text-sm text-muted-foreground">Burned This Month</p>
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

        {/* Token Packages */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Purchase Tokens</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {TOKEN_PACKAGES.map((pkg) => (
              <Card 
                key={pkg.id}
                className={cn(
                  "relative cursor-pointer transition-all hover:border-primary",
                  pkg.popular && "border-primary ring-1 ring-primary"
                )}
                onClick={() => !isProcessing && handlePurchase(pkg.id)}
              >
                {pkg.popular && (
                  <Badge 
                    className="absolute -top-2 left-1/2 -translate-x-1/2"
                  >
                    Most Popular
                  </Badge>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{pkg.label}</CardTitle>
                  <CardDescription>
                    {pkg.tokens.toLocaleString()} tokens
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-2xl font-bold">
                      ₦{pkg.price_ngn.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ~${pkg.price_usd.toLocaleString()} USD
                    </p>
                    <p className="text-sm text-muted-foreground">
                      ${pkg.pricePerToken.toFixed(3)}/token
                    </p>
                    {pkg.discount && (
                      <Badge variant="secondary" className="text-xs">
                        {pkg.discount}
                      </Badge>
                    )}
                  </div>
                  <Button 
                    className="w-full mt-4" 
                    variant={pkg.popular ? "default" : "outline"}
                    disabled={isProcessing}
                  >
                    {isProcessing && selectedPackage === pkg.id ? (
                      <>
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Processing...
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

        <Separator />

        {/* Usage Breakdown */}
        {usageStats?.actionBreakdown && Object.keys(usageStats.actionBreakdown).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Usage Breakdown
              </CardTitle>
              <CardDescription>
                Token usage by action type this month
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(usageStats.actionBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([action, tokens]) => (
                    <div key={action} className="flex items-center justify-between">
                      <span className="text-sm capitalize">
                        {action.replace(/_/g, ' ')}
                      </span>
                      <span className="font-medium">
                        {tokens.toLocaleString()} tokens
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
              Recent Token Activity
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
                        tx.outcome === 'blocked' && "text-destructive"
                      )}>
                        {tx.outcome === 'blocked' ? 'Blocked' : `-${tx.tokens_burned}`}
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
                No recent token activity
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
