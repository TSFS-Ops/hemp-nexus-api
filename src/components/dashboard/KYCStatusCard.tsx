/**
 * KYCStatusCard — Shows the current organisation's KYC completion status.
 * Fetches from kyc_status table scoped to the user's org.
 */

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, ShieldAlert, Clock, AlertTriangle } from "lucide-react";

const STATUS_CONFIG: Record<string, {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  icon: typeof ShieldCheck;
  description: string;
}> = {
  approved: {
    label: "Approved",
    variant: "default",
    icon: ShieldCheck,
    description: "Your organisation's KYC is complete. You can progress deals without restriction.",
  },
  pending: {
    label: "Pending Review",
    variant: "secondary",
    icon: Clock,
    description: "Your KYC submission is under review. Some deal actions may be restricted until approval.",
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    icon: ShieldAlert,
    description: "Your KYC submission was rejected. Please re-submit the required documents to proceed.",
  },
  not_started: {
    label: "Not Started",
    variant: "outline",
    icon: AlertTriangle,
    description: "KYC has not been started. Complete your verification to unlock full deal functionality.",
  },
};

export function KYCStatusCard() {
  const { session } = useAuth();

  const { data: kycStatus, isLoading, isError } = useQuery({
    queryKey: ["kyc-status"],
    queryFn: async () => {
      // Get user's org_id from profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session!.user.id)
        .single();

      if (profileError || !profile?.org_id) return null;

      const { data, error } = await supabase
        .from("kyc_status")
        .select("status, completeness_percentage, last_reviewed_at")
        .eq("org_id", profile.org_id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-2 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) return null; // Fail silently — non-critical card

  const status = kycStatus?.status || "not_started";
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.not_started;
  const completeness = kycStatus?.completeness_percentage ?? 0;
  const Icon = config.icon;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Icon className="h-4 w-4" />
            KYC Verification
          </CardTitle>
          <Badge variant={config.variant} className="text-xs">
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {config.description}
        </p>
        {status !== "not_started" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Completeness</span>
              <span className="font-medium">{completeness}%</span>
            </div>
            <Progress value={completeness} className="h-1.5" />
          </div>
        )}
        {kycStatus?.last_reviewed_at && (
          <p className="text-[10px] text-muted-foreground">
            Last reviewed: {new Date(kycStatus.last_reviewed_at).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
