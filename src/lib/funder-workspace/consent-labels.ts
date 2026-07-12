/**
 * Institutional Funder Evidence Workspace — controlled-pilot verification sweep
 * Shared plain-English labels for ConsentStatus, so every surface that
 * displays a release's buyer/seller consent (admin New Release form, admin
 * Releases list, admin Release Detail consent history, and the funder-facing
 * Deals list / Deal Detail pages) renders the same non-technical wording.
 *
 * Stored/enforced values are NOT changed by this file — only display text.
 */
import type { ConsentStatus } from "./types";

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
    not_required: "Not required",
    pending: "Pending",
    granted: "Granted",
    declined: "Declined",
    overridden: "Overridden (admin)",
};

export function consentStatusLabel(status: ConsentStatus): string {
    return CONSENT_STATUS_LABELS[status] ?? status;
}
