/**
 * P-5 Batch 4 Stage 4 — evidence checklist.
 *
 * Lists evidence items with status badges. Accept / reject / waive
 * actions all flow through the Stage 3 RPC wrappers.
 *
 * Raw evidence file references / hashes are NEVER rendered here. Stage
 * 4 admin views only show evidence_type / evidence_label / status.
 */
import { Button } from "@/components/ui/button";
import { P5B4StatusBadge } from "./P5B4StatusBadge";
import { P5B4ReasonedActionDialog } from "./P5B4ReasonedActionDialog";
import { p5b4Admin } from "@/lib/p5-batch4/rpc";
import type { P5B4AdminEvidence } from "@/lib/p5-batch4/summary-client";

export interface P5B4EvidenceChecklistProps {
  evidence: P5B4AdminEvidence[];
  onChanged?: () => void;
}

export function P5B4EvidenceChecklist({ evidence, onChanged }: P5B4EvidenceChecklistProps) {
  if (evidence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="p5b4-evidence-empty">
        No evidence items yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card" data-testid="p5b4-evidence-checklist">
      {evidence.map((e) => {
        const reviewable =
          e.evidence_status === "uploaded" || e.evidence_status === "under_review";
        return (
          <li
            key={e.id}
            className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            data-testid="p5b4-evidence-row"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">{e.evidence_label}</span>
              <span className="text-xs text-muted-foreground">
                {e.evidence_type} · {e.requirement_type}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <P5B4StatusBadge kind="evidence" value={e.evidence_status} />
              {reviewable ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="p5b4-evidence-accept"
                    onClick={async () => {
                      const { error } = await p5b4Admin.reviewEvidence(e.id, "accepted", null);
                      if (error) throw error;
                      onChanged?.();
                    }}
                  >
                    Accept
                  </Button>
                  <P5B4ReasonedActionDialog
                    trigger={
                      <Button size="sm" variant="destructive" data-testid="p5b4-evidence-reject">
                        Reject
                      </Button>
                    }
                    title={`Reject ${e.evidence_label}`}
                    destructive
                    onConfirm={async (reason) => {
                      const { error } = await p5b4Admin.reviewEvidence(e.id, "rejected", reason);
                      if (error) throw error;
                      onChanged?.();
                    }}
                  />
                </>
              ) : null}
              {e.evidence_status !== "waived" && e.evidence_status !== "accepted" ? (
                <P5B4ReasonedActionDialog
                  trigger={
                    <Button size="sm" variant="ghost" data-testid="p5b4-evidence-waive">
                      Waive
                    </Button>
                  }
                  title={`Waive ${e.evidence_label}`}
                  warning="Waiver bypasses a normal requirement. Exceptional, audited and reviewable."
                  destructive
                  onConfirm={async (reason) => {
                    const { error } = await p5b4Admin.waiveEvidence(e.id, reason);
                    if (error) throw error;
                    onChanged?.();
                  }}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
