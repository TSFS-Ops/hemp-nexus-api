/**
 * useEngagementOutreachDraft
 * ──────────────────────────────────────────────────────────────────────
 * Admin-only hook that drives the AI Outreach Drafter Phase 1 surface.
 *
 * IMPORTANT: This hook does NOT send anything. There is no dispatch path
 * wired. Approved drafts must be sent manually by the admin outside the
 * platform; the existing manual outreach log remains the only place
 * actual contact is recorded.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DraftStatus = "pending_review" | "approved" | "rejected";

export interface OutreachDraft {
  id: string;
  engagement_id: string;
  org_id: string;
  status: DraftStatus;
  draft_subject: string;
  draft_body: string;
  context_summary: string | null;
  model: string | null;
  ai_confidence: "low" | "medium" | "high" | null;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  review_note: string | null;
  regenerated_from: string | null;
  created_at: string;
  updated_at: string;
}

export function useEngagementOutreachDraft(engagementId: string | null) {
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    if (!engagementId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("engagement_outreach_drafts" as any)
        .select("*")
        .eq("engagement_id", engagementId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setDrafts((data ?? []) as unknown as OutreachDraft[]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load drafts");
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { refresh(); }, [refresh]);

  const generate = useCallback(async (opts?: { regenerate_from?: string; tone_hint?: string }) => {
    if (!engagementId) return;
    setWorking(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-engagement-outreach-draft",
        { body: { engagement_id: engagementId, ...opts } },
      );
      if (error) throw error;
      await refresh();
      return data?.draft as OutreachDraft | undefined;
    } catch (e: any) {
      setError(e?.message ?? "Generation failed");
    } finally {
      setWorking(false);
    }
  }, [engagementId, refresh]);

  const decide = useCallback(async (
    draftId: string,
    action: "edit" | "approve" | "reject",
    extras?: { subject?: string; body?: string; review_note?: string },
  ) => {
    setWorking(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "engagement-outreach-draft-decision",
        { body: { draft_id: draftId, action, ...extras } },
      );
      if (error) throw error;
      await refresh();
      return data?.draft as OutreachDraft | undefined;
    } catch (e: any) {
      setError(e?.message ?? "Decision failed");
    } finally {
      setWorking(false);
    }
  }, [refresh]);

  return { drafts, loading, working, error, refresh, generate, decide };
}
