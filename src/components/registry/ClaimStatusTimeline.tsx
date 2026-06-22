/**
 * Batch 23 — Claim status timeline.
 *
 * Summarises the claim review journey using only the limited, safe wording
 * defined in src/lib/registry-claim-workflow.ts. We never imply that an
 * approval = verification, and we never expose admin-only reasoning.
 */
import { Check, Circle, Loader2, X } from "lucide-react";
import type { RegistryClaimWorkflowStatus } from "@/lib/registry-claim-workflow";
import { REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE } from "@/lib/registry-claim-workflow";

type Stage = {
  key: string;
  label: string;
  description: string;
  matches: RegistryClaimWorkflowStatus[];
};

// Five public-safe stages. Internal admin statuses (escalated, conflict_*,
// more_evidence_requested) are folded into "Under review" so the claimant
// never sees admin-only language.
const STAGES: Stage[] = [
  {
    key: "submitted",
    label: "Claim submitted",
    description:
      "We have received your claim. No verification has been performed at this stage.",
    matches: ["claim_submitted", "evidence_resubmitted"],
  },
  {
    key: "under_review",
    label: "Under review",
    description:
      "A reviewer is checking the supporting documents you provided.",
    matches: [
      "under_review",
      "more_evidence_requested",
      "claim_conflict_detected",
      "claim_conflict_locked",
      "escalated",
    ],
  },
  {
    key: "decision",
    label: "Decision recorded",
    description:
      "A decision has been recorded against your claim. This does not constitute verification of the underlying company.",
    matches: ["approved", "rejected"],
  },
];

const CLOSED_STATUSES: RegistryClaimWorkflowStatus[] = [
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "withdrawn",
];

function stageState(
  stage: Stage,
  current: RegistryClaimWorkflowStatus,
  reachedIndex: number,
  index: number,
): "complete" | "current" | "pending" {
  if (CLOSED_STATUSES.includes(current) && stage.key === "decision") {
    return "complete";
  }
  if (stage.matches.includes(current)) return "current";
  if (index < reachedIndex) return "complete";
  return "pending";
}

export function ClaimStatusTimeline({
  status,
}: {
  status: RegistryClaimWorkflowStatus;
}) {
  const reachedIndex = (() => {
    if (CLOSED_STATUSES.includes(status)) return STAGES.length - 1;
    for (let i = STAGES.length - 1; i >= 0; i--) {
      if (STAGES[i].matches.includes(status)) return i;
    }
    return 0;
  })();

  const isRejected = status === "rejected";

  return (
    <ol
      aria-label="Claim review timeline"
      className="space-y-3"
      data-testid="claim-status-timeline"
    >
      {STAGES.map((stage, idx) => {
        const state = stageState(stage, status, reachedIndex, idx);
        const Icon =
          state === "complete"
            ? isRejected && stage.key === "decision"
              ? X
              : Check
            : state === "current"
              ? Loader2
              : Circle;
        return (
          <li
            key={stage.key}
            data-stage={stage.key}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className="flex gap-3 items-start"
          >
            <span
              aria-hidden
              className={[
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                state === "complete"
                  ? "bg-primary text-primary-foreground border-primary"
                  : state === "current"
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground",
              ].join(" ")}
            >
              <Icon
                className={`h-3.5 w-3.5 ${state === "current" ? "animate-spin" : ""}`}
              />
            </span>
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">
                {stage.label}
                <span className="sr-only"> — {state}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {stage.description}
              </p>
            </div>
          </li>
        );
      })}
      <li className="pt-2 text-[11px] text-muted-foreground italic">
        {REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE}
      </li>
    </ol>
  );
}
