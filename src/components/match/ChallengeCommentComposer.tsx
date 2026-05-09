/**
 * ChallengeCommentComposer — Phase 3D
 *
 * Posts a new comment to the existing `match-challenges/comment` edge route.
 * The composer is only mounted when `useChallengePermissions` reports
 * `canComment === true` (status active AND viewer is platform_admin or party
 * org_admin); ordinary org_members and unrelated viewers never see it.
 *
 * Body validation mirrors the DB CHECK constraint: 5–4000 trimmed chars.
 * Modal Dismissal Standard does not apply (this is inline, not a modal).
 * Zero Swallowed Errors: try/catch/finally with toast surface.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  COMMENT_MAX,
  COMMENT_MIN,
  usePostChallengeComment,
} from "@/hooks/useChallengeComments";

export interface ChallengeCommentComposerProps {
  challengeId: string;
  authorRole: "platform_admin" | "buyer_org_admin" | "seller_org_admin";
  authorOrgId?: string | null;
}

export function ChallengeCommentComposer({
  challengeId,
  authorRole,
  authorOrgId,
}: ChallengeCommentComposerProps) {
  const [body, setBody] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const post = usePostChallengeComment();

  const trimmed = body.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < COMMENT_MIN;
  const tooLong = trimmed.length > COMMENT_MAX;
  const submitDisabled =
    post.isPending || trimmed.length < COMMENT_MIN || tooLong;

  const handleSubmit = async () => {
    setValidationError(null);
    if (trimmed.length < COMMENT_MIN) {
      setValidationError(`Comment must be at least ${COMMENT_MIN} characters.`);
      return;
    }
    if (trimmed.length > COMMENT_MAX) {
      setValidationError(`Comment must be at most ${COMMENT_MAX} characters.`);
      return;
    }
    try {
      await post.mutateAsync({
        challenge_id: challengeId,
        author_role: authorRole,
        author_org_id: authorRole === "platform_admin" ? null : authorOrgId ?? null,
        body: trimmed,
      });
      toast.success("Comment posted.");
      setBody("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not post the comment.";
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-2" data-testid="challenge-comment-composer">
      <Label htmlFor="challenge-comment-input" className="text-xs uppercase tracking-wide text-muted-foreground">
        Add a comment
      </Label>
      <Textarea
        id="challenge-comment-input"
        data-testid="challenge-comment-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={COMMENT_MAX}
        placeholder={`Provide context, evidence, or a response (min ${COMMENT_MIN} characters).`}
        disabled={post.isPending}
      />
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-[11px] text-muted-foreground"
          data-testid="challenge-comment-counter"
        >
          {trimmed.length} / {COMMENT_MAX}
          {tooShort && <span className="text-destructive ml-2">Min {COMMENT_MIN}.</span>}
        </p>
        <LoadingButton
          type="button"
          size="sm"
          onClick={handleSubmit}
          loading={post.isPending}
          loadingText="Posting…"
          disabled={submitDisabled}
          data-testid="challenge-comment-submit"
        >
          Post comment
        </LoadingButton>
      </div>
      {validationError && (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="challenge-comment-validation-error"
        >
          {validationError}
        </p>
      )}
    </div>
  );
}
