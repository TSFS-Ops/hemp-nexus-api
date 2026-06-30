import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Coins, AlertTriangle, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";

interface TokenBalanceDisplayProps {
  variant?: "compact" | "full";
  className?: string;
}

export function TokenBalanceDisplay({ variant = "compact", className }: TokenBalanceDisplayProps) {
  const { session } = useAuth();
  
  // Fetch user's org_id first
  const { data: userProfile } = useQuery({
    queryKey: ["user-profile-org", session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session!.user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  const { data: balance, isLoading } = useQuery({
    queryKey: ["token-balance", userProfile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_balances")
        .select("balance, minimum_required")
        .eq("org_id", userProfile!.org_id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!session && !!userProfile?.org_id,
    // Poll every 5 minutes instead of 30s - at 100x users the 30s poll
    // generates enormous read load. Balance updates on mutation via cache invalidation.
    refetchInterval: 5 * 60 * 1000,
  });

  if (!session || isLoading || !balance) {
    return null;
  }

  const currentBalance = balance.balance || 0;
  const minimumRequired = balance.minimum_required ?? 0;
  const isLow = currentBalance <= 200;
  const isCritical = currentBalance <= 50;
  const isBlocked = currentBalance < minimumRequired;

  const formatBalance = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  if (variant === "compact") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link 
              to="/desk/billing"
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors",
                isBlocked 
                  ? "bg-destructive/10 text-destructive" 
                  : isCritical 
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : isLow
                      ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                      : "bg-muted hover:bg-muted/80",
                className
              )}
            >
              {isBlocked ? (
                <AlertTriangle className="h-4 w-4" />
              ) : isCritical ? (
                <TrendingDown className="h-4 w-4" />
              ) : (
                <Coins className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">{formatBalance(currentBalance)}</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="space-y-1">
              <p className="font-medium">Credit Balance: {currentBalance.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">
                Minimum required: {minimumRequired.toLocaleString()}
              </p>
              {isBlocked && (
                <p className="text-xs text-destructive font-medium">
                  API calls blocked. Purchase credits to continue.
                </p>
              )}
              {isCritical && !isBlocked && (
                <p className="text-xs text-amber-600 font-medium">
                  Balance critically low. Purchase credits soon.
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Full variant
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">Credit Balance</span>
        </div>
        <Badge 
          variant={isBlocked ? "destructive" : isCritical ? "outline" : "secondary"}
          className={cn(
            isCritical && !isBlocked && "border-amber-500 text-amber-600",
            isLow && !isCritical && "border-yellow-500 text-yellow-600"
          )}
        >
          {currentBalance.toLocaleString()} credits
        </Badge>
      </div>
      
      {/* Progress bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn(
            "h-full transition-all duration-300",
            isBlocked 
              ? "bg-destructive" 
              : isCritical 
                ? "bg-amber-500" 
                : isLow
                  ? "bg-yellow-500"
                  : "bg-primary"
          )}
          style={{ 
            width: `${Math.min(100, (currentBalance / (minimumRequired * 2)) * 100)}%` 
          }}
        />
      </div>
      
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Min: {minimumRequired.toLocaleString()}</span>
        <Link 
          to="/desk/billing" 
          className="text-primary hover:underline"
        >
          Buy Credits →
        </Link>
      </div>

      {isBlocked && (
        <div className="flex items-center gap-2 p-2 bg-destructive/10 rounded-md text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>API calls blocked. <a href="/desk/billing" className="underline">Buy credits</a> to restore access.</span>
        </div>
      )}
    </div>
  );
}
