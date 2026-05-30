/**
 * Admin Export Controls Batch 9 — HQ Redaction Preview Shell.
 *
 * Platform-admin only (UI guard) + AAL2-required (server enforced).
 * READ-ONLY preview of what a Governance Record export would look
 * like after applying the Batch 8 redaction contract.
 *
 * Hard contract — this panel NEVER renders:
 *   - prepare / generate / download / destroy controls
 *   - temporary links, file paths, storage keys, download tokens
 *   - CSV / JSON / PDF export buttons
 *   - copy-link / save-as / blob / file anchors
 *   - raw legal-hold reasons, notes, or metadata
 *   - raw sanctions / PEP / adverse-media payloads
 *   - secrets / tokens / auth identifiers
 *
 * Invokes only `admin-governance-export-preview`. Does NOT mutate
 * export_requests, legal_holds, governance records, or any other row.
 */

import { useCallback, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, Lock, ShieldCheck, FileX2 } from "lucide-react";

const REDACTION_MODES = [
  "redacted_client_safe",
  "evidence_only",
  "metadata_only",
  "full_internal",
] as const;
type RedactionMode = (typeof REDACTION_MODES)[number];

interface RedactionManifest {
  mode: RedactionMode;
  allowed_fields: string[];
  removed_fields: string[];
  masked_fields: string[];
  forbidden_fields_blocked: string[];
  legal_hold_reduced: boolean;
  notes: string[];
}

