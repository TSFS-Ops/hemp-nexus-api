/**
 * MT-009 Phase 1 — Read model for controlled named contact records.
 *
 * Phase 1 is detection-only:
 *   - Read active named contacts for a match.
 *   - Feed them into the pure `requiresNamedContact` predicate.
 *
 * This module MUST NOT:
 *   - send emails, invites, or notifications;
 *   - mutate `match_named_contacts` (assignment UI is Phase 2);
 *   - mutate `matches`;
 *   - touch POI / WaD / payment / credit / notification modules.
 */

import { supabase } from "@/integrations/supabase/client";
import type { ActiveNamedContact } from "@/lib/match-lifecycle";

export type NamedContactSide = "buyer" | "seller";

export type MatchNamedContactRow = {
  id: string;
  match_id: string;
  side: NamedContactSide;
  org_id: string;
  contact_name: string;
  contact_email: string;
  assigned_by_role: "org_admin_self_service" | "platform_admin_override";
  assigned_at: string;
  status: "active" | "replaced" | "revoked";
};

/**
 * Fetch ACTIVE named contacts for a match. Returns [] on error or no rows.
 * RLS restricts visibility to org members and platform admins.
 */
export async function fetchActiveNamedContacts(
  matchId: string,
): Promise<MatchNamedContactRow[]> {
  if (!matchId) return [];
  const { data, error } = await supabase
    .from("match_named_contacts")
    .select(
      "id, match_id, side, org_id, contact_name, contact_email, assigned_by_role, assigned_at, status",
    )
    .eq("match_id", matchId)
    .eq("status", "active");

  if (error) {
    // Detection-only: never throw upward; banner just won't show controlled-contact satisfaction.
    console.warn("[match-named-contacts] read failed:", error.message);
    return [];
  }
  // Defensive side filter — DB CHECK guarantees this but cheap to verify.
  return (data ?? []).filter(
    (r): r is MatchNamedContactRow =>
      r.side === "buyer" || r.side === "seller",
  );
}

/** Strip a row list to the minimum the predicate needs. */
export function toActiveNamedContacts(
  rows: ReadonlyArray<MatchNamedContactRow>,
): ActiveNamedContact[] {
  return rows.map((r) => ({ side: r.side, status: r.status }));
}

/**
 * MT-009 Phase 2: assign or replace a controlled named contact via the
 * `match-named-contacts-assign` edge function. Caller authorisation is
 * enforced server-side (org-admin own-org OR platform-admin with AAL2).
 *
 * NEVER sends email/invite/notification — the edge function and RPC are
 * source-guarded against any such import.
 */
export type AssignNamedContactInput = {
  matchId: string;
  side: NamedContactSide;
  contactName: string;
  contactEmail: string;
  notes?: string;
};

export type AssignNamedContactResult = {
  contact_id: string;
  replaced_prior_id: string | null;
  side: NamedContactSide;
};

export class AssignNamedContactError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AssignNamedContactError";
  }
}

export async function assignNamedContact(
  input: AssignNamedContactInput,
): Promise<AssignNamedContactResult> {
  const idempotencyKey =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.functions.invoke(
    "match-named-contacts-assign",
    {
      body: {
        match_id: input.matchId,
        side: input.side,
        contact_name: input.contactName.trim(),
        contact_email: input.contactEmail.trim().toLowerCase(),
        ...(input.notes && input.notes.trim().length > 0
          ? { notes: input.notes.trim() }
          : {}),
      },
      headers: { "Idempotency-Key": idempotencyKey },
    },
  );
  if (error) {
    const ctx = (error as { context?: { error?: string; message?: string } }).context;
    const code = ctx?.error ?? "ASSIGN_FAILED";
    throw new AssignNamedContactError(code, ctx?.message ?? error.message);
  }
  if (!data?.ok) {
    throw new AssignNamedContactError(
      data?.error ?? "ASSIGN_FAILED",
      data?.message ?? "Failed to save named contact.",
    );
  }
  return data.result as AssignNamedContactResult;
}
