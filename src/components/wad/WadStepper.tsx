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
import {
  loadAttestError,
  saveAttestError,
  clearAttestError,
} from "@/lib/wad/attest-error-storage";
import {
  buildAttestErrorReport,
  buildAttestErrorReportFilename,
} from "@/lib/wad/attest-error-report";
import {
  trackClientEvent,
  CLIENT_ANALYTICS_EVENT_NAMES,
  type CopyRefSurface,
} from "@/lib/client-analytics";
import { generateIdempotencyKey } from "@/lib/api-client";

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

const ATTESTATION_TEXT = "I confirm this is not a contract. No payment. No obligation. This is a record that intent was confirmed.";

export function WadStepper({ wad, match, consequenceState, userOrgId, onUpdate }: WadStepperProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [attesting, setAttesting] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [attestedName, setAttestedName] = useState("");
  const [attestConfirmed, setAttestConfirmed] = useState(false);
  const attestationAttemptRef = useRef<{
    key: string;
    wadId: string;
    attestedName: string;
    role: "buyer_signatory" | "seller_signatory" | "witness";
  } | null>(null);
  type AttestErrorState = {
    message: string;
    requestId?: string;
    kind?: "auth_required" | "client_error" | "server_error" | "network_error" | "unknown";
  };
  const [attestError, setAttestErrorRaw] = useState<AttestErrorState | null>(() => {
    const persisted = loadAttestError(wad.id);
    if (!persisted) return null;
    return { message: persisted.message, requestId: persisted.requestId, kind: persisted.kind };
  });
  // Wrapper that mirrors writes to sessionStorage so a reload restores the error.
  const setAttestError = (next: AttestErrorState | null) => {
    setAttestErrorRaw(next);
    if (next) saveAttestError(wad.id, next);
    else clearAttestError(wad.id);
  };
  const [refCopied, setRefCopied] = useState(false);

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

  // If the user has already attested (e.g. via another tab/device), the error
  // is no longer actionable - clear it from state and storage.
  useEffect(() => {
    if (hasAttested && attestError) {
      setAttestErrorRaw(null);
      clearAttestError(wad.id);
    }
  }, [hasAttested, attestError, wad.id]);

  // Focus management for the attestation error.
  // ---------------------------------------------
  // When a new attest error appears we move focus to the error region so:
  //   1. Screen-reader users hear the alert immediately even if their SR
  //      doesn't announce role="alert" reliably (some Linux SRs ignore
  //      alerts that mount before the user has interacted).
  //   2. Sighted keyboard users can immediately Tab forward to the
  //      "Copy Ref" / "Retry" controls without hunting back up the page.
  // We deliberately key the effect on (requestId || message) rather than
  // the whole object reference, so re-renders that don't change the error
  // identity (e.g. the "you" badge updating) don't steal focus repeatedly.
  const attestErrorRef = useRef<HTMLDivElement | null>(null);
  const errorIdentity = attestError
    ? `${attestError.requestId ?? ""}::${attestError.message}`
    : null;
  useEffect(() => {
    if (!errorIdentity) return;
    // Allow the alert to mount before focusing.
    const node = attestErrorRef.current;
    if (node && typeof node.focus === "function") {
      node.focus();
    }
  }, [errorIdentity]);

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
      toast.error(!attestedName.trim() ? "Please enter your name" : "Please confirm the attestation statement");
      return;
    }

    const normalizedName = attestedName.trim();
    setAttesting(true);
    setAttestError(null);
    const role = resolveAttestationRole(userOrgId, wad.buyer_org_id, wad.seller_org_id);
    const existingAttempt = attestationAttemptRef.current;
    const idempotencyKey =
      existingAttempt &&
      existingAttempt.wadId === wad.id &&
      existingAttempt.attestedName === normalizedName &&
      existingAttempt.role === role
        ? existingAttempt.key
        : generateIdempotencyKey(`wad_attest_${wad.id}`);

    attestationAttemptRef.current = { key: idempotencyKey, wadId: wad.id, attestedName: normalizedName, role };
    const result = await submitAttestation(wad.id, normalizedName, role, idempotencyKey);
    setAttesting(false);

    if (result.success) {
      toast.success("Attestation recorded");
      attestationAttemptRef.current = null;
      setAttestError(null);
      onUpdate();
    } else {
      const baseMsg = result.error || "Failed to attest";
      const toastMsg = result.requestId ? `${baseMsg} (Ref: ${result.requestId})` : baseMsg;
      toast.error(toastMsg, {
        duration: 8000,
        action: result.requestId
          ? {
              label: "Copy Ref",
              onClick: () => {
                void handleCopyAttestRef(result.requestId, "toast");
              },
            }
          : undefined,
      });
      setAttestError({ message: baseMsg, requestId: result.requestId, kind: result.errorKind });
    }
  };

  // `surface` lets analytics distinguish the inline alert button from the
  // sonner toast action so we can compare conversion of the two surfaces.
  const handleCopyAttestRef = async (
    refId?: string,
    surface: CopyRefSurface = "alert",
  ) => {
    const ref = refId ?? attestError?.requestId;
    if (!ref) {
      // We still emit so we can spot UX bugs where users mash a Copy
      // button that has no value to copy (e.g. error cleared mid-click).
      trackClientEvent({
        name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
        payload: { surface, outcome: "no_ref", hasRef: false, context: "wad_attest_error" },
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(ref);
      setRefCopied(true);
      toast.success("Reference ID copied");
      setTimeout(() => setRefCopied(false), 2000);
      trackClientEvent({
        name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
        payload: { surface, outcome: "success", hasRef: true, context: "wad_attest_error" },
      });
    } catch (err) {
      toast.error("Could not copy - please copy the Ref manually");
      trackClientEvent({
        name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
        payload: {
          surface,
          outcome: "denied",
          hasRef: true,
          context: "wad_attest_error",
          reason: err instanceof Error ? err.name : "unknown",
        },
      });
    }
  };

  // Build a small text incident report and trigger a browser download.
  // We deliberately do this entirely client-side: no network round-trip,
  // no PII leaves the device unless the user themselves attaches it
  // when emailing support.
  const handleDownloadErrorReport = () => {
    if (!attestError) return;
    const role = resolveAttestationRole(userOrgId, wad.buyer_org_id, wad.seller_org_id);
    const report = buildAttestErrorReport({
      wadId: wad.id,
      matchId: match?.id,
      buyerOrgId: wad.buyer_org_id,
      sellerOrgId: wad.seller_org_id,
      userOrgId,
      resolvedRole: role,
      attestedName,
      attestConfirmed,
      error: {
        message: attestError.message,
        requestId: attestError.requestId,
        kind: attestError.kind,
      },
    });
    try {
      const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
      triggerBlobDownload(blob, buildAttestErrorReportFilename(wad.id));
      toast.success("Error report downloaded");
      trackClientEvent({
        name: CLIENT_ANALYTICS_EVENT_NAMES.DOWNLOAD_ERROR_REPORT,
        payload: {
          outcome: "success",
          hasRef: Boolean(attestError.requestId),
          context: "wad_attest_error",
          errorKind: attestError.kind,
        },
      });
    } catch (err) {
      toast.error("Could not generate report - please copy the details manually");
      trackClientEvent({
        name: CLIENT_ANALYTICS_EVENT_NAMES.DOWNLOAD_ERROR_REPORT,
        payload: {
          outcome: "failed",
          hasRef: Boolean(attestError.requestId),
          context: "wad_attest_error",
          errorKind: attestError.kind,
          reason: err instanceof Error ? err.name : "unknown",
        },
      });
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
                data-testid="attest-error-alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-destructive">Attestation failed</p>
                    <p className="text-destructive/90 break-words">{attestError.message}</p>
                  </div>
                </div>
                {attestError.requestId && (
                  <div className="flex items-center justify-between gap-2 rounded border border-destructive/20 bg-background/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Reference ID
                      </p>
                      <code className="font-mono text-[11px] break-all">{attestError.requestId}</code>
                    </div>
                    <button
                      type="button"
                      onClick={() => { void handleCopyAttestRef(undefined, "alert"); }}
                      className="shrink-0 text-xs text-primary hover:underline"
                    >
                      {refCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
                {(() => {
                  const refSuffix = attestError.requestId ? ` with Ref ${attestError.requestId}` : "";
                  let hint: string;
                  switch (attestError.kind) {
                    case "auth_required":
                      hint = "Your session has expired. Please sign in again, then retry the attestation.";
                      break;
                    case "client_error":
                      hint =
                        "Please check the details above (name and confirmation) and try again. If you keep seeing this, contact support" +
                        refSuffix +
                        ".";
                      break;
                    case "server_error":
                      hint =
                        "This looks like a temporary problem on our side. Please retry in a moment - if it keeps failing, contact support" +
                        refSuffix +
                        ".";
                      break;
                    case "network_error":
                      hint =
                        "We couldn't reach the server. Check your connection and retry. If the issue persists, contact support" +
                        refSuffix +
                        ".";
                      break;
                    default:
                      hint = attestError.requestId
                        ? `Please include the Reference ID when reporting this issue to support.`
                        : "If this keeps happening, please contact support.";
                  }
                  return (
                    <p className="text-xs text-muted-foreground" data-testid="attest-error-hint">
                      {hint}
                    </p>
                  );
                })()}
                {/* Download a plain-text incident report. Always rendered
                    when the alert is up - even without a Reference ID it
                    captures the message, timestamp, form fields and
                    environment for support triage. */}
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    data-testid="attest-error-download-report"
                    onClick={handleDownloadErrorReport}
                    className="inline-flex items-center gap-1.5 rounded border border-destructive/30 bg-background/60 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-1"
                  >
                    <Download className="h-3 w-3" />
                    Download error report
                  </button>
                </div>
              </div>
            )}
            <Button
              data-testid="attest-submit-button"
              onClick={handleAttest}
              // Explicit, focus-scoped Enter/Space shortcut. Native <button>
              // already activates on Enter/Space, but we intercept here for
              // two reasons:
              //   1. stopPropagation prevents any ancestor key listener
              //      (e.g. a future global stepper-navigation handler that
              //      uses Enter to advance to the next step) from also
              //      firing on the same keystroke.
              //   2. Because the listener is on the button itself, it ONLY
              //      runs when the Attest/Retry button is the focused
              //      element - pressing Enter while focus is on the
              //      stepper, the name input, or the consent checkbox
              //      does not trigger an attestation.
              // We also gate on the same disabled conditions the click
              // path uses so a stale keystroke after submission can't
              // double-fire.
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                // Modifier combos belong to the OS / browser, not us.
                if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
                if (e.repeat) return;
                if (attesting || !attestedName.trim() || !attestConfirmed) return;
                e.preventDefault();
                e.stopPropagation();
                void handleAttest();
              }}
              disabled={attesting || !attestedName.trim() || !attestConfirmed}
              className="w-full"
            >
              {attesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Check className="h-4 w-4 mr-2" />
              {attestError ? "Retry attestation" : "Attest"}
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
