/**
 * P011 — Counterparty Rating Methodology Visibility.
 *
 * EvidenceRatingBadge renders the 5-band evidence-confidence label. This is
 * distinct from `CounterpartyRatingBadge` (deal-history reputation). Click
 * opens the reusable "Why this rating?" drawer.
 *
 * All colours come from semantic tokens. No forbidden wording — band labels
 * are pinned in `src/lib/evidence-rating.ts`.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Info, ShieldQuestion, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EVIDENCE_RATING_BAND_LABELS,
  type EvidenceRatingBand,
} from "@/lib/evidence-rating";
import { EvidenceRatingDrawer } from "./EvidenceRatingDrawer";

interface Props {
  organisationId: string | null | undefined;
  counterpartyId: string | null | undefined;
  /** Pass when the caller already has the band (avoids extra fetch); the drawer still fetches the full snapshot. */
  band?: EvidenceRatingBand | null;
  className?: string;
}

const TONE: Record<EvidenceRatingBand, { tone: string; icon: typeof ShieldQuestion }> = {
  limited_information: {
    tone: "bg-muted text-muted-foreground border-border",
    icon: ShieldQuestion,
  },
  public_source_supported: {
    tone: "bg-secondary text-secondary-foreground border-border",
    icon: Info,
  },
  admin_reviewed: {
    tone: "bg-accent text-accent-foreground border-border",
    icon: ShieldCheck,
  },
  verification_complete: {
    tone: "bg-primary/10 text-primary border-primary/30",
    icon: ShieldCheck,
  },
  flagged: {
    tone: "bg-destructive/10 text-destructive border-destructive/30",
    icon: ShieldAlert,
  },
};

export function EvidenceRatingBadge({
  organisationId,
  counterpartyId,
  band,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const effectiveBand: EvidenceRatingBand = band ?? "limited_information";
  const meta = TONE[effectiveBand];
  const Icon = meta.icon;

  if (!organisationId || !counterpartyId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("inline-flex", className)}
        aria-label={`Counterparty rating: ${EVIDENCE_RATING_BAND_LABELS[effectiveBand]}. Click for details.`}
      >
        <Badge variant="outline" className={cn("gap-1.5 cursor-pointer", meta.tone)}>
          <Icon className="h-3 w-3" aria-hidden />
          <span className="text-xs font-medium">
            {EVIDENCE_RATING_BAND_LABELS[effectiveBand]}
          </span>
        </Badge>
      </button>
      <EvidenceRatingDrawer
        open={open}
        onOpenChange={setOpen}
        organisationId={organisationId}
        counterpartyId={counterpartyId}
      />
    </>
  );
}
