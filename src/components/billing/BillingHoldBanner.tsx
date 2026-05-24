import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

interface Props { orgId: string | null | undefined; }

export function BillingHoldBanner({ orgId }: Props) {
  const { data } = useQuery({
    queryKey: ["org-billing-hold", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("billing_hold, billing_hold_reason")
        .eq("id", orgId!)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });
  if (!data?.billing_hold) return null;
  return (
    <div className="border border-destructive/40 bg-destructive/5 rounded-sm p-3 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" aria-hidden />
      <div className="text-sm">
        <div className="font-medium">Billing hold active</div>
        <div className="text-xs text-muted-foreground">
          Credit purchases and credit-burn actions are blocked.
          {data.billing_hold_reason ? ` Reason: ${data.billing_hold_reason}` : ""}
        </div>
      </div>
    </div>
  );
}
