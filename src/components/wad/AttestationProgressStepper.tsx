import { CheckCircle2, Clock, Lock, ShieldCheck, XCircle, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConsequenceState, WadRecord } from "@/lib/modules/consequence";

interface AttestationProgressStepperProps {
  wad: WadRecord;
  consequenceState: ConsequenceState;
  buyerName: string;
  sellerName: string;
  /** Org id of the currently viewing user, for "you" highlighting. */
  userOrgId: string | null;
  className?: string;
}

type SignatoryNodeState = "attested" | "pending" | "blocked";

interface SignatoryNode {
  key: "buyer" | "seller";
  label: string;
  party: string;
  state: SignatoryNodeState;
  attestedAt?: string;
  attestedName?: string;
  isYou: boolean;
}

interface NextAction {
  label: string;
  description: string;
  icon: LucideIcon;
  tone: "primary" | "success" | "muted" | "destructive";
}

function deriveNextAction(
  consequenceState: ConsequenceState,
  hasYou: boolean
): NextAction {
  const { uiStatus, canAttest, hasAttested, canSeal, canDownloadCertificate } =
    consequenceState;

  if (uiStatus === "sealed") {
    return canDownloadCertificate
      ? {
          label: "Download certificate",
          description: "Sealed — PDF certificate is available.",
          icon: ShieldCheck,
          tone: "success",
        }
      : {
          label: "Sealed",
          description: "All attestations recorded and the deal is sealed.",
          icon: Lock,
          tone: "success",
        };
  }

  if (uiStatus === "revoked") {
    return {
      label: "Revoked",
      description: "This Signed Deal has been revoked.",
      icon: XCircle,
      tone: "destructive",
    };
  }

  if (uiStatus === "superseded") {
    return {
      label: "Superseded",
      description: "A newer Signed Deal has replaced this one.",
      icon: XCircle,
      tone: "muted",
    };
  }

  if (canSeal) {
    return {
      label: "Seal Signed Deal",
      description: "Both signatories have attested — ready to seal.",
      icon: Lock,
      tone: "primary",
    };
  }

  if (canAttest) {
    return {
      label: "Attest now",
      description: "Your attestation is required to progress this deal.",
      icon: ShieldCheck,
      tone: "primary",
    };
  }

  if (hasAttested) {
    return {
      label: "Awaiting other party",
      description: "You've attested — waiting for the counterparty to attest.",
      icon: Clock,
      tone: "muted",
    };
  }

  if (hasYou) {
    return {
      label: "Awaiting attestations",
      description: "Both signatories must attest before this deal can be sealed.",
      icon: Clock,
      tone: "muted",
    };
  }

  return {
    label: "View only",
    description: "Only buyer and seller signatories can attest on this deal.",
    icon: Clock,
    tone: "muted",
  };
}

function nodeIcon(state: SignatoryNodeState): LucideIcon {
  if (state === "attested") return CheckCircle2;
  return Clock;
}

const TONE_CLASSES: Record<NextAction["tone"], string> = {
  primary: "bg-primary/10 text-primary border-primary/30",
  success: "bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400",
  muted: "bg-muted text-muted-foreground border-border",
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
};

