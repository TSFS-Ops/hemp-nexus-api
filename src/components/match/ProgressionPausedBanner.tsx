/**
 * ProgressionPausedBanner — Phase 3B
 *
 * Neutral, institutional banner shown above progression CTA clusters when
 * the match has an active (`open` / `under_review`) challenge.
 *
 * This banner is a **UX hint only**. The server (Phase 3A canonical
 * `409 CHALLENGE_OPEN` gate) is the authoritative blocker — UI never gates.
 */
import { Pause } from "lucide-react";
import type { ChallengeRow } from "@/hooks/useMatchChallenge";

export interface ProgressionPausedBannerProps {
  challenge: ChallengeRow | null | undefined;
}

export function ProgressionPausedBanner({ challenge }: ProgressionPausedBannerProps) {
  if (!challenge) return null;
  if (challenge.status !== "open" && challenge.status !== "under_review") return null;

  return (
    <div
      role="status"
      data-testid="progression-paused-banner"
      className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
    >
      <Pause className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="font-medium leading-snug">
          Progression is paused while a challenge is open on this match.
        </p>
        <p className="text-xs text-muted-foreground">
          Existing actions remain visible for transparency. Once the challenge is
          resolved, progression resumes automatically.
        </p>
      </div>
    </div>
  );
}
