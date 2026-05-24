/**
 * useGovernanceEvents — fetches and merges events for a single Governance
 * Record (HQ-only). RLS on each underlying table restricts row visibility
 * to platform_admin / auditor in production, so the supabase client call
 * pattern matches AdminAuditLogs / AdminEventStorePanel.
 *
 * Phase 1: never mutates state, never calls payment / WaD / POI logic.
 *
 * Returns { events, capsHit } so the UI can warn HQ when a source hit the
 * per-source display cap and some events may be hidden.
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

export const PER_SOURCE_LIMIT = 500;

export interface GovernanceAnchor {
  matchId?: string | null;
  poiId?: string | null;
  engagementId?: string | null;
  pendingEngagementId?: string | null;
  tradeRequestId?: string | null;
}

export interface GovernanceEventsResult {
  events: GovernanceEvent[];
  /** Source labels whose fetch returned exactly the PER_SOURCE_LIMIT cap. */
  capsHit: string[];
}

function markCap(rows: any[] | null | undefined, label: string, capsHit: string[]) {
  if (Array.isArray(rows) && rows.length === PER_SOURCE_LIMIT) capsHit.push(label);
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
    queryFn: async (): Promise<GovernanceEventsResult> => {
      const events: GovernanceEvent[] = [];
      const capsHit: string[] = [];

      // --- match_events: only by match_id ---
      if (anchor.matchId) {
        const { data, error } = await supabase
          .from("match_events")
          .select("*")
          .eq("match_id", anchor.matchId)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE_LIMIT);
        if (error) throw error;
        markCap(data, "match_events", capsHit);
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
        markCap(byEntity, "audit_logs", capsHit);
        for (const r of byEntity ?? []) events.push(normaliseAuditLog(r));

        if (anchor.matchId) {
          const { data: byMeta, error: e2 } = await supabase
            .from("audit_logs")
            .select("*")
            .filter("metadata->>match_id", "eq", anchor.matchId)
            .order("created_at", { ascending: false })
            .limit(PER_SOURCE_LIMIT);
          if (e2) throw e2;
          markCap(byMeta, "audit_logs (metadata)", capsHit);
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
        markCap(data, "admin_audit_logs", capsHit);
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
        markCap(data, "event_store", capsHit);
        for (const r of data ?? []) events.push(normaliseEventStore(r));

        // --- event_store: nested match_id references in payload.
        // Some flows write events whose aggregate is a POI / WaD / engagement
        // but whose payload carries match_id. Surface those too so the
        // Governance Record for the match isn't missing them.
        if (anchor.matchId) {
          const mid = anchor.matchId;
          try {
            const { data: nested, error: e3 } = await supabase
              .from("event_store")
              .select("*")
              .or(
                `payload->>match_id.eq.${mid},payload->>matchId.eq.${mid}`,
              )
              .order("occurred_at", { ascending: false })
              .limit(PER_SOURCE_LIMIT);
            if (!e3) {
              markCap(nested, "event_store (nested)", capsHit);
              for (const r of nested ?? []) events.push(normaliseEventStore(r));
            }
          } catch {
            // Nested JSON filter is opportunistic — never fail the whole fetch.
          }
        }
      }

      return { events: mergeAndSort(events), capsHit };
    },
  });
}
