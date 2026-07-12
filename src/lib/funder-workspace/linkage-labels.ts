/**
 * Institutional Funder Evidence Workspace — Batch 8
 * Human-readable labels + variants for the canonical deal-linkage status.
 */
import type { DealLinkageStatus } from "./types";

export type LinkageDisplayStatus = DealLinkageStatus | "unlinked";

export function linkageStatusOf(row: { match_id: string | null; deal_linkage_status: DealLinkageStatus | null }): LinkageDisplayStatus {
  if (row.deal_linkage_status) return row.deal_linkage_status;
  if (row.match_id) return "canonical";
  return "unlinked";
}

export const LINKAGE_STATUS_LABEL: Record<LinkageDisplayStatus, string> = {
  canonical: "Canonical deal linked",
  legacy_fallback: "Legacy reference resolved",
  legacy_unresolved: "Legacy release requires linking",
  invalid: "Invalid reference",
  unlinked: "Legacy release requires linking",
};

export function linkageStatusBadgeVariant(s: LinkageDisplayStatus): "default" | "secondary" | "destructive" {
  if (s === "canonical") return "default";
  if (s === "legacy_fallback") return "secondary";
  return "destructive";
}

export function requiresLegacyLinking(s: LinkageDisplayStatus): boolean {
  return s === "legacy_unresolved" || s === "unlinked" || s === "invalid";
}
