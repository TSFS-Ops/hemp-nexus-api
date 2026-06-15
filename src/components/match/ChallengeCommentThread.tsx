/**
 * ChallengeCommentThread - Phase 3D
 *
 * Read-only chronological comment list for a challenge. Direct RLS read of
 * `match_challenge_comments`. Visibility is governed by the row-level
 * security policy, so unrelated viewers naturally see an empty list.
 */
import { useChallengeComments, type ChallengeCommentRow } from "@/hooks/useChallengeComments";

const ROLE_LABEL: Record<ChallengeCommentRow["author_role"], string> = {
  buyer_org_admin: "Buyer admin",
  seller_org_admin: "Seller admin",
  platform_admin: "Platform admin",
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export interface ChallengeCommentThreadProps {
  challengeId: string;
}

export function ChallengeCommentThread({ challengeId }: ChallengeCommentThreadProps) {
  const { data, isLoading, error } = useChallengeComments(challengeId);

  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="challenge-comments-loading">
        Loading comments…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="challenge-comments-error">
        Could not load comments.
      </p>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="challenge-comments-empty">
        No comments yet.
      </p>
    );
  }

  return (
    <ol
      className="space-y-3"
      aria-label="Challenge comments"
      data-testid="challenge-comments-list"
    >
      {rows.map((c) => (
        <li
          key={c.id}
          className="rounded-md border border-border bg-card p-3 text-sm"
          data-testid="challenge-comment-row"
        >
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-xs font-medium text-foreground">
              {ROLE_LABEL[c.author_role] ?? c.author_role}
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">{fmt(c.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed text-foreground">{c.body}</p>
        </li>
      ))}
    </ol>
  );
}
