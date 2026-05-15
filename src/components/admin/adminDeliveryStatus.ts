/**
 * Pure helpers for the Admin Pending Engagements delivery-status enrichment.
 *
 * Extracted so the mapping rules (raw `email_send_log.status` → UI badge label
 * + style, dedupe-by-newest per engagement) can be unit-tested without
 * mounting the full admin panel. NO email behaviour lives here — this is a
 * read-only presentation derivation only.
 */

export type OutreachDelivery = {
  status: string;
  created_at: string;
  error_message: string | null;
  message_id: string | null;
};

export type EmailSendLogRow = {
  idempotency_key: string | null;
  status: string | null;
  created_at: string;
  error_message: string | null;
  message_id: string | null;
};

/** Tailwind classes per mapped status (kept lowercase + stable). */
export const DELIVERY_STYLES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  sent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  dlq: "bg-rose-100 text-rose-800 border-rose-300",
  bounced: "bg-rose-50 text-rose-700 border-rose-200",
  complained: "bg-rose-50 text-rose-700 border-rose-200",
  suppressed: "bg-amber-50 text-amber-800 border-amber-200",
};

/** Human label per mapped status. */
export const DELIVERY_LABELS: Record<string, string> = {
  pending: "Queued",
  sent: "Sent",
  failed: "Failed",
  dlq: "Dead-letter",
  bounced: "Bounced",
  complained: "Complained",
  suppressed: "Suppressed",
};

const OUTREACH_KEY_RE = /^outreach-send-([0-9a-fA-F-]{36})-/;

/**
 * Derive the latest delivery row per visible engagement_id from a list of
 * `email_send_log` rows. Assumes `rows` is ordered by `created_at` DESC
 * (which is how the panel queries it); first hit per engagement wins.
 *
 * - Rows whose idempotency_key does not match `outreach-send-<uuid>-…` are
 *   ignored.
 * - Rows for engagements not in `visibleIds` are ignored.
 *
 * Pure: no side effects, no network, no logging.
 */
export function deriveDeliveryMap(
  rows: ReadonlyArray<EmailSendLogRow>,
  visibleIds: ReadonlySet<string>,
): Record<string, OutreachDelivery> {
  const out: Record<string, OutreachDelivery> = {};
  for (const row of rows) {
    const key = row.idempotency_key;
    if (!key) continue;
    const m = key.match(OUTREACH_KEY_RE);
    if (!m) continue;
    const eid = m[1];
    if (!visibleIds.has(eid)) continue;
    if (out[eid]) continue;
    out[eid] = {
      status: String(row.status ?? ""),
      created_at: String(row.created_at),
      error_message: row.error_message ?? null,
      message_id: row.message_id ?? null,
    };
  }
  return out;
}

/** Resolve a label for a mapped status; falls back to the raw value. */
export function deliveryLabelFor(status: string): string {
  return DELIVERY_LABELS[status] ?? status;
}

/** Resolve a className for a mapped status; falls back to a neutral pill. */
export function deliveryStyleFor(status: string): string {
  return (
    DELIVERY_STYLES[status] ?? "bg-slate-50 text-slate-600 border-slate-200"
  );
}
