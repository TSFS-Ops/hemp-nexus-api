/**
 * Shared helper to emit a revenue notification email AND record an
 * append-only audit row for support traceability.
 *
 * Wraps the `send-transactional-email` invoke with try/catch and inserts a
 * row into `public.revenue_notification_audit` capturing whether the dispatch
 * succeeded, was skipped, or failed (with error message).
 *
 * Best-effort: never throws — callers should fire-and-forget without blocking
 * the primary commercial transaction.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export type RevenueEventType = "poi_minted" | "credits_purchased" | "wad_sealed";

export interface RevenueNotifyArgs {
  eventType: RevenueEventType;
  idempotencyKey: string;
  referenceId?: string | null;
  recipientEmail?: string;
  orgId?: string | null;
  orgName?: string | null;
  contactEmail?: string | null;
  headline?: string;
  details?: Record<string, string | number | undefined | null>;
  consoleUrl?: string;
  consoleLabel?: string;
  occurredAt?: string;
}

const DEFAULT_RECIPIENT = "support@izenzo.co.za";

export async function emitRevenueNotification(
  supabase: SupabaseClient,
  args: RevenueNotifyArgs,
): Promise<void> {
  const recipient = args.recipientEmail || DEFAULT_RECIPIENT;
  const occurredAt = args.occurredAt || new Date().toISOString();

  // POI-004 stage-2: idempotency short-circuit. If we already have an audit
  // row for this idempotency_key, do NOT re-dispatch the email — the prior
  // call already attempted (and either sent or failed). Re-dispatch would
  // cause duplicate revenue notices for the same logical event.
  try {
    const { data: prior } = await supabase
      .from("revenue_notification_audit")
      .select("id, status")
      .eq("idempotency_key", args.idempotencyKey)
      .limit(1)
      .maybeSingle();
    if (prior) {
      console.log(
        `[revenue-notify] idempotent replay — skipping ${args.eventType} dispatch (prior status=${prior.status})`,
      );
      return;
    }
  } catch (lookupErr) {
    // Non-fatal: if the lookup fails we fall through and let the unique
    // index on idempotency_key catch any duplicate insert below.
    console.error("[revenue-notify] idempotency lookup failed", lookupErr);
  }

  let status: "sent" | "failed" | "skipped" = "sent";
  let errorMessage: string | null = null;

  try {
    const { error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "revenue-event-notify",
        recipientEmail: recipient,
        idempotencyKey: args.idempotencyKey,
        templateData: {
          eventType: args.eventType,
          headline: args.headline,
          orgName: args.orgName ?? undefined,
          orgId: args.orgId ?? undefined,
          contactEmail: args.contactEmail ?? undefined,
          details: args.details ?? {},
          consoleUrl: args.consoleUrl,
          consoleLabel: args.consoleLabel,
          occurredAt,
          referenceId: args.referenceId ?? undefined,
        },
      },
    });

    if (error) {
      status = "failed";
      errorMessage = error.message || String(error);
    }
  } catch (e) {
    status = "failed";
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  // Append audit row (best-effort — never throws).
  try {
    await supabase.from("revenue_notification_audit").insert({
      event_type: args.eventType,
      reference_id: args.referenceId ?? null,
      idempotency_key: args.idempotencyKey,
      recipient_email: recipient,
      org_id: args.orgId ?? null,
      org_name: args.orgName ?? null,
      status,
      error_message: errorMessage,
      details: {
        headline: args.headline ?? null,
        consoleUrl: args.consoleUrl ?? null,
        contactEmail: args.contactEmail ?? null,
        payload: args.details ?? {},
      },
    });
  } catch (auditErr) {
    console.error("[revenue-notify] audit insert failed", auditErr);
  }

  if (status === "failed") {
    console.error(`[revenue-notify] ${args.eventType} dispatch failed:`, errorMessage);
  }
}
