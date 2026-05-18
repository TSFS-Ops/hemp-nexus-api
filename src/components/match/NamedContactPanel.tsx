/**
 * MT-009 Phase 1 — Named Contact Panel (display-only).
 *
 * Shows per-side named-contact status on Match Details. Phase 1 is
 * detection-only:
 *   - no assignment buttons (assignment UI ships in Phase 2);
 *   - no hard progression block;
 *   - no email/invite/notification triggered;
 *   - reads from `match_named_contacts` via the read-model helper.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, CheckCircle2, UserCheck, UserPlus, UsersRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  requiresNamedContact,
  type LifecycleMatch,
} from "@/lib/match-lifecycle";
import {
  fetchActiveNamedContacts,
  toActiveNamedContacts,
  type MatchNamedContactRow,
  type NamedContactSide,
} from "@/lib/match-named-contacts";
import { useAuth } from "@/contexts/AuthContext";
import { useUserOrg } from "@/hooks/use-user-org";
import { AssignNamedContactDialog } from "./AssignNamedContactDialog";

interface NamedContactPanelProps {
  matchId: string;
  match: LifecycleMatch;
}

type SideStatus =
  | { kind: "satisfied_registered" }
  | { kind: "satisfied_controlled"; contact: MatchNamedContactRow }
  | { kind: "missing" }
  | { kind: "not_required" };

function deriveSideStatus(
  side: NamedContactSide,
  match: LifecycleMatch,
  rows: ReadonlyArray<MatchNamedContactRow>,
): SideStatus {
  const orgId =
    side === "buyer" ? match.buyer_org_id : match.seller_org_id;
  if (!orgId) return { kind: "not_required" };

  const registered =
    side === "buyer"
      ? match.buyer_authorised_user_id ?? match.buyer_contact_user_id
      : match.seller_authorised_user_id ?? match.seller_contact_user_id;
  if (registered) return { kind: "satisfied_registered" };

  const controlled = rows.find((r) => r.side === side && r.status === "active");
  if (controlled) return { kind: "satisfied_controlled", contact: controlled };

  return { kind: "missing" };
}

function SideRow({
  label,
  status,
  canAssign,
  onAssign,
}: {
  label: string;
  status: SideStatus;
  canAssign: boolean;
  onAssign: () => void;
}) {
  if (status.kind === "not_required") {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <UsersRound className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <Badge variant="outline" className="text-xs">
          Not required
        </Badge>
      </div>
    );
  }
  if (status.kind === "satisfied_registered") {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">
              Registered Izenzo user is assigned
            </div>
          </div>
        </div>
        <Badge className="bg-primary/10 text-primary border-primary/30">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Registered user
        </Badge>
      </div>
    );
  }
  if (status.kind === "satisfied_controlled") {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs text-muted-foreground font-mono">
              {status.contact.contact_name} · {status.contact.contact_email}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Controlled contact
          </Badge>
          {canAssign && (
            <Button
              size="sm"
              variant="outline"
              onClick={onAssign}
              data-testid={`replace-${label.toLowerCase()}-contact`}
            >
              Replace
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">
            No registered user or controlled contact assigned
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-400">
          Missing
        </Badge>
        {canAssign && (
          <Button
            size="sm"
            onClick={onAssign}
            data-testid={`assign-${label.toLowerCase()}-contact`}
          >
            <UserPlus className="h-3 w-3 mr-1" /> Assign
          </Button>
        )}
      </div>
    </div>
  );
}

export function NamedContactPanel({ matchId, match }: NamedContactPanelProps) {
  const [rows, setRows] = useState<MatchNamedContactRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchActiveNamedContacts(matchId)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const gap = requiresNamedContact(match, toActiveNamedContacts(rows));
  const buyerStatus = deriveSideStatus("buyer", match, rows);
  const sellerStatus = deriveSideStatus("seller", match, rows);

  // If no org attached on either side, nothing to show.
  if (buyerStatus.kind === "not_required" && sellerStatus.kind === "not_required") {
    return null;
  }

  return (
    <Card data-testid="named-contact-panel">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UsersRound className="h-4 w-4" />
          Named authorised contacts
        </CardTitle>
        <CardDescription>
          Each side with an attached organisation must have either a registered
          Izenzo user or a controlled named contact. This is informational in
          Phase 1 — progression is not blocked yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {gap !== null && (
          <Alert
            variant="default"
            className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
            data-testid="named-contact-missing-banner"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-sm">
              {gap === "both"
                ? "Both sides are missing a named authorised contact."
                : gap === "buyer"
                  ? "Buyer side is missing a named authorised contact."
                  : "Seller side is missing a named authorised contact."}{" "}
              Assignment UI will be available in the next phase. No emails or
              invites are sent when a controlled contact is added.
            </AlertDescription>
          </Alert>
        )}
        <SideRow label="Buyer" status={buyerStatus} />
        <SideRow label="Seller" status={sellerStatus} />
        {loading && (
          <p className="text-xs text-muted-foreground">Checking contacts…</p>
        )}
      </CardContent>
    </Card>
  );
}

export default NamedContactPanel;
