/**
 * Admin SLA target management.
 *
 * Per-team + per-priority first-response / resolution deadlines used by
 * the ticket-creation trigger and the SLA escalation cron.
 * `team_key = null` rows are the platform-wide defaults.
 */
import { supabase } from "@/integrations/supabase/client";
import type { SupportPriority } from "@/lib/support/client";

const from = supabase.from.bind(supabase) as unknown as (t: string) => any;

export interface SupportSlaTargetRow {
  id: string;
  team_key: string | null;
  priority: SupportPriority;
  first_response_minutes: number;
  resolution_minutes: number;
  business_hours_only: boolean;
  updated_at: string;
}

export const SLA_PRIORITIES: SupportPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

export async function adminListSlaTargets(): Promise<SupportSlaTargetRow[]> {
  const r = await from("support_sla_targets")
    .select(
      "id,team_key,priority,first_response_minutes,resolution_minutes,business_hours_only,updated_at"
    )
    .order("team_key", { ascending: true, nullsFirst: true })
    .order("priority");
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}

export async function adminUpsertSlaTarget(input: {
  team_key: string | null;
  priority: SupportPriority;
  first_response_minutes: number;
  resolution_minutes: number;
  business_hours_only: boolean;
}): Promise<void> {
  if (input.first_response_minutes <= 0 || input.resolution_minutes <= 0) {
    throw new Error("SLA minutes must be positive.");
  }
  if (input.first_response_minutes > input.resolution_minutes) {
    throw new Error(
      "First-response deadline cannot be longer than the resolution deadline."
    );
  }
  // Manual upsert — Postgres ON CONFLICT doesn't support the
  // COALESCE(team_key,'') expression index directly.
  const existing = await from("support_sla_targets")
    .select("id")
    .eq("priority", input.priority)
    .is(input.team_key === null ? "team_key" : "team_key_never", null)
    .eq("team_key", input.team_key ?? "___none___");

  // Fallback path — explicit filter that handles both null + value:
  let idToUpdate: string | null = null;
  const q = from("support_sla_targets")
    .select("id")
    .eq("priority", input.priority);
  const scoped =
    input.team_key === null ? q.is("team_key", null) : q.eq("team_key", input.team_key);
  const found = await scoped.limit(1);
  if (found.error) throw new Error(found.error.message);
  if (found.data && found.data.length) idToUpdate = found.data[0].id;
  // Silence unused-var lint on the discarded first probe.
  void existing;

  if (idToUpdate) {
    const upd = await from("support_sla_targets")
      .update({
        first_response_minutes: input.first_response_minutes,
        resolution_minutes: input.resolution_minutes,
        business_hours_only: input.business_hours_only,
        updated_at: new Date().toISOString(),
      })
      .eq("id", idToUpdate);
    if (upd.error) throw new Error(upd.error.message);
    return;
  }
  const ins = await from("support_sla_targets").insert({
    team_key: input.team_key,
    priority: input.priority,
    first_response_minutes: input.first_response_minutes,
    resolution_minutes: input.resolution_minutes,
    business_hours_only: input.business_hours_only,
  });
  if (ins.error) throw new Error(ins.error.message);
}

export async function adminDeleteSlaTarget(id: string): Promise<void> {
  const r = await from("support_sla_targets").delete().eq("id", id);
  if (r.error) throw new Error(r.error.message);
}
