/**
 * ChallengeEvidenceUploader — Phase 3D
 *
 * Uploads a file to the existing `match-challenges/upload-evidence` edge
 * route. The hook computes SHA-256 + base64 client-side; the server
 * re-validates and constructs the storage path.
 *
 * 25 MB client cap mirrors the DB CHECK + edge function limit.
 * Only mounted when `useChallengePermissions` reports `canUploadEvidence`.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  EVIDENCE_MAX_BYTES,
  useUploadChallengeEvidence,
} from "@/hooks/useChallengeEvidence";

export interface ChallengeEvidenceUploaderProps {
  challengeId: string;
}

export function ChallengeEvidenceUploader({ challengeId }: ChallengeEvidenceUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const upload = useUploadChallengeEvidence();

  const reset = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0] ?? null;
    if (next && next.size > EVIDENCE_MAX_BYTES) {
      toast.error("File exceeds the 25 MB limit.");
      reset();
      return;
    }
    setFile(next);
  };

  const handleUpload = async () => {
    if (!file) return;
    try {
      await upload.mutateAsync({ challenge_id: challengeId, file });
      toast.success("Evidence uploaded.");
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not upload the file.";
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-2" data-testid="challenge-evidence-uploader">
      <label
        htmlFor="challenge-evidence-input"
        className="block text-xs uppercase tracking-wide text-muted-foreground"
      >
        Attach evidence (max 25 MB)
      </label>
      <input
        ref={inputRef}
        id="challenge-evidence-input"
        data-testid="challenge-evidence-input"
        type="file"
        onChange={handleSelect}
        disabled={upload.isPending}
        className="block w-full text-xs file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:text-foreground hover:file:bg-muted/80"
      />
      <div className="flex items-center justify-end gap-2">
        {file && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={upload.isPending}
            data-testid="challenge-evidence-clear"
          >
            Clear
          </Button>
        )}
        <LoadingButton
          type="button"
          size="sm"
          onClick={handleUpload}
          loading={upload.isPending}
          loadingText="Uploading…"
          disabled={!file || upload.isPending}
          data-testid="challenge-evidence-upload-submit"
        >
          Upload
        </LoadingButton>
      </div>
    </div>
  );
}
