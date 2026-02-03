import { supabase } from "@/integrations/supabase/client";

export type MatchDocumentListItem = {
  id: string;
  match_id: string;
  org_id: string;
  uploader_org_id: string | null;
  doc_type: string;
  filename: string;
  storage_path: string;
  sha256_hash: string;
  file_size: number | null;
  mime_type: string | null;
  status: string;
  created_at: string;
  expiry_date: string | null;
  title: string | null;
  notes: string | null;
  visibility: string;
  valid_from: string | null;
  valid_to: string | null;
};

type MatchDocumentsResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  data?: {
    match_id: string;
    documents: MatchDocumentListItem[];
  };
};

export async function listMatchDocuments(
  matchId: string,
  opts?: { order?: "asc" | "desc" }
): Promise<MatchDocumentListItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("Not signed in");
  }

  const order = opts?.order ?? "desc";
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match-documents/${matchId}?order=${order}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  );

  const payload = (await res.json().catch(() => null)) as MatchDocumentsResponse | null;

  if (!res.ok || !payload || payload.success !== true) {
    const msg = payload?.error || payload?.message || "Failed to load documents";
    throw new Error(msg);
  }

  return payload.data?.documents || [];
}