export function AttestationProgressStepper({
  wad,
  consequenceState,
  buyerName,
  sellerName,
  userOrgId,
  className,
}: AttestationProgressStepperProps) {
  const buyerAttestation = wad.attestations?.find(
    (a) => a.role === "buyer_signatory"
  );
  const sellerAttestation = wad.attestations?.find(
    (a) => a.role === "seller_signatory"
  );

  const youAreBuyer = !!userOrgId && userOrgId === wad.buyer_org_id;
  const youAreSeller = !!userOrgId && userOrgId === wad.seller_org_id;
  const hasYou = youAreBuyer || youAreSeller;

  const isTerminal =
    consequenceState.uiStatus === "revoked" ||
    consequenceState.uiStatus === "superseded";

  const buyerState: SignatoryNodeState = buyerAttestation
    ? "attested"
    : isTerminal
    ? "blocked"
    : "pending";
  const sellerState: SignatoryNodeState = sellerAttestation
    ? "attested"
    : isTerminal
    ? "blocked"
    : "pending";

  const nodes: SignatoryNode[] = [
    {
      key: "buyer",
      label: "Buyer signatory",
      party: buyerName || "Buyer",
      state: buyerState,
      attestedAt: buyerAttestation?.attested_at,
      attestedName: buyerAttestation?.attested_name,
      isYou: youAreBuyer,
    },
    {
      key: "seller",
      label: "Seller signatory",
      party: sellerName || "Seller",
      state: sellerState,
      attestedAt: sellerAttestation?.attested_at,
      attestedName: sellerAttestation?.attested_name,
      isYou: youAreSeller,
    },
  ];

  const attestedCount = nodes.filter((n) => n.state === "attested").length;
  const total = nodes.length;
  const pct = Math.round((attestedCount / total) * 100);

  const nextAction = deriveNextAction(consequenceState, hasYou);
  const NextIcon = nextAction.icon;

  // Live announcement for assistive tech: short, status-aware sentence updated
  // whenever attestation count or next action changes. Rendered inside an
  // aria-live="polite" region so screen readers don't interrupt typing.
  const liveAnnouncement = `Attestation progress: ${attestedCount} of ${total} signatories attested. Next: ${nextAction.label}.`;

  const headingId = `attestation-progress-heading-${wad.id}`;
  const summaryId = `attestation-progress-summary-${wad.id}`;
  const nextActionId = `attestation-progress-next-${wad.id}`;

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={`${summaryId} ${nextActionId}`}
      className={cn(
        "rounded-lg border bg-card p-4 space-y-4",
        className
      )}
    >
      {/* Polite live region — announces progress changes without stealing focus. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3
            id={headingId}
            className="text-sm font-semibold flex items-center gap-2"
          >
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            Attestation progress
          </h3>
          <p id={summaryId} className="text-xs text-muted-foreground mt-0.5">
            {attestedCount} of {total} signatories attested
          </p>
        </div>
        <Badge
          variant="outline"
          className="font-mono text-xs"
          aria-hidden="true"
        >
          {pct}%
        </Badge>
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-label="Signatories attested"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${attestedCount} of ${total} signatories attested (${pct}%)`}
      >
        <div
          className={cn(
            "h-full transition-all",
            attestedCount === total ? "bg-green-500" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Signatory nodes */}
      <ol
        className="grid gap-3 sm:grid-cols-2"
        aria-label="Signatories"
      >
        {nodes.map((node) => {
          const Icon = nodeIcon(node.state);
          const stateLabel =
            node.state === "attested"
              ? "Attested"
              : isTerminal
              ? "Attestation closed"
              : "Awaiting attestation";
          // Compose an accessible name so screen readers hear the role,
          // party name, "you" hint, status, and (when attested) signatory + time
          // as one coherent sentence per node.
          const accessibleName = [
            node.label,
            node.party,
            node.isYou ? "(you)" : null,
            `— ${stateLabel}`,
            node.state === "attested" && node.attestedName
              ? `by ${node.attestedName}`
              : null,
            node.state === "attested" && node.attestedAt
              ? `on ${new Date(node.attestedAt).toLocaleString()}`
              : null,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li
              key={node.key}
              aria-label={accessibleName}
              aria-current={node.isYou ? "true" : undefined}
              className={cn(
                "rounded-md border p-3 flex items-start gap-3",
                node.state === "attested"
                  ? "border-green-500/40 bg-green-500/5"
                  : "border-border bg-background"
              )}
            >
              <div
                aria-hidden="true"
                className={cn(
                  "rounded-full p-1.5 shrink-0",
                  node.state === "attested"
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1" aria-hidden="true">
                {/* Visual content is mirrored in the li's aria-label above so
                    screen readers don't double-announce. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium truncate">{node.label}</p>
                  {node.isYou && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      You
                    </Badge>
                  )}
                  {node.state === "attested" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 border-green-500/40 text-green-700 dark:text-green-400"
                    >
                      Attested
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {node.party}
                </p>
                {node.state === "attested" ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {node.attestedName}
                    {node.attestedAt && (
                      <> · {new Date(node.attestedAt).toLocaleString()}</>
                    )}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {stateLabel}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Next action */}
      <div
        id={nextActionId}
        role="note"
        aria-label={`Next action: ${nextAction.label}. ${nextAction.description}`}
        className={cn(
          "rounded-md border px-3 py-2 flex items-start gap-3",
          TONE_CLASSES[nextAction.tone]
        )}
      >
        <NextIcon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1" aria-hidden="true">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
            Next
          </p>
          <p className="text-sm font-medium leading-tight">{nextAction.label}</p>
          <p className="text-xs opacity-90 mt-0.5">{nextAction.description}</p>
        </div>
      </div>
    </section>
  );
}
