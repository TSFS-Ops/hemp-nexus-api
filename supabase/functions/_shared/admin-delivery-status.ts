/**
 * Shared mapping rules for the admin-engagement-delivery-status edge function.
 *
 * Extracted so the raw `email_send_log.status` → stable UI vocabulary mapping
 * can be unit-tested in isolation without booting the Deno.serve handler.
 *
 * NOTE: this module must remain pure — no I/O, no side effects.
 */

export type MappedStatus =
  | "queued"
  | "sent"
  | "failed"
  | "dlq"
  | "bounced"
  | "complained"
  | "suppressed"
  | "not_linked";

/** Map a raw `email_send_log.status` value to the stable admin vocabulary. */
export function mapStatus(raw: string | null | undefined): MappedStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "pending":
      return "queued";
    case "sent":
      return "sent";
    case "dlq":
      return "dlq";
    case "failed":
      return "failed";
    case "bounced":
      return "bounced";
    case "complained":
      return "complained";
    case "suppressed":
      return "suppressed";
    default:
      // Unknown raw status — treat as not_linked so callers don't render a
      // green/sent badge for an unrecognised value.
      return "not_linked";
  }
}
