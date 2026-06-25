/**
 * P-5 Batch 4 Stage 5 — evidence task list for the org-user surface.
 *
 * Lists evidence items the user must upload or replace. Upload flows
 * through the Stage 3 org-user wrapper `p5b4OrgUser.submitEvidence`
 * (the ONLY mutation wrapper this surface is permitted to call).
 *
 * Raw file references and hashes are NEVER rendered. The SHA-256 hash
 * is computed locally and passed through to the RPC so the audit trail
 * captures a fingerprint without exposing internals to the UI.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { P5B4DeskStatusBadge } from "./P5B4DeskStatusBadge";
import { p5b4OrgUser } from "@/lib/p5-batch4/rpc";
import type { P5B4OrgUserEvidenceTask } from "@/lib/p5-batch4/org-user-client";

export interface P5B4DeskEvidenceTaskProps {
  evidence: P5B4OrgUserEvidenceTask[];
  onChanged?: () => void;
}

async function sha256OfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function actionLabel(status: string): string | null {
  if (status === "requested" || status === "missing") return "Upload";
  if (status === "rejected" || status === "expired") return "Replace";
  return null;
}

export function P5B4DeskEvidenceTask({ evidence, onChanged }: P5B4DeskEvidenceTaskProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(itemId: string, file: File | null) {
    if (!file) return;
    setBusyId(itemId);
    setError(null);
    try {
      const hash = await sha256OfFile(file);
      // The "reference" is a deterministic, non-internal handle.
      // We do NOT render this back to the user — only used to satisfy
      // the RPC contract. Real storage upload is out of Stage 5 scope.
      const ref = `desk-upload://${itemId}/${encodeURIComponent(file.name)}`;
      const { error: rpcErr } = await p5b4OrgUser.submitEvidence(itemId, ref, hash);
      if (rpcErr) throw rpcErr;
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (evidence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="p5b4-desk-evidence-empty">
        No documents requested yet.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="p5b4-desk-evidence">
      {error ? (
        <p className="text-sm text-destructive" data-testid="p5b4-desk-evidence-error">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {evidence.map((e) => {
          const action = actionLabel(e.evidence_status);
          return (
            <li
              key={e.id}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
              data-testid="p5b4-desk-evidence-row"
              data-status={e.evidence_status}
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {e.evidence_label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {e.evidence_type} · {e.requirement_type}
                </span>
                {e.reject_reason && e.evidence_status === "rejected" ? (
                  <span
                    className="mt-1 text-xs text-destructive"
                    data-testid="p5b4-desk-evidence-reject-reason"
                  >
                    Reviewer feedback: {e.reject_reason}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <P5B4DeskStatusBadge kind="evidence" value={e.evidence_status} />
                {action ? (
                  <label
                    className="inline-flex"
                    data-testid="p5b4-desk-evidence-upload-label"
                  >
                    <Input
                      type="file"
                      className="hidden"
                      disabled={busyId === e.id}
                      onChange={(ev) => {
                        const f = ev.target.files?.[0] ?? null;
                        ev.target.value = "";
                        void handleUpload(e.id, f);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={busyId === e.id}
                      data-testid="p5b4-desk-evidence-action"
                      asChild
                    >
                      <span>{busyId === e.id ? "Uploading…" : action}</span>
                    </Button>
                  </label>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
