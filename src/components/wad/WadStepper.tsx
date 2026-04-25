import { useEffect, useRef, useState } from "react";
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
import {
  submitAttestation,
  sealWad,
  downloadCertificate,
  triggerBlobDownload,
  resolveAttestationRole,
  type WadRecord,
  type ConsequenceState,
} from "@/lib/modules/consequence";
import { AttestationProgressStepper } from "./AttestationProgressStepper";
import { useTranslation } from "@/hooks/useTranslation";

type Match = Tables<"matches">;

interface WadStepperProps {
  wad: WadRecord;
  match: Match;
  consequenceState: ConsequenceState;
  userOrgId: string | null;
  onUpdate: () => void;
}

const STEPS = [
  { id: "summary", label: "Summary", icon: FileText },
  { id: "evidence", label: "Evidence Bundle", icon: Shield },
  { id: "signatories", label: "Signatories", icon: Users },
  { id: "attest", label: "Review & Attest", icon: Check },
  { id: "certificate", label: "Sealed Certificate", icon: Lock },
];

// Attestation statement copy lives in the i18n catalogue under
// `wad.attest.statement` so it can be translated without touching this file.

export function WadStepper({ wad, match, consequenceState, userOrgId, onUpdate }: WadStepperProps) {
  const { t } = useTranslation();
  const [activeStep, setActiveStep] = useState(0);
  const [attesting, setAttesting] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [attestedName, setAttestedName] = useState("");
  const [attestConfirmed, setAttestConfirmed] = useState(false);
  const [attestError, setAttestError] = useState<{ message: string; requestId?: string } | null>(null);
  const [refCopied, setRefCopied] = useState(false);
  const attestErrorRef = useRef<HTMLDivElement>(null);
  const attestButtonRef = useRef<HTMLButtonElement>(null);

  // When an attestation error appears, move keyboard focus to the alert so
  // assistive tech announces it AND the user can immediately Tab to "Retry".
  useEffect(() => {
    if (attestError && attestErrorRef.current) {
      attestErrorRef.current.focus();
    }
  }, [attestError]);

  // All decision logic comes from consequenceState - no inline derivation
  const {
    canAttest,
    hasAttested,
    canSeal,
    canDownloadCertificate,
    attestations,
    uiStatus,
    statusLabel,
  } = consequenceState;

  const getStatusBadge = () => {
    switch (uiStatus) {
      case "draft":
        return <Badge variant="secondary">{statusLabel}</Badge>;
      case "awaiting_attestations":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600">{statusLabel}</Badge>;
      case "ready_to_seal":
        return <Badge variant="outline" className="border-blue-500 text-blue-600">{statusLabel}</Badge>;
      case "sealed":
        return <Badge className="bg-primary text-primary-foreground">{statusLabel}</Badge>;
      case "revoked":
        return <Badge variant="destructive">{statusLabel}</Badge>;
      default:
        return <Badge variant="secondary">{statusLabel}</Badge>;
    }
  };

  const handleAttest = async () => {
    if (!attestedName.trim() || !attestConfirmed) {
      toast.error(!attestedName.trim() ? t("wad.attest.toast.nameRequired") : t("wad.attest.toast.confirmRequired"));
      return;
    }

    setAttesting(true);
    setAttestError(null);
    const role = resolveAttestationRole(userOrgId, wad.buyer_org_id, wad.seller_org_id);
    const result = await submitAttestation(wad.id, attestedName, role);
    setAttesting(false);

    if (result.success) {
      toast.success("Attestation recorded");
      setAttestError(null);
      onUpdate();
    } else {
      const baseMsg = result.error || "Failed to attest";
      const toastMsg = result.requestId ? `${baseMsg} (Ref: ${result.requestId})` : baseMsg;
      toast.error(toastMsg, { duration: 8000 });
      setAttestError({ message: baseMsg, requestId: result.requestId });
    }
  };

  const handleCopyAttestRef = async () => {
    if (!attestError?.requestId) return;
    try {
      await navigator.clipboard.writeText(attestError.requestId);
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleSeal = async () => {
    setSealing(true);
    const result = await sealWad(wad.id);
    setSealing(false);

    if (result.success) {
      toast.success("Signed Deal sealed successfully");
      onUpdate();
    } else {
      toast.error(result.error || "Failed to seal");
    }
  };

  const handleDownloadCertificate = async () => {
    setDownloading(true);
    const result = await downloadCertificate(wad.id);
    setDownloading(false);

    if (result.success && result.data) {
      triggerBlobDownload(result.data, `Izenzo-Certificate-${wad.id.substring(0, 8)}.pdf`);
      toast.success("Certificate downloaded");
    } else {
      toast.error(result.error || "Failed to download certificate");
    }
  };

  const renderStepContent = () => {
    switch (STEPS[activeStep].id) {
      case "summary":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Signed Deal ID</Label>
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
                {match.quantity_amount ?? "-"} {match.quantity_unit ?? ""} @ {match.price_currency ?? ""} {match.price_amount ?? "-"}
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

      case "evidence": {
        const evidence = wad.evidence_bundle as Record<string, any> | null;
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
      }

      case "signatories":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Both buyer and seller must attest before the Signed Deal can be sealed.
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {attestations.buyerAttested ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="font-medium">Buyer Signatory</p>
                    <p className="text-sm text-muted-foreground">{match.buyer_name}</p>
                  </div>
                </div>
                {attestations.buyerAttested && (
                  <Badge variant="outline" className="text-green-600">Attested</Badge>
                )}
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {attestations.sellerAttested ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="font-medium">Seller Signatory</p>
                    <p className="text-sm text-muted-foreground">{match.seller_name}</p>
                  </div>
                </div>
                {attestations.sellerAttested && (
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
        if (uiStatus === "sealed") {
          return (
            <div className="text-center py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="font-medium">Signed Deal has been sealed</p>
              <p className="text-sm text-muted-foreground">All attestations complete</p>
            </div>
          );
        }

        if (hasAttested) {
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
                    Seal Signed Deal
                  </Button>
                </>
              )}
            </div>
          );
        }

        if (!canAttest) {
          return (
            <div className="text-center py-6">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="font-medium">Attestation not available</p>
              <p className="text-sm text-muted-foreground">
                Only buyer and seller signatories can attest on this Signed Deal.
              </p>
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
            {attestError && (
              <div
                ref={attestErrorRef}
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                tabIndex={-1}
                id="attest-error"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 focus-visible:ring-offset-2"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-destructive">Attestation failed</p>
                    <p className="text-destructive/90 break-words">{attestError.message}</p>
                  </div>
                </div>
                {attestError.requestId && (
                  <div className="flex items-center justify-between gap-2 rounded border border-destructive/20 bg-background/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground" id="attest-ref-label">
                        Reference ID
                      </p>
                      <code className="font-mono text-[11px] break-all" aria-labelledby="attest-ref-label">
                        {attestError.requestId}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyAttestRef}
                      aria-label={
                        refCopied
                          ? "Reference ID copied to clipboard"
                          : `Copy reference ID ${attestError.requestId} to clipboard`
                      }
                      className="shrink-0 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded px-1"
                    >
                      {refCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Please include the Reference ID when reporting this issue to support.
                </p>
              </div>
            )}
            <Button
              ref={attestButtonRef}
              onClick={handleAttest}
              disabled={attesting || !attestedName.trim() || !attestConfirmed}
              aria-describedby={attestError ? "attest-error" : undefined}
              aria-busy={attesting || undefined}
              className="w-full"
            >
              {attesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
              <Check className="h-4 w-4 mr-2" aria-hidden="true" />
              {attesting
                ? "Submitting attestation…"
                : attestError
                ? "Retry attestation"
                : "Attest"}
              {attesting && <span className="sr-only">, please wait</span>}
            </Button>
          </div>
        );

      case "certificate":
        if (!canDownloadCertificate) {
          return (
            <div className="text-center py-6">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="font-medium">Certificate not yet available</p>
              <p className="text-sm text-muted-foreground">
                Signed Deal must be sealed before the certificate can be generated
              </p>
            </div>
          );
        }

        return (
          <div className="space-y-4">
            <div className="text-center py-4">
              <Lock className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="font-medium text-lg">Signed Deal Sealed</p>
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
              Download PDF Certificate
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              PDF certificate includes all attestations, evidence bundle hashes, seal verification data, and a tamper-proof verification section.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  const isSealed = uiStatus === "sealed";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Signed Deal
            </CardTitle>
            <CardDescription>Sealed evidence bundle for POI</CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        <AttestationProgressStepper
          wad={wad}
          consequenceState={consequenceState}
          buyerName={match.buyer_name ?? "Buyer"}
          sellerName={match.seller_name ?? "Seller"}
          userOrgId={userOrgId}
          className="mb-6"
        />

        {/* Step indicators */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2 -mx-2 px-2 lg:justify-between lg:gap-0 lg:mx-0 lg:px-0">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === activeStep;
            const isCompleted = index < activeStep ||
              (step.id === "certificate" && isSealed) ||
              (step.id === "attest" && isSealed);

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
        {renderStepContent()}

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
