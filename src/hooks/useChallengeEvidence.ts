/**
 * useChallengeEvidence — Phase 3D
 *
 * Direct RLS read of `match_challenge_evidence` for a challenge, plus a
 * write mutation that base64-encodes a file client-side and posts to the
 * existing `match-challenges/upload-evidence` edge route. The server
 * constructs the storage path; the client never sends one.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { bytesToBase64, readFileAsBytes, sha256Hex } from "@/lib/sha256";

export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;

export interface ChallengeEvidenceRow {
  id: string;
  challenge_id: string;
  uploaded_by_user_id: string;
  uploaded_by_org_id: string | null;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

export function useChallengeEvidence(challengeId: string | null | undefined) {
  return useQuery({
    queryKey: ["challenge-evidence", challengeId],
    enabled: !!challengeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_challenge_evidence")
        .select(
          "id, challenge_id, uploaded_by_user_id, uploaded_by_org_id, storage_path, filename, mime_type, size_bytes, sha256, created_at",
        )
        .eq("challenge_id", challengeId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChallengeEvidenceRow[];
    },
    staleTime: 10_000,
  });
}

export interface UploadEvidenceInput {
  challenge_id: string;
  file: File;
}

export function useUploadChallengeEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ challenge_id, file }: UploadEvidenceInput) => {
      if (file.size === 0) throw new Error("File is empty.");
      if (file.size > EVIDENCE_MAX_BYTES) {
        throw new Error("File exceeds the 25 MB limit.");
      }
      const bytes = await readFileAsBytes(file);
      const sha256 = await sha256Hex(bytes);
      const content_base64 = bytesToBase64(bytes);
      return await fetchEdgeFunction("match-challenges/upload-evidence", {
        method: "POST",
        body: {
          challenge_id,
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          sha256,
          content_base64,
        },
        label: "upload challenge evidence",
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["challenge-evidence", vars.challenge_id] });
    },
  });
}
