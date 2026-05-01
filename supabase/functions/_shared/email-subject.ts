/**
 * Email subject sanitiser — single source of truth for the platform contract
 * that no outbound email subject may exceed 200 characters.
 *
 * Why this exists:
 *   Several edge functions concatenate user-supplied free-text fields
 *   (commodity name, organisation name, inviter display name, intent
 *   description) into a fixed subject template. When the free-text field is
 *   long, the resulting subject blows past Mailgun/Resend/Slack practical
 *   limits and our own 200-char Zod validators (e.g. poi-engagements
 *   send-outreach), causing visible VALIDATION_ERROR toasts for admins and
 *   silent truncation by mail providers.
 *
 * Contract:
 *   - Hard ceiling: 200 characters.
 *   - Whitespace collapsed (no \r\n smuggling, no double spaces).
 *   - If a `tail` is provided (e.g. " [a1b2c3d4]" trace marker), the tail is
 *     ALWAYS preserved and the variable middle is truncated with an ellipsis.
 *   - If no tail, the whole subject is truncated and ends with an ellipsis.
 *
 * This helper is intentionally pure and dependency-free so it can be imported
 * from any edge function without pulling in Deno-specific runtime APIs.
 */

export const SUBJECT_MAX = 200;

export function clampSubject(subject: string, tail = ""): string {
  const cleaned = String(subject ?? "").replace(/\s+/g, " ").trim();
  const cleanTail = String(tail ?? "").replace(/\s+/g, " ");
  if (cleaned.length === 0 && cleanTail.length === 0) return "";
  if (cleaned.length + cleanTail.length <= SUBJECT_MAX) {
    return cleanTail ? `${cleaned}${cleanTail}` : cleaned;
  }
  if (cleanTail.length >= SUBJECT_MAX - 1) {
    // Pathological: tail alone is too long. Truncate the tail as a last resort.
    return cleanTail.slice(0, SUBJECT_MAX - 1) + "…";
  }
  const budget = SUBJECT_MAX - cleanTail.length - 1; // -1 for ellipsis
  const head = cleaned.slice(0, Math.max(1, budget)).trimEnd();
  return `${head}…${cleanTail}`;
}
