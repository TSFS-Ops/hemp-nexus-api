/**
 * ChallengeEvidenceList - Phase 3D
 *
 * Read-only list of evidence rows attached to a challenge. RLS governs
 * visibility (participants + platform admins). No download/delete in 3D.
 */
import { useChallengeEvidence, type ChallengeEvidenceRow } from "@/hooks/useChallengeEvidence";

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export interface ChallengeEvidenceListProps {
  challengeId: string;
}

export function ChallengeEvidenceList({ challengeId }: ChallengeEvidenceListProps) {
  const { data, isLoading, error } = useChallengeEvidence(challengeId);

  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="challenge-evidence-loading">
        Loading evidence…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="challenge-evidence-error">
        Could not load evidence.
      </p>
    );
  }

  const rows = (data ?? []) as ChallengeEvidenceRow[];
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="challenge-evidence-empty">
        No evidence attached yet.
      </p>
    );
  }

  return (
    <ul
      className="space-y-2"
      aria-label="Challenge evidence"
      data-testid="challenge-evidence-list"
    >
      {rows.map((e) => (
        <li
          key={e.id}
          className="rounded-md border border-border bg-card p-3 text-sm"
          data-testid="challenge-evidence-row"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-foreground truncate">{e.filename}</span>
            <span className="text-[11px] font-mono text-muted-foreground">{fmt(e.created_at)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{e.mime_type}</span>
            <span>{fmtBytes(e.size_bytes)}</span>
            <span
              className="font-mono truncate max-w-[14rem]"
              title={e.sha256}
              data-testid="challenge-evidence-sha"
            >
              sha256:{e.sha256.slice(0, 12)}…
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
