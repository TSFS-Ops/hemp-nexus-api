import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { 
  Loader2, Check, FileText, Users, Shield, Download, 
  AlertCircle, CheckCircle2, Clock, Lock
} from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import * as WadState from "@/lib/wad-state";

type Match = Tables<"matches">;

interface Attestation {
  id: string;
  wad_id: string;
  user_id: string;
  org_id: string;
  role: string;
  attested_name: string;
  attested_at: string;
  attestation_text: string;
}

interface Wad {
  id: string;
  poi_id: string;
  status: string;
  evidence_bundle: any;
  seal_hash: string | null;
  sealed_at: string | null;
  created_at: string;
  buyer_org_id: string | null;
  seller_org_id: string | null;
  attestations?: Attestation[];
}

interface WadStepperProps {
  wad: Wad;
  match: Match;
  onUpdate: () => void;
}

const STEPS = [
  { id: "summary", label: "Summary", icon: FileText },
  { id: "evidence", label: "Evidence Bundle", icon: Shield },
  { id: "signatories", label: "Signatories", icon: Users },
  { id: "attest", label: "Review & Attest", icon: Check },
  { id: "certificate", label: "Sealed Certificate", icon: Lock },
];

const ATTESTATION_TEXT = "I confirm this is not a contract. No payment. No obligation. This is a record that intent was confirmed.";

