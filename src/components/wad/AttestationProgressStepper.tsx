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
          description: "Sealed - PDF certificate is available.",
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
      description: "Both signatories have attested - ready to seal.",
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
      description: "You've attested - waiting for the counterparty to attest.",
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

  // Identify the next "actionable" step so we can mark it with aria-current="step"
  // for screen readers. Preference order: the viewer's own pending node, otherwise
  // the first pending node.
  const nextStepIndex = (() => {
    if (isTerminal) return -1;
    const ownPendingIdx = nodes.findIndex((n) => n.isYou && n.state === "pending");
    if (ownPendingIdx !== -1) return ownPendingIdx;
    return nodes.findIndex((n) => n.state === "pending");
  })();

  return (
    <section
      aria-labelledby="attestation-progress-heading"
      className={cn(
        "rounded-lg border bg-card p-4 space-y-4",
        className
      )}
    >
      {/* Header - single source of truth for the textual progress summary.
          The progress bar below carries the same value as a non-text
          announcement, so we keep it but hide its redundant aria-label. */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3
            id="attestation-progress-heading"
            className="text-sm font-semibold flex items-center gap-2"
          >
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-primary" />
            Attestation progress
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
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

      {/* Progress bar - aria-hidden because the heading paragraph above already
          announces "{attestedCount} of {total} signatories attested" verbatim.
          Re-announcing the same fact via role=progressbar produces a
          double-announcement on most screen readers. The bar remains visible
          for sighted users. */}
      <div
        className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
        aria-hidden="true"
      >
        <div
          className={cn(
            "h-full transition-all",
            attestedCount === total ? "bg-green-500" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Signatory nodes - explicit ordered list semantics. Each step gets a
          single consolidated aria-label so screen readers announce
          "Step 1 of 2: Buyer signatory (you), attested by Jane Doe at …"
          instead of reading every nested badge/paragraph separately. */}
      <ol
        role="list"
        aria-label="Signatory attestations"
        className="grid gap-3 sm:grid-cols-2"
      >
        {nodes.map((node, idx) => {
          const Icon = nodeIcon(node.state);
          const stepNumber = idx + 1;
          const stateText =
            node.state === "attested"
              ? `attested${
                  node.attestedName ? ` by ${node.attestedName}` : ""
                }${
                  node.attestedAt
                    ? ` at ${new Date(node.attestedAt).toLocaleString()}`
                    : ""
                }`
              : isTerminal
              ? "attestation closed"
              : "awaiting attestation";

          const ariaLabel = [
            `Step ${stepNumber} of ${total}`,
            node.label,
            node.isYou ? "(you)" : null,
            `for ${node.party}`,
            `- ${stateText}`,
          ]
            .filter(Boolean)
            .join(" ");

          const isCurrent = idx === nextStepIndex;

          return (
            <li
              key={node.key}
              aria-label={ariaLabel}
              aria-current={isCurrent ? "step" : undefined}
              tabIndex={0}
              className={cn(
                "rounded-md border p-3 flex items-start gap-3",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                node.state === "attested"
                  ? "border-green-500/40 bg-green-500/5"
                  : "border-border bg-background",
                isCurrent && node.state !== "attested" && "ring-1 ring-primary/40"
              )}
            >
              {/* Visual-only block. aria-hidden because the parent <li>
                  already provides the consolidated label. */}
              <div aria-hidden="true" className="contents">
                <div
                  className={cn(
                    "rounded-full p-1.5 shrink-0",
                    node.state === "attested"
                      ? "bg-green-500/15 text-green-600 dark:text-green-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
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
                      {isTerminal ? "Attestation closed" : "Awaiting attestation"}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Next action - distinct landmark so SRs read it separately from the
          step list. */}
      <div
        role="status"
        aria-live="polite"
        aria-label={`Next: ${nextAction.label}. ${nextAction.description}`}
        className={cn(
          "rounded-md border px-3 py-2 flex items-start gap-3",
          TONE_CLASSES[nextAction.tone]
        )}
      >
        <NextIcon aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
        <div aria-hidden="true" className="min-w-0 flex-1">
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
