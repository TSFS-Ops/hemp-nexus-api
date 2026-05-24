/**
 * useGovernanceEvents — fetches and merges events for a single Governance
 * Record (HQ-only). RLS on each underlying table restricts row visibility
 * to platform_admin / auditor in production, so the supabase client call
 * pattern matches AdminAuditLogs / AdminEventStorePanel.
 *
 * Phase 1: never mutates state, never calls payment / WaD / POI logic.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  GovernanceEvent,
  mergeAndSort,
  normaliseAdminAuditLog,
  normaliseAuditLog,
  normaliseEventStore,
  normaliseMatchEvent,
} from "./governance-record";

const PER_SOURCE_LIMIT = 500;

export interface GovernanceAnchor {
  matchId?: string | null;
  poiId?: string | null;
  engagementId?: string | null;
  pendingEngagementId?: string | null;
  tradeRequestId?: string | null;
}

export function useGovernanceEvents(anchor: GovernanceAnchor) {
  return useQuery({
    queryKey: ["governance-record-events", anchor],
    enabled: Boolean(
      anchor.matchId ||
        anchor.poiId ||
        anchor.engagementId ||
        anchor.pendingEngagementId ||
        anchor.tradeRequestId,
    ),
    queryFn: async (): Promise<GovernanceEvent[]> => {
      const events: GovernanceEvent[] = [];

      // --- match_events: only by match_id ---
      if (anchor.matchId) {
        const { data, error } = await supabase
          .from("match_events")
          .select("*")
          .eq("match_id", anchor.matchId)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE_LIMIT);
        if (error) throw error;
        for (const r of data ?? []) events.push(normaliseMatchEvent(r));
      }

      // --- audit_logs: by entity_id (match or POI), and by metadata->>match_id ---
      const auditIds = [anchor.matchId, anchor.poiId, anchor.engagementId, anchor.pendingEngagementId, anchor.tradeRequestId].filter(Boolean) as string[];
      if (auditIds.length > 0) {
        const { data: byEntity, error: e1 } = await supabase
          .from("audit_logs")
          .select("*")
          .in("entity_id", auditIds)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE_LIMIT);
        if (e1) throw e1;
        for (const r of byEntity ?? []) events.push(normaliseAuditLog(r));

        if (anchor.matchId) {
          const { data: byMeta, error: e2 } = await supabase
            .from("audit_logs")
            .select("*")
            .filter("metadata->>match_id", "eq", anchor.matchId)
            .order("created_at", { ascending: false })
            .limit(PER_SOURCE_LIMIT);
          if (e2) throw e2;
          for (const r of byMeta ?? []) events.push(normaliseAuditLog(r));
        }
      }

      // --- admin_audit_logs: by target_id ---
      if (auditIds.length > 0) {
        const { data, error } = await supabase
          .from("admin_audit_logs")
          .select("*")
          .in("target_id", auditIds)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE_LIMIT);
        if (error) throw error;
        for (const r of data ?? []) events.push(normaliseAdminAuditLog(r));
      }

      // --- event_store: by aggregate_id ---
      if (auditIds.length > 0) {
        const { data, error } = await supabase
          .from("event_store")
          .select("*")
          .in("aggregate_id", auditIds)
          .order("occurred_at", { ascending: false })
          .limit(PER_SOURCE_LIMIT);
        if (error) throw error;
        for (const r of data ?? []) events.push(normaliseEventStore(r));
      }

      return mergeAndSort(events);
    },
  });
}
