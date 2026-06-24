/**
 * P5ReadinessCard — Stage 5
 *
 * Reusable, read-only readiness card for non-admin subject pages
 * (entity / organization / match / counterparty / project / transaction).
 *
 * The card consumes the scoped P-5 summary shape returned by the
 * `p5-governance-readiness-summary` edge function. It NEVER reads
 * `p5_governance_*` tables directly — that's enforced server-side by RLS
 * and contractually here at the type level via `P5ReadinessSummary`.
 *
 * Rules applied (Batch 1 answers):
 *   - Stage 1 SSOT labels only (P5StatusBadge).
 *   - Stage 2 wording guard on every customer-visible string.
 *   - Provider-dependent wording is cautious; never implies pass/verified.
 *   - Fields are gated by viewer ("admin" | "internal" | "customer" |
 *     "funder" | "api_client").
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { P5StatusBadge } from "@/pages/admin/p5-governance/components/P5StatusBadge";
import {
  assertCustomerSafeWording,
  isCustomerSafeWording,
} from "@/lib/p5-governance/wording-guard";
import type {
  P5ReadinessSummary,
  P5SummaryViewer,
} from "@/lib/p5-governance/summary-types";
import type { P5ProviderStatus } from "@/lib/p5-governance/constants";

const PROVIDER_LABEL: Record<P5ProviderStatus, string> = {
  not_live: "Provider not live",
  credentials_pending: "Credentials pending",
  pending: "External confirmation pending",
  timeout: "Provider timeout — retry pending",
  inconclusive: "Provider result inconclusive — manual review required",
  failed: "Provider result requires review",
  passed: "Provider result received",
  not_applicable: "Not applicable",
};

function safeText(text: string | null | undefined, viewer: P5SummaryViewer): string {
  if (!text) return "—";
  if (viewer === "admin" || viewer === "internal") return text;
  // For external surfaces, drop anything that fails the wording guard.
  return isCustomerSafeWording(text, {
    surface: viewer === "funder" ? "funder" : viewer === "api_client" ? "public_api" : "customer",
  })
    ? text
    : "Under Review";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toISOString().slice(0, 10);
}

export interface P5ReadinessCardProps {
  summary: P5ReadinessSummary;
  viewer: P5SummaryViewer;
  /** Optional subject label (e.g. "Counterparty", "Match"), purely cosmetic. */
  subjectLabel?: string;
  className?: string;
}

export function P5ReadinessCard({
  summary,
  viewer,
  subjectLabel,
  className,
}: P5ReadinessCardProps) {
  const showGovLane = viewer === "admin" || viewer === "internal";
  const showCompLane = viewer === "admin" || viewer === "internal";
  const showAuditRef = viewer === "admin" || viewer === "internal" || viewer === "funder";
  const showWarnings = viewer !== "api_client";
  const showOwnerType = viewer === "admin" || viewer === "internal";

  const provider = summary.provider_status
    ? PROVIDER_LABEL[summary.provider_status]
    : "Provider status not yet recorded";

  const nextAction = safeText(summary.next_action, viewer);
  // Wording guard at render time — fails loudly in tests.
  assertCustomerSafeWording(nextAction, {
    surface:
      viewer === "admin" || viewer === "internal"
        ? "admin_internal"
        : viewer === "funder"
          ? "funder"
          : viewer === "api_client"
            ? "public_api"
            : "customer",
  });

  return (
    <Card className={className} data-testid="p5-readiness-card" data-viewer={viewer}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">
            {subjectLabel ? `${subjectLabel} — Readiness` : "Readiness"}
          </CardTitle>
          <P5StatusBadge status={summary.readiness_status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {(showGovLane || showCompLane) && (
          <div className="flex flex-wrap gap-2" data-testid="p5-readiness-lanes">
            {showGovLane && (
              <span className="inline-flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Governance</span>
                <P5StatusBadge status={summary.governance_status} />
              </span>
            )}
            {showCompLane && (
              <span className="inline-flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Compliance</span>
                <P5StatusBadge status={summary.compliance_status} />
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3" data-testid="p5-readiness-counts">
          <div>
            <div className="text-xs text-muted-foreground">Blockers</div>
            <div className="font-medium">{summary.blocker_count}</div>
          </div>
          {showWarnings && (
            <div>
              <div className="text-xs text-muted-foreground">Warnings</div>
              <div className="font-medium">{summary.warning_count}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-muted-foreground">Required items outstanding</div>
            <div className="font-medium">{summary.required_items_missing}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last updated</div>
            <div className="font-medium">{fmtDate(summary.last_updated_at)}</div>
          </div>
        </div>

        {summary.provider_dependency && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3" data-testid="p5-provider">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">Provider-Dependent</Badge>
              {summary.provider_dependency_type && (
                <span className="text-xs text-muted-foreground">
                  {summary.provider_dependency_type}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{provider}</p>
            {summary.provider_last_checked_at && (
              <p className="text-xs text-muted-foreground mt-1">
                Last checked: {fmtDate(summary.provider_last_checked_at)}
              </p>
            )}
          </div>
        )}

        <div data-testid="p5-next-action">
          <div className="text-xs text-muted-foreground">Next action</div>
          <div className="font-medium">{nextAction}</div>
          {showOwnerType && summary.next_owner_type && (
            <div className="text-xs text-muted-foreground">
              Owner: {summary.next_owner_type}
            </div>
          )}
        </div>

        {showAuditRef && (summary.audit_reference || summary.evidence_pack_id) && (
          <div className="text-xs text-muted-foreground border-t border-border pt-2 space-y-0.5" data-testid="p5-audit-refs">
            {summary.audit_reference && <div>Audit ref: {summary.audit_reference}</div>}
            {summary.evidence_pack_id && (
              <div>Evidence pack: {summary.evidence_pack_id}</div>
            )}
            {viewer === "admin" && summary.version_hash_chain_reference && (
              <div>Hash-chain ref: {summary.version_hash_chain_reference}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