interface PreviewResponse {
  ok: true;
  governance_record_id: string;
  redaction_mode: RedactionMode;
  redacted: Record<string, unknown>;
  manifest: RedactionManifest;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; preview: PreviewResponse }
  | { kind: "denied"; code: string; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "error"; message: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AdminGovernanceExportPreviewPanel() {
  const { isPlatformAdmin } = useAuth();
  const [recordId, setRecordId] = useState("");
  const [mode, setMode] = useState<RedactionMode>("redacted_client_safe");
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  const run = useCallback(async () => {
    if (!isPlatformAdmin) return;
    const trimmed = recordId.trim();
    if (!UUID_RE.test(trimmed)) {
      setState({
        kind: "error",
        message: "Enter a valid Governance Record id (UUID).",
      });
      return;
    }
    setState({ kind: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-governance-export-preview",
        { body: { governance_record_id: trimmed, redaction_mode: mode } },
      );
      if (error) {
        const code =
          (error as { context?: { code?: string } })?.context?.code ?? "";
        const message = error.message ?? "Preview failed.";
        if (
          code === "MFA_REQUIRED" ||
          code === "NOT_PLATFORM_ADMIN" ||
          code === "UNSUPPORTED_REDACTION_MODE"
        ) {
          setState({ kind: "denied", code, message });
          return;
        }
        if (code === "GOVERNANCE_RECORD_NOT_FOUND") {
          setState({
            kind: "not_found",
            message: "No Governance Record found for that id.",
          });
          return;
        }
        setState({ kind: "error", message });
        return;
      }
      setState({ kind: "loaded", preview: data as PreviewResponse });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ kind: "error", message });
    } finally {
      // Zero Swallowed Errors — state always advances.
    }
  }, [isPlatformAdmin, mode, recordId]);

  if (!isPlatformAdmin) {
    return (
      <Alert variant="destructive" data-testid="not-platform-admin">
        <AlertTitle className="text-xs">Restricted</AlertTitle>
        <AlertDescription className="text-xs">
          Governance Record export preview is restricted to platform admins.
        </AlertDescription>
      </Alert>
    );
  }

  const preview =
    state.kind === "loaded" ? state.preview : null;

  return (
    <section
      className="rounded-sm border border-border bg-card p-5 space-y-4"
      data-testid="admin-governance-export-preview-panel"
    >
      <header className="space-y-1">
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
          HQ · Admin Export Controls · Batch 9
        </p>
        <h3 className="text-sm font-medium text-foreground">
          Redaction preview (no download)
        </h3>
        <p className="text-xs text-muted-foreground">
          Read-only preview of what a Governance Record export would look
          like after applying the redaction contract. No file is generated,
          no download link is created, no temporary link is minted.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Badge
          variant="outline"
          className="text-[10px]"
          data-testid="badge-preview-only"
        >
          <Eye className="mr-1 h-3 w-3" /> Preview only — no file generated
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px]"
          data-testid="badge-no-download"
        >
          <FileX2 className="mr-1 h-3 w-3" /> No download link
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px]"
          data-testid="badge-no-temporary-link"
        >
          <Lock className="mr-1 h-3 w-3" /> No temporary link
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px]"
          data-testid="badge-aal2"
        >
          <ShieldCheck className="mr-1 h-3 w-3" /> AAL2 required
        </Badge>
      </div>

      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle className="text-xs">AAL2 required</AlertTitle>
        <AlertDescription className="text-xs">
          Previewing a Governance Record export requires multi-factor
          authentication. This view shows the redacted payload and its
          manifest only — it exposes no raw sanctions / PEP / adverse-media
          payloads, no raw legal-hold reasons or notes, no storage paths,
          and no download tokens.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto]">
        <div className="space-y-1">
          <Label htmlFor="gr-id" className="text-[11px] uppercase tracking-wide">
            Governance Record id
          </Label>
          <Input
            id="gr-id"
            value={recordId}
            onChange={(e) => setRecordId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            data-testid="input-governance-record-id"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mode" className="text-[11px] uppercase tracking-wide">
            Redaction mode
          </Label>
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as RedactionMode)}
          >
            <SelectTrigger
              id="mode"
              data-testid="select-redaction-mode"
              className="text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REDACTION_MODES.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            onClick={() => void run()}
            disabled={state.kind === "loading"}
            data-testid="btn-preview"
            size="sm"
          >
            {state.kind === "loading" ? "Previewing…" : "Preview"}
          </Button>
        </div>
      </div>

      {state.kind === "loading" && (
        <div className="space-y-2" data-testid="preview-loading">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {state.kind === "denied" && (
        <Alert variant="destructive" data-testid="preview-denied">
          <AlertTitle className="text-xs">{state.code}</AlertTitle>
          <AlertDescription className="text-xs">
            {state.message}
          </AlertDescription>
        </Alert>
      )}

      {state.kind === "not_found" && (
        <Alert data-testid="preview-not-found">
          <AlertTitle className="text-xs">Not found</AlertTitle>
          <AlertDescription className="text-xs">
            {state.message}
          </AlertDescription>
        </Alert>
      )}

      {state.kind === "error" && (
        <Alert variant="destructive" data-testid="preview-error">
          <AlertTitle className="text-xs">Preview failed</AlertTitle>
          <AlertDescription className="text-xs">
            {state.message}
          </AlertDescription>
        </Alert>
      )}

      {preview && (
        <div className="space-y-4" data-testid="preview-result">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              mode · {preview.redaction_mode}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              record · {preview.governance_record_id.slice(0, 8)}…
            </Badge>
            {preview.manifest.legal_hold_reduced && (
              <Badge variant="outline" className="text-[10px]">
                legal-hold · safe summary
              </Badge>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Redacted preview
            </h4>
            <pre
              className="overflow-auto rounded-sm border border-border bg-muted/40 p-3 text-[11px] font-mono"
              data-testid="preview-redacted"
            >
              {JSON.stringify(preview.redacted, null, 2)}
            </pre>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Redaction manifest
            </h4>
            <div
              className="grid grid-cols-1 gap-2 md:grid-cols-2"
              data-testid="preview-manifest"
            >
              <ManifestList
                title="Allowed fields"
                items={preview.manifest.allowed_fields}
              />
              <ManifestList
                title="Removed fields"
                items={preview.manifest.removed_fields}
              />
              <ManifestList
                title="Masked fields"
                items={preview.manifest.masked_fields}
              />
              <ManifestList
                title="Forbidden blocked"
                items={preview.manifest.forbidden_fields_blocked}
              />
            </div>
            {preview.manifest.notes.length > 0 && (
              <ul className="list-disc pl-5 text-[11px] text-muted-foreground">
                {preview.manifest.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ManifestList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="rounded-sm border border-border bg-background p-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-0.5 text-[11px] font-mono text-foreground">
          {items.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
