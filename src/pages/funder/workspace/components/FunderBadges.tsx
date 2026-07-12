/**
 * Batch 3 — small badge helpers for the funder workspace UI.
 * The release-status badge accepts the *effective* status (see
 * lib/funder-workspace/release-state.ts) so admin + funder surfaces
 * render identical colours and labels.
 *
 * Controlled-pilot verification sweep: consent badges now use the shared
 * plain-English CONSENT_STATUS_LABELS map (same wording as the admin New
 * Release form) instead of the raw enum value, so a non-technical funder
 * user never sees "not_required" / "overridden" etc. on this surface.
 */
import { Badge } from "@/components/ui/badge";
import type { ConsentStatus } from "@/lib/funder-workspace/types";
import { CONSENT_STATUS_LABELS } from "@/lib/funder-workspace/consent-labels";
import {
    statusBadgeVariant,
    statusLabel,
    type EffectiveReleaseStatus,
} from "@/lib/funder-workspace/release-state";

export function FunderReleaseStatusBadge({
    status,
}: {
    status: EffectiveReleaseStatus;
}) {
    return <Badge variant={statusBadgeVariant(status)}>{statusLabel(status)}</Badge>Badge>;
}

export function ConsentStatusBadge({ status }: { status: ConsentStatus }) {
    const variant =
          status === "granted" || status === "not_required"
        ? "default"
            : status === "overridden" || status === "declined"
        ? "destructive"
            : "secondary";
    return <Badge variant={variant}>{CONSENT_STATUS_LABELS[status] ?? status}</Badge>Badge>;
}

export function PermissionBadge({ value }: { value: boolean }) {
    return (
          <Badge variant={value ? "default" : "secondary"}>{value ? "Yes" : "No"}</Badge>Badge>
        );
}
