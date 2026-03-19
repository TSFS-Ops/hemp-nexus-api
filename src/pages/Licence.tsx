import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Calendar, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import { SectionHeader } from "@/components/ui/section-header";

const LICENCE_TIERS = {
  professional: {
    name: 'Professional',
    price: 5000,
    features: ['100 transactions/month', '5 team members', 'Email support'],
  },
  corporate: {
    name: 'Corporate',
    price: 15000,
    features: ['500 transactions/month', '25 team members', 'Priority support'],
  },
  institutional: {
    name: 'Institutional',
    price: 50000,
    features: ['Unlimited transactions', 'Unlimited team members', 'Dedicated support'],
  },
  sovereign: {
    name: 'Sovereign',
    price: null,
    features: ['Custom limits', 'Custom integrations', 'White-glove service'],
  },
};

export default function Licence() {
  const { session, isAdmin } = useAuth();

  const { data: licenceData, isLoading } = useQuery({
    queryKey: ["licence-status"],
    queryFn: async () => {
      const now = new Date().toISOString();
      
      // Get current active licence
      const { data: current, error: currentError } = await supabase
        .from("licences")
        .select("*")
        .eq("status", "active")
        .gt("expires_at", now)
        .order("expires_at", { ascending: false })
        .maybeSingle();
      
      if (currentError) throw currentError;

      // Get licence history
      const { data: history, error: historyError } = await supabase
        .from("licences")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      
      if (historyError) throw historyError;

      return { current, history: history || [] };
    },
    enabled: !!session,
  });

  const currentLicence = licenceData?.current;
  const hasLicence = !!currentLicence;
  const daysRemaining = currentLicence 
    ? differenceInDays(new Date(currentLicence.expires_at), new Date())
    : null;
  const isExpiringSoon = daysRemaining !== null && daysRemaining <= 30;

  const handleUpgrade = (tier: string) => {
    // TODO: Implement Stripe checkout for licence purchase
    console.log('Upgrade to:', tier);
  };

  return (
    <DashboardLayout isAdmin={isAdmin}>
      <div className="space-y-6">
        <SectionHeader
          title="Licence Management"
          description="View and manage your annual API licence"
        />

        {/* Current Licence Status */}
        <Card className={cn(
          !hasLicence && "border-destructive",
          isExpiringSoon && hasLicence && "border-amber-500"
        )}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Current Licence
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasLicence ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Badge variant="default" className="text-sm">
                      {LICENCE_TIERS[currentLicence.tier as keyof typeof LICENCE_TIERS]?.name || currentLicence.tier}
                    </Badge>
                    <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        Expires: {format(new Date(currentLicence.expires_at), 'dd MMM yyyy')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {daysRemaining} days remaining
                      </span>
                    </div>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-500" />
                </div>

                {isExpiringSoon && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-md text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-medium">Licence expiring soon</p>
                      <p className="text-sm opacity-80">
                        Renew your licence to maintain uninterrupted access
                      </p>
                    </div>
                    <Button size="sm" className="ml-auto">
                      Renew Now
                    </Button>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium mb-2">Features included:</p>
                  <ul className="space-y-1">
                    {LICENCE_TIERS[currentLicence.tier as keyof typeof LICENCE_TIERS]?.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <h3 className="text-lg font-semibold">No Active Licence</h3>
                <p className="text-muted-foreground mb-4">
                  An annual licence is required to access billable API features
                </p>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button disabled>
                          Purchase Licence
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Coming soon — contact support@izenzo.co.za for early access</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upgrade Options */}
        {hasLicence && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Upgrade Options</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {Object.entries(LICENCE_TIERS)
                .filter(([key]) => key !== 'sovereign')
                .map(([key, tier]) => {
                  const isCurrentTier = currentLicence?.tier === key;
                  return (
                    <Card 
                      key={key}
                      className={cn(
                        isCurrentTier && "border-primary ring-1 ring-primary"
                      )}
                    >
                      <CardHeader>
                        <CardTitle className="text-lg">{tier.name}</CardTitle>
                        <CardDescription>
                          {tier.price 
                            ? `$${tier.price.toLocaleString()}/year` 
                            : 'Custom pricing'}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 mb-4">
                          {tier.features.map((feature) => (
                            <li key={feature} className="flex items-center gap-2 text-sm">
                              <CheckCircle className="h-4 w-4 text-muted-foreground" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="w-full">
                                <Button 
                                  className="w-full" 
                                  variant={isCurrentTier ? "outline" : "default"}
                                  disabled
                                >
                                  {isCurrentTier ? 'Current Plan' : 'Coming Soon'}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            {!isCurrentTier && (
                              <TooltipContent>
                                <p>Coming soon — contact support@izenzo.co.za for early access</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          </div>
        )}

        {/* Licence History */}
        {licenceData?.history && licenceData.history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Licence History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {licenceData.history.map((licence: any) => (
                  <div 
                    key={licence.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium capitalize">{licence.tier}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(licence.starts_at), 'dd MMM yyyy')} - {format(new Date(licence.expires_at), 'dd MMM yyyy')}
                      </p>
                    </div>
                    <Badge 
                      variant={licence.status === 'active' ? 'default' : 'secondary'}
                    >
                      {licence.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
