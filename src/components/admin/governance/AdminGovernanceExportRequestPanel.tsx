/**
 * Admin Export Controls Batch 2 — HQ Governance Record Export Request panel.
 *
 * Platform-admin only. AAL2-required (server enforced). Submits a
 * Governance Record export REQUEST only — no file is generated, no
 * download link is shown, no signed URL is minted.
 */

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Lock } from "lucide-react";

// Mirror of EXPORT_PURPOSES in supabase/functions/_shared/export-purpose.ts.
const EXPORT_PURPOSES = [
  "verified_user_data_export",
  "client_approved_reporting",
  "billing_or_payment_reconciliation",
  "compliance_verification_or_sanctions_review",
  "dispute_resolution",
  "legal_hold_or_legal_review",
  "technical_incident_investigation",
  "audit_or_regulatory_review",
  "izenzo_approved_client_support",
] as const;
type ExportPurpose = (typeof EXPORT_PURPOSES)[number];

const REDACTION_MODES = [
  {
    value: "redacted_client_safe",
    label: "Redacted — client-safe (default)",
    hint: "Personal identifiers and internal notes removed.",
  },
  {
    value: "evidence_only",
    label: "Evidence-only",
    hint: "Sealed evidence rows only. No raw payloads.",
  },
  {
    value: "metadata_only",
    label: "Metadata-only",
    hint: "Timestamps, actors, and event kinds only.",
  },
  {
    value: "full_internal",
    label: "Full internal (platform_admin investigations only)",
    hint: "Use only when explicitly required for incident review.",
  },
] as const;

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      requestId: string;
      redactionMode: string;
      legalHoldAutoDetection?: {
        has_legal_hold: boolean;
        hold_count: number;
        hold_sources: string[];
        primary_scope: string | null;
        detected_at: string;
        detection_source: string;
      } | null;
    }
  | { kind: "denied"; code: string; message: string }
  | { kind: "failed"; message: string };

interface Props {
  governanceRecordId: string;
  recordRef: string;
  targetOrgId?: string | null;
}

export function AdminGovernanceExportRequestPanel({
  governanceRecordId,
  recordRef,
  targetOrgId = null,
}: Props) {
  const { isPlatformAdmin } = useAuth();
  const [purpose, setPurpose] = useState<ExportPurpose>(
    "audit_or_regulatory_review",
  );
  const [redactionMode, setRedactionMode] = useState<string>(
    "redacted_client_safe",
  );
  const [reason, setReason] = useState("");
  const [scopeNote, setScopeNote] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  // Hard visibility gate. Server is also gated (defence in depth).
  if (!isPlatformAdmin) return null;

  const canSubmit =
    state.kind !== "submitting" && reason.trim().length >= 10;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setState({ kind: "submitting" });
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-governance-export-request",
        {
          body: {
            governance_record_id: governanceRecordId,
            target_org_id: targetOrgId ?? null,
            purpose,
            reason: scopeNote.trim()
              ? `${reason.trim()}\n\nScope: ${scopeNote.trim()}`
              : reason.trim(),
            requested_categories: ["governance_record_timeline"],
            redaction_mode: redactionMode,
          },
        },
      );
      if (error) {
        const code =
          (error as { context?: { code?: string } })?.context?.code ?? "";
        const message = error.message ?? "Request failed.";
        if (
          code === "MFA_REQUIRED" ||
          /mfa_required/i.test(message)
        ) {
          setState({
            kind: "denied",
            code: "MFA_REQUIRED",
            message:
              "Multi-factor authentication (AAL2) is required before this export request can be recorded.",
          });
          toast.error("MFA required");
          return;
        }
        if (
          code === "NOT_PLATFORM_ADMIN" ||
          /forbidden/i.test(message)
        ) {
          setState({
            kind: "denied",
            code: "NOT_PLATFORM_ADMIN",
            message:
              "Only platform admins can request Governance Record exports.",
          });
          toast.error("Forbidden");
          return;
        }
        setState({ kind: "failed", message });
        toast.error(`Request failed: ${message}`);
        return;
      }
      const resp = data as {
        request_id?: string;
        redaction_mode?: string;
      };
      if (!resp?.request_id) {
        setState({ kind: "failed", message: "Unexpected server response." });
        toast.error("Request failed: unexpected response");
        return;
      }
      setState({
        kind: "success",
        requestId: resp.request_id,
        redactionMode: resp.redaction_mode ?? redactionMode,
      });
      toast.success("Export request recorded");
      setReason("");
      setScopeNote("");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ kind: "failed", message });
      toast.error(`Request failed: ${message}`);
    } finally {
      // Zero Swallowed Errors — state machine always advances.
    }
  };

  return (
    <section
      className="rounded-sm border border-border bg-card p-5 space-y-4"
      data-testid="admin-governance-export-request-panel"
    >
      <header className="space-y-1">
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
          HQ · Admin Export Controls
        </p>
        <h3 className="text-sm font-medium text-foreground">
          Request a Governance Record export
        </h3>
        <p className="text-xs text-muted-foreground">
          Anchor: <span className="font-mono">{recordRef}</span>
        </p>
      </header>

      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle className="text-xs">AAL2 required</AlertTitle>
        <AlertDescription className="text-xs">
          Submitting this request requires multi-factor authentication.
          This batch only records the request — no file is generated, no
          download link is created, and no data leaves the platform.
          A second platform admin must approve before any file is
          produced.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">
            Export purpose
          </label>
          <Select
            value={purpose}
            onValueChange={(v) => setPurpose(v as ExportPurpose)}
          >
            <SelectTrigger data-testid="export-purpose">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPORT_PURPOSES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">
            Redaction mode
          </label>
          <Select value={redactionMode} onValueChange={setRedactionMode}>
            <SelectTrigger data-testid="export-redaction-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REDACTION_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {REDACTION_MODES.find((m) => m.value === redactionMode)?.hint}
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">
          Reason (≥10 characters, recorded in audit)
        </label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Why is this export needed? This is recorded immutably in the audit trail."
          data-testid="export-reason"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">
          Scope / filter summary (optional)
        </label>
        <Textarea
          value={scopeNote}
          onChange={(e) => setScopeNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Date range, events of interest, counterparties, etc."
          data-testid="export-scope-note"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          data-testid="export-submit"
        >
          {state.kind === "submitting"
            ? "Recording request…"
            : "Record export request"}
        </Button>
        <Badge variant="outline" className="text-[10px]">
          <ShieldCheck className="h-3 w-3 mr-1" />
          No file generated · No download link
        </Badge>
      </div>

      {state.kind === "success" && (
        <Alert data-testid="export-success">
          <AlertTitle className="text-xs">
            Export request recorded
          </AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            <p>
              Request ID:{" "}
              <span className="font-mono">{state.requestId}</span>
            </p>
            <p>
              Redaction mode:{" "}
              <span className="font-mono">{state.redactionMode}</span>
            </p>
            <p>
              Awaiting approval. No file has been generated. No download
              link will appear until the approve + prepare batches are
              shipped and signed off.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "denied" && (
        <Alert variant="destructive" data-testid="export-denied">
          <AlertTitle className="text-xs">
            Request blocked · {state.code}
          </AlertTitle>
          <AlertDescription className="text-xs">
            {state.message}
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "failed" && (
        <Alert variant="destructive" data-testid="export-failed">
          <AlertTitle className="text-xs">Request failed</AlertTitle>
          <AlertDescription className="text-xs">
            {state.message}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
