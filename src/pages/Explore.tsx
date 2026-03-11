import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Search, ShieldCheck, ShieldAlert, ShieldX, AlertTriangle,
  CheckCircle2, XCircle, Loader2, Lock, Info, Compass,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/ui/section-header";

interface RiskDelta {
  category: string;
  status: "pass" | "fail" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

interface PreflightResult {
  canCollapse: boolean;
  overallStatus: "pass" | "fail" | "warning";
  deltas: RiskDelta[];
  checkedAt: string;
  note: string;
}

interface OrgOption {
  id: string;
  name: string;
}

const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "INR", "AUD", "CAD", "CHF", "JPY", "CNY"];

export default function Explore() {
  const { session, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Counterparty search
  const [orgSearch, setOrgSearch] = useState("");
  const [orgResults, setOrgResults] = useState<OrgOption[]>([]);
  const [isSearchingOrgs, setIsSearchingOrgs] = useState(false);
  const [selectedCounterparty, setSelectedCounterparty] = useState<OrgOption | null>(null);

  // Trade signal fields
  const [commodity, setCommodity] = useState("");
  const [quantityAmount, setQuantityAmount] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("USD");

  // Preflight
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [isRunningPreflight, setIsRunningPreflight] = useState(false);
  const [isCollapsing, setIsCollapsing] = useState(false);

  const searchOrgs = useCallback(async () => {
    if (!orgSearch.trim()) return;
    setIsSearchingOrgs(true);
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name")
        .ilike("name", `%${orgSearch.trim()}%`)
        .limit(10);

      if (error) throw error;

      // Filter out the user's own org
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session?.user?.id ?? "")
        .single();

      const filtered = (data || []).filter(o => o.id !== profile?.org_id);
      setOrgResults(filtered);

      if (filtered.length === 0) {
        toast.info("No matching organisations found");
      }
    } catch (err) {
      toast.error("Failed to search organisations");
    } finally {
      setIsSearchingOrgs(false);
    }
  }, [orgSearch, session]);

  const runPreflight = useCallback(async () => {
    if (!selectedCounterparty) {
      toast.error("Select a counterparty first");
      return;
    }

    setIsRunningPreflight(true);
    setPreflight(null);

    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session?.user?.id ?? "")
        .single();

      if (!profile?.org_id) {
        toast.error("Profile not found");
        return;
      }

      const { data, error } = await supabase.functions.invoke("preflight", {
        body: {
          buyerOrgId: profile.org_id,
          sellerOrgId: selectedCounterparty.id,
          commodity: commodity.trim() || undefined,
          quantityAmount: quantityAmount ? parseFloat(quantityAmount) : undefined,
          quantityUnit: quantityUnit.trim() || undefined,
          priceAmount: priceAmount ? parseFloat(priceAmount) : undefined,
          priceCurrency: priceCurrency || undefined,
        },
      });

      if (error) throw error;
      setPreflight(data as PreflightResult);
    } catch (err) {
      toast.error("Pre-flight check failed");
      console.error(err);
    } finally {
      setIsRunningPreflight(false);
    }
  }, [selectedCounterparty, commodity, quantityAmount, quantityUnit, priceAmount, priceCurrency, session]);

  const handleCollapse = useCallback(async () => {
    if (!preflight?.canCollapse || !selectedCounterparty) return;

    setIsCollapsing(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id, full_name")
        .eq("id", session?.user?.id ?? "")
        .single();

      if (!profile?.org_id) throw new Error("Profile not found");

      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", profile.org_id)
        .single();

      const { data: matchData, error: matchError } = await supabase.functions.invoke("match", {
        body: {
          buyer: { id: profile.org_id, name: org?.name || "Your Organisation" },
          seller: { id: selectedCounterparty.id, name: selectedCounterparty.name },
          commodity,
          quantity: { amount: parseFloat(quantityAmount), unit: quantityUnit },
          price: { amount: parseFloat(priceAmount), currency: priceCurrency },
          terms: "Created via Exploration Layer with pre-flight validation",
          metadata: { preflightCheckedAt: preflight.checkedAt },
        },
      });

      if (matchError) throw matchError;

      toast.success("POI created successfully — navigating to evidence pack");
      navigate(`/dashboard/matches/${matchData.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create POI");
    } finally {
      setIsCollapsing(false);
    }
  }, [preflight, selectedCounterparty, commodity, quantityAmount, quantityUnit, priceAmount, priceCurrency, session, navigate]);

  const deltaIcon = (status: string) => {
    if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />;
    if (status === "warning") return <AlertTriangle className="h-4 w-4 text-accent-foreground shrink-0" />;
    return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  };

  if (!session) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md">
            <CardContent className="pt-6 text-center space-y-3">
              <Lock className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">Sign in to access the Exploration Layer.</p>
              <Button onClick={() => navigate("/auth")} className="bg-foreground text-background hover:bg-foreground/90">Sign In</Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout isAdmin={isAdmin}>
      <div className="space-y-6 max-w-3xl">
        <SectionHeader
          title="Exploration Layer"
          description="Draft a non-binding trade signal. No Proof-of-Intent is created until you explicitly seal it."
        />

        <Alert variant="default" className="border-border">
          <Info className="h-4 w-4" />
          <AlertTitle className="text-sm font-medium">Non-binding</AlertTitle>
          <AlertDescription className="text-xs">
            Everything on this page is exploratory. No POI records, no credits burned, no commitments until you press "Seal / Collapse".
          </AlertDescription>
        </Alert>

        {/* Step 1: Search counterparty */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Select Counterparty</CardTitle>
            <CardDescription>Search for the organisation you intend to trade with.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Search organisation name…"
                value={orgSearch}
                onChange={e => setOrgSearch(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchOrgs()}
                aria-label="Search organisations"
              />
              <Button variant="outline" size="icon" onClick={searchOrgs} disabled={isSearchingOrgs} aria-label="Search">
                {isSearchingOrgs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {orgResults.length > 0 && (
              <div className="border rounded-md divide-y divide-border max-h-48 overflow-auto">
                {orgResults.map(org => (
                  <button
                    key={org.id}
                    onClick={() => {
                      setSelectedCounterparty(org);
                      setOrgResults([]);
                      setPreflight(null);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}

            {selectedCounterparty && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedCounterparty.name}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground"
                  onClick={() => { setSelectedCounterparty(null); setPreflight(null); }}
                >
                  Change
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Trade signal fields */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">2. Define Trade Signal</CardTitle>
            <CardDescription>Specify the asset, quantity, and price. This is non-binding.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="commodity">Commodity / Asset</Label>
                <Input id="commodity" placeholder="e.g. Cashew Nuts W320" value={commodity} onChange={e => setCommodity(e.target.value)} aria-label="Commodity" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qty">Quantity</Label>
                <Input id="qty" type="number" min="0" step="any" placeholder="e.g. 500" value={quantityAmount} onChange={e => setQuantityAmount(e.target.value)} aria-label="Quantity amount" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit">Unit</Label>
                <Input id="unit" placeholder="e.g. MT, kg, lots" value={quantityUnit} onChange={e => setQuantityUnit(e.target.value)} aria-label="Quantity unit" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price">Price</Label>
                <Input id="price" type="number" min="0" step="any" placeholder="e.g. 1200" value={priceAmount} onChange={e => setPriceAmount(e.target.value)} aria-label="Price amount" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Select value={priceCurrency} onValueChange={setPriceCurrency}>
                  <SelectTrigger id="currency" aria-label="Currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step 3: Pre-flight */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">3. Pre-flight Risk Deltas</CardTitle>
            <CardDescription>Run a non-binding check before creating a POI.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={runPreflight}
              disabled={!selectedCounterparty || isRunningPreflight}
              variant="outline"
              className="w-full"
            >
              {isRunningPreflight ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running pre-flight…</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-2" />Run Pre-flight Check</>
              )}
            </Button>

            {isRunningPreflight && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            )}

            {preflight && (
              <div className="space-y-3">
                {/* Overall status */}
                <div className="flex items-center gap-2">
                {preflight.overallStatus === "pass" && <ShieldCheck className="h-5 w-5 text-primary" />}
                {preflight.overallStatus === "warning" && <ShieldAlert className="h-5 w-5 text-accent-foreground" />}
                {preflight.overallStatus === "fail" && <ShieldX className="h-5 w-5 text-destructive" />}
                  <span className="font-medium text-sm">
                    {preflight.overallStatus === "pass" && "All checks passed"}
                    {preflight.overallStatus === "warning" && "Passed with warnings"}
                    {preflight.overallStatus === "fail" && "Prerequisites not met"}
                  </span>
                </div>

                <Separator />

                {/* Deltas */}
                <div className="space-y-2">
                  {preflight.deltas.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      {deltaIcon(d.status)}
                      <div className="min-w-0">
                        <span>{d.message}</span>
                        {d.details && "missingDocs" in d.details && Array.isArray(d.details.missingDocs) && d.details.missingDocs.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Missing: {(d.details.missingDocs as string[]).join(", ")}
                          </p>
                        )}
                        {d.details && "remainingRoles" in d.details && Array.isArray(d.details.remainingRoles) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Awaiting: {(d.details.remainingRoles as string[]).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground italic">{preflight.note}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 4: Seal / Collapse */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">4. Seal / Collapse</CardTitle>
            <CardDescription>
              Only enabled when all pre-flight checks pass. This will create a binding POI record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleCollapse}
              disabled={!preflight?.canCollapse || isCollapsing}
              className="w-full bg-foreground text-background hover:bg-foreground/90"
            >
              {isCollapsing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating POI…</>
              ) : (
                <><Lock className="h-4 w-4 mr-2" />Seal / Collapse to POI</>
              )}
            </Button>
            {preflight && !preflight.canCollapse && (
              <p className="text-xs text-destructive mt-2 text-center">
                Resolve all failing checks above before sealing.
              </p>
            )}
            {!preflight && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Run pre-flight check first.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
