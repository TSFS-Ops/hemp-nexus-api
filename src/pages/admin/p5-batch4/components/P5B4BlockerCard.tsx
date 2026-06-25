/**
 * P-5 Batch 4 Stage 4 — blocker card.
 *
 * Renders one blocker with its external-safe label, blocker_type
 * (hard / soft_warning) and status. Resolve / override both require a
 * reasoned dialog and call the Stage 3 RPC wrappers.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { P5B4StatusBadge } from "./P5B4StatusBadge";
import { P5B4ReasonedActionDialog } from "./P5B4ReasonedActionDialog";
import { p5b4Admin } from "@/lib/p5-batch4/rpc";
import type { P5B4AdminBlocker } from "@/lib/p5-batch4/summary-client";

export interface P5B4BlockerCardProps {
  blocker: P5B4AdminBlocker;
  onChanged?: () => void;
}

export function P5B4BlockerCard({ blocker, onChanged }: P5B4BlockerCardProps) {
  const open = blocker.blocker_status === "open" || blocker.blocker_status === "escalated";
  return (
    <Card data-testid="p5b4-blocker-card" data-key={blocker.blocker_key}>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{blocker.blocker_name}</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {blocker.blocker_type === "hard" ? "Hard blocker" : "Soft warning"}
            </span>
            <P5B4StatusBadge kind="blocker" value={blocker.blocker_status} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{blocker.external_safe_label}</p>
      </CardHeader>
      {open ? (
        <CardContent className="flex items-center gap-2">
          <P5B4ReasonedActionDialog
            trigger={
              <Button size="sm" variant="outline" data-testid="p5b4-blocker-resolve">
                Resolve
              </Button>
            }
            title="Resolve blocker"
            description="Records resolution with an audited reason."
            onConfirm={async (reason) => {
              const { error } = await p5b4Admin.resolveBlocker(blocker.id, reason);
              if (error) throw error;
              onChanged?.();
            }}
          />
          <P5B4ReasonedActionDialog
            trigger={
              <Button size="sm" variant="destructive" data-testid="p5b4-blocker-override">
                Override
              </Button>
            }
            title="Override blocker"
            destructive
            warning="Override forces progression past this blocker. Permanently recorded in the audit timeline."
            onConfirm={async (reason) => {
              const { error } = await p5b4Admin.overrideBlocker(blocker.id, reason);
              if (error) throw error;
              onChanged?.();
            }}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}
