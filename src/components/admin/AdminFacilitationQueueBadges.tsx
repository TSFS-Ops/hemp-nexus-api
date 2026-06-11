// src/components/admin/AdminFacilitationQueueBadges.tsx
//
// Batch 2 — Read-only visual surface for `queue_derived`.
//
// HARD BOUNDARIES:
//   • Display only. No mutation, no fetch, no dispatch.
//   • Must NEVER render a Send button or send-like copy.
//   • Consumes Batch 1 `queue_derived` payload only.

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import {
  BADGE_TONE_CLASS,
  formatSlaDue,
  NEXT_ACTION_LABELS,
  nextActionTone,
  relativeFromNow,
  SLA_STATUS_LABELS,
  slaTone,
  type QueueDerived,
} from "@/lib/admin-facilitation-queue";

interface Props {
  queueDerived: QueueDerived | null | undefined;
  engagementId: string;
}

export function AdminFacilitationQueueBadges({ queueDerived, engagementId }: Props) {
  if (!queueDerived) return null;
  const qd = queueDerived;

  const nextActionLabel = NEXT_ACTION_LABELS[qd.next_action_label];
  const slaLabel = SLA_STATUS_LABELS[qd.sla_status];

  return (
    <div
      data-testid={`facilitation-queue-badges-${engagementId}`}
      data-next-action={qd.next_action_label}
      data-sla-status={qd.sla_status}
      data-draft-status={qd.draft_status ?? ""}
      data-manual-send-required={qd.manual_send_required ? "true" : "false"}
      className="mt-2 flex flex-col gap-1 text-[11px]"
    >
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant="outline"
          className={`${BADGE_TONE_CLASS[nextActionTone(qd.next_action_label)]} text-[10px] font-semibold uppercase tracking-wide rounded-md`}
          data-testid={`badge-next-action-${qd.next_action_label}`}
        >
          {nextActionLabel}
        </Badge>

        {qd.sla_status !== "not_applicable" && slaLabel && (
          <Badge
            variant="outline"
            className={`${BADGE_TONE_CLASS[slaTone(qd.sla_status)]} text-[10px] font-medium rounded-md`}
            data-testid={`badge-sla-${qd.sla_status}`}
          >
            {slaLabel}
          </Badge>
        )}

        {qd.outreach_count === 0 && qd.next_action_label !== "accepted" &&
          qd.next_action_label !== "declined" && (
            <Badge
              variant="outline"
              className={`${BADGE_TONE_CLASS.amber} text-[10px] font-medium rounded-md`}
              data-testid="badge-no-outreach-logged"
            >
              No outreach logged
            </Badge>
          )}
      </div>

      <div className="text-slate-700 leading-snug">
        <span className="font-medium">Next action:</span>{" "}
        <span data-testid="queue-next-action-text">{nextActionLabel}</span>
      </div>

      {qd.manual_send_required && (
        <div
          className="text-amber-900 leading-snug"
          data-testid="queue-manual-send-notice"
        >
          Approved draft available — manual send required. The platform does
          not transmit outreach automatically.
        </div>
      )}

      {qd.sla_status !== "not_applicable" && qd.sla_due_at && (
        <div className="text-slate-600" data-testid="queue-sla-line">
          SLA {qd.sla_status === "overdue" ? "overdue since" : "due"}{" "}
          {formatSlaDue(qd.sla_due_at)}
        </div>
      )}

      {qd.last_outreach_at && (
        <div className="text-slate-600" data-testid="queue-last-outreach-line">
          Last outreach:{" "}
          {qd.last_outreach_channel ? `${qd.last_outreach_channel} · ` : ""}
          {relativeFromNow(qd.last_outreach_at)}
          {qd.outreach_count > 1 ? ` · ${qd.outreach_count} total` : ""}
        </div>
      )}
    </div>
  );
}