export function WadStepper({ wad, match, onUpdate }: WadStepperProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [attestedName, setAttestedName] = useState("");
  const [attestConfirmed, setAttestConfirmed] = useState(false);

  useEffect(() => {
    fetchUserOrg();
  }, []);

  const fetchUserOrg = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session.user.id)
        .single();
      if (profile) {
        setUserOrgId(profile.org_id);
      }
    }
  };

  const getStatusBadge = () => {
    const label = WadState.statusLabel(wad.status);
    switch (wad.status) {
      case "draft":
        return <Badge variant="secondary">{label}</Badge>;
      case "awaiting_attestations":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Awaiting Attestations</Badge>;
      case "sealed":
        return <Badge className="bg-primary text-primary-foreground">{label}</Badge>;
      case "revoked":
        return <Badge variant="destructive">{label}</Badge>;
      default:
        return <Badge variant="secondary">{label}</Badge>;
    }
  };

  const buyerAttested = wad.attestations?.some(a => a.role === "buyer_signatory");
  const sellerAttested = wad.attestations?.some(a => a.role === "seller_signatory");
  const userIsBuyer = userOrgId === wad.buyer_org_id;
  const userIsSeller = userOrgId === wad.seller_org_id;
  const userHasAttested = wad.attestations?.some(a => a.org_id === userOrgId);
  const canSeal = buyerAttested && sellerAttested && WadState.canDo(wad.status, "seal");

  const handleAttest = async () => {
    if (!attestedName.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (!attestConfirmed) {
      toast.error("Please confirm the attestation statement");
      return;
    }

    try {
      setAttesting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const role = userIsBuyer ? "buyer_signatory" : userIsSeller ? "seller_signatory" : "witness";

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wad/${wad.id}/attest`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            attested_name: attestedName,
            role,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to attest");
      }

      toast.success("Attestation recorded");
      onUpdate();
    } catch (error: any) {
      toast.error(error.message || "Failed to attest");
    } finally {
      setAttesting(false);
    }
  };

  const handleSeal = async () => {
    try {
      setSealing(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wad/${wad.id}/seal`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to seal");
      }

      toast.success("WaD sealed successfully");
      onUpdate();
    } catch (error: any) {
      toast.error(error.message || "Failed to seal");
    } finally {
      setSealing(false);
    }
  };

  const handleDownloadCertificate = async () => {
    try {
      setDownloading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wad/${wad.id}/certificate`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to download certificate");
      }

      const certificate = await response.json();
      const blob = new Blob([JSON.stringify(certificate, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wad-certificate-${wad.id}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Certificate downloaded");
    } catch (error) {
      toast.error("Failed to download certificate");
    } finally {
      setDownloading(false);
    }
  };

  const renderStepContent = () => {
    switch (STEPS[activeStep].id) {
      case "summary":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">WaD ID</Label>
                <p className="font-mono text-sm">{wad.id}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">POI ID</Label>
                <p className="font-mono text-sm">{wad.poi_id}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Created</Label>
                <p className="text-sm">{new Date(wad.created_at).toLocaleString()}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <div className="mt-1">{getStatusBadge()}</div>
              </div>
            </div>
            <Separator />
            <div>
              <Label className="text-muted-foreground">Transaction</Label>
              <p className="font-medium">{match.commodity}</p>
              <p className="text-sm text-muted-foreground">
                {match.quantity_amount} {match.quantity_unit} @ {match.price_currency} {match.price_amount}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Buyer</Label>
                <p className="font-medium">{match.buyer_name}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Seller</Label>
                <p className="font-medium">{match.seller_name}</p>
              </div>
            </div>
            {wad.seal_hash && (
              <>
                <Separator />
                <div>
                  <Label className="text-muted-foreground">Seal Hash</Label>
                  <p className="font-mono text-xs break-all bg-muted p-2 rounded">{wad.seal_hash}</p>
                </div>
              </>
            )}
          </div>
        );

      case "evidence":
        const evidence = wad.evidence_bundle;
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">POI Snapshot</Label>
              <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto mt-1 max-h-48">
                {JSON.stringify(evidence?.poi_snapshot || {}, null, 2)}
              </pre>
            </div>
            <Separator />
            <div>
              <Label className="text-muted-foreground">Documents ({evidence?.documents?.length || 0})</Label>
              {evidence?.documents?.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {evidence.documents.map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                      <span>{doc.title || doc.doc_type}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {doc.sha256_hash?.substring(0, 12)}...
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">No documents attached</p>
              )}
            </div>
            <Separator />
            <div>
              <Label className="text-muted-foreground">Event Chain</Label>
              <p className="text-sm mt-1">{evidence?.event_count || 0} events in chain</p>
              {evidence?.event_hashes?.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto">
                  {evidence.event_hashes.map((hash: string, i: number) => (
                    <p key={i} className="font-mono text-xs text-muted-foreground">
                      {i + 1}. {hash.substring(0, 16)}...
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case "signatories":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Both buyer and seller must attest before the WaD can be sealed.
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {buyerAttested ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="font-medium">Buyer Signatory</p>
                    <p className="text-sm text-muted-foreground">{match.buyer_name}</p>
                  </div>
                </div>
                {buyerAttested && (
                  <Badge variant="outline" className="text-green-600">Attested</Badge>
                )}
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {sellerAttested ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="font-medium">Seller Signatory</p>
                    <p className="text-sm text-muted-foreground">{match.seller_name}</p>
                  </div>
                </div>
                {sellerAttested && (
                  <Badge variant="outline" className="text-green-600">Attested</Badge>
                )}
              </div>
            </div>
            {wad.attestations && wad.attestations.length > 0 && (
              <>
                <Separator />
                <div>
                  <Label className="text-muted-foreground">Attestation Records</Label>
                  <div className="mt-2 space-y-2">
                    {wad.attestations.map((att) => (
                      <div key={att.id} className="text-sm p-2 bg-muted rounded">
                        <p className="font-medium">{att.attested_name} ({att.role.replace("_", " ")})</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(att.attested_at).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        );

      case "attest":
        if (WadState.isSealed(wad.status)) {
          return (
            <div className="text-center py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="font-medium">WaD has been sealed</p>
              <p className="text-sm text-muted-foreground">All attestations complete</p>
            </div>
          );
        }

        if (userHasAttested) {
          return (
            <div className="space-y-4">
              <div className="text-center py-4">
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
                <p className="font-medium">You have already attested</p>
                <p className="text-sm text-muted-foreground">Waiting for other party</p>
              </div>
              {canSeal && (
                <>
                  <Separator />
                  <Button onClick={handleSeal} disabled={sealing} className="w-full">
                    {sealing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <Lock className="h-4 w-4 mr-2" />
                    Seal WaD
                  </Button>
                </>
              )}
            </div>
          );
        }

        return (
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-2">Attestation Statement:</p>
              <p className="text-sm italic text-muted-foreground">"{ATTESTATION_TEXT}"</p>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="attested-name">Your Full Name (as signatory)</Label>
                <Input
                  id="attested-name"
                  value={attestedName}
                  onChange={(e) => setAttestedName(e.target.value)}
                  placeholder="Enter your full legal name"
                  className="mt-1"
                />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="attest-confirm"
                  checked={attestConfirmed}
                  onCheckedChange={(checked) => setAttestConfirmed(checked === true)}
                />
                <Label htmlFor="attest-confirm" className="text-sm leading-relaxed cursor-pointer">
                  I confirm that this is NOT a contract, involves NO payment, and creates NO legal obligation. 
                  This is an evidence record that intent was confirmed.
                </Label>
              </div>
            </div>
            <Button 
              onClick={handleAttest} 
              disabled={attesting || !attestedName.trim() || !attestConfirmed}
              className="w-full"
            >
              {attesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Check className="h-4 w-4 mr-2" />
              Attest
            </Button>
          </div>
        );

      case "certificate":
        if (!WadState.isSealed(wad.status)) {
          return (
            <div className="text-center py-6">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="font-medium">Certificate not yet available</p>
              <p className="text-sm text-muted-foreground">
                WaD must be sealed before certificate can be generated
              </p>
            </div>
          );
        }

        return (
          <div className="space-y-4">
            <div className="text-center py-4">
              <Lock className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="font-medium text-lg">WaD Sealed</p>
              <p className="text-sm text-muted-foreground">
                Sealed on {wad.sealed_at ? new Date(wad.sealed_at).toLocaleString() : "N/A"}
              </p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <Label className="text-muted-foreground">Seal Hash</Label>
              <p className="font-mono text-xs break-all mt-1">{wad.seal_hash}</p>
            </div>
            <Button onClick={handleDownloadCertificate} disabled={downloading} className="w-full">
              {downloading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Download className="h-4 w-4 mr-2" />
              Download Certificate
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Certificate includes all attestations, evidence bundle hash, and seal verification data.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              WaD (Without-a-Doubt)
            </CardTitle>
            <CardDescription>Sealed evidence bundle for POI</CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        {/* Step indicators - horizontal scroll on mobile, flex on desktop */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2 -mx-2 px-2 lg:justify-between lg:gap-0 lg:mx-0 lg:px-0">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === activeStep;
            const isCompleted = index < activeStep || 
              (step.id === "certificate" && WadState.isSealed(wad.status)) ||
              (step.id === "attest" && WadState.isSealed(wad.status));
            
            return (
              <button
                key={step.id}
                onClick={() => setActiveStep(index)}
                className={`flex flex-col items-center gap-1 px-2 py-1 rounded transition-colors min-w-[70px] flex-shrink-0 lg:min-w-[80px] lg:flex-shrink ${
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : isCompleted
                    ? "text-green-600"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className={`p-1.5 lg:p-2 rounded-full ${
                  isActive ? "bg-primary text-primary-foreground" : 
                  isCompleted ? "bg-green-100 text-green-600" : "bg-muted"
                }`}>
                  {isCompleted && !isActive ? (
                    <Check className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                  ) : (
                    <Icon className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                  )}
                </div>
                <span className="text-[10px] lg:text-xs font-medium whitespace-nowrap">{step.label}</span>
              </button>
            );
          })}
        </div>

        <Separator className="mb-6" />

        {/* Step content */}
        {renderStepContent()}

        {/* Navigation */}
        <div className="flex justify-between mt-6 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
            disabled={activeStep === 0}
          >
            Previous
          </Button>
          <Button
            onClick={() => setActiveStep(Math.min(STEPS.length - 1, activeStep + 1))}
            disabled={activeStep === STEPS.length - 1}
          >
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
