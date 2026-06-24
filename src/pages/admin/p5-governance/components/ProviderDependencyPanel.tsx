/**
 * ProviderDependencyPanel — Stage 4
 *
 * Safe operational rendering of provider state. Uses approved wording only:
 * "Provider result received / failed / timeout / Credentials pending /
 * Provider not live / Requires human review". Never emits "verified",
 * "cleared", "bankable", "compliant", etc.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { P5ProviderStatus } from "@/lib/p5-governance/constants";

export interface ProviderDependencyData {
  provider_dependency: boolean;
  provider_dependency_type: string | null;
  provider_status: P5ProviderStatus | null;
  provider_last_checked_at: string | null;
  provider_reference?: string | null;
  requires_human_review?: boolean;
}

const STATUS_COPY: Record<P5ProviderStatus, { label: string; tone: string }> = {
  not_live: { label: "Provider not live", tone: "bg-muted text-muted-foreground" },
  credentials_pending: {
    label: "Credentials pending",
    tone: "bg-amber-500/10 text-amber-700 border-amber-200",
  },
  pending: { label: "Provider pending", tone: "bg-amber-500/10 text-amber-700 border-amber-200" },
  timeout: { label: "Provider timeout", tone: "bg-destructive/10 text-destructive" },
  inconclusive: {
    label: "Provider inconclusive — requires human review",
    tone: "bg-amber-500/10 text-amber-700 border-amber-200",
  },
  failed: { label: "Provider failed", tone: "bg-destructive/10 text-destructive" },
  passed: { label: "Provider result received", tone: "bg-primary/10 text-primary" },
  not_applicable: { label: "Not applicable", tone: "bg-muted text-muted-foreground" },
};

export function ProviderDependencyPanel({ data }: { data: ProviderDependencyData }) {
  if (!data.provider_dependency) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider dependency</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No provider dependency recorded for this case.
        </CardContent>
      </Card>
    );
  }

  const copy = data.provider_status
    ? STATUS_COPY[data.provider_status]
    : { label: "Provider status not yet recorded", tone: "bg-muted text-muted-foreground" };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provider dependency</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Dependency type</span>
          <span className="font-mono">{data.provider_dependency_type ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Provider status</span>
          <Badge variant="outline" className={copy.tone}>
            {copy.label}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Last checked</span>
          <span className="font-mono">
            {data.provider_last_checked_at
              ? new Date(data.provider_last_checked_at).toISOString()
              : "—"}
          </span>
        </div>
        {data.provider_reference && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Provider reference</span>
            <span className="font-mono break-all">{data.provider_reference}</span>
          </div>
        )}
        {data.requires_human_review && (
          <div
            role="note"
            className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800"
          >
            Requires human review before any onward action.
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Provider-dependent status reflects the upstream provider only. It does
          not imply verification, clearance, compliance or bankability.
        </p>
      </CardContent>
    </Card>
  );
}
