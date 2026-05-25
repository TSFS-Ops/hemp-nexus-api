/**
 * Batch B — HQ Notes + Correction Events handler logic.
 *
 * Pure validation helpers separated from the HTTP serve handler so the
 * Deno test runner can exercise them without spinning up auth/db.
 *
 * Contract:
 *   - Append-only. The original event is NEVER read for mutation.
 *   - hq.note_added       — free-form HQ note. corrects_event_id optional.
 *   - hq.event_corrected  — correction event linked to a prior event_store row.
 *                            corrects_event_id REQUIRED.
 *   - Both event types are fail-closed (declared in CRITICAL_SPECIFIC_NAMES).
 */

import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// Allowed reason codes for Batch B. Subset of APPROVED_REASON_CODES.
export const HQ_NOTE_REASON_CODES = [
  "client_instruction",
  "incorrect_data_correction",
  "dispute_reviewed",
  "manual_verification_completed",
  "system_recovery",
  "other",
] as const;

export type HqNoteReasonCode = (typeof HQ_NOTE_REASON_CODES)[number];

export const MIN_NOTE_LENGTH = 8;
export const MAX_NOTE_LENGTH = 4000;

const Uuid = z.string().uuid();
const OptUuidOrNull = z.union([Uuid, z.null()]).optional();

export const HqNoteBodySchema = z
  .object({
    note_type: z.enum(["note", "correction"]),
    note: z
      .string()
      .trim()
      .min(MIN_NOTE_LENGTH, { message: "note must be at least 8 characters" })
      .max(MAX_NOTE_LENGTH),
    reason_code: z.enum(HQ_NOTE_REASON_CODES),
    corrects_event_id: OptUuidOrNull,
    // anchors — at least one must be present so the note attaches to a
    // Governance Record. org_id required for RLS / scoping.
    org_id: Uuid,
    match_id: OptUuidOrNull,
    poi_id: OptUuidOrNull,
    wad_id: OptUuidOrNull,
    engagement_id: OptUuidOrNull,
    payment_reference: z.union([z.string().min(1).max(200), z.null()]).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.note_type === "correction" && !v.corrects_event_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["corrects_event_id"],
        message: "corrects_event_id is required for correction events",
      });
    }
    // "other" must come with a specific note (longer than the bare minimum
    // so HQ cannot use "other" + "noted" as a free-pass).
    if (v.reason_code === "other" && v.note.trim().length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "reason_code 'other' requires a note of at least 16 characters",
      });
    }
    const hasAnchor = Boolean(
      v.match_id || v.poi_id || v.wad_id || v.engagement_id || v.payment_reference,
    );
    if (!hasAnchor && !v.corrects_event_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["match_id"],
        message:
          "at least one anchor (match_id, poi_id, wad_id, engagement_id, payment_reference) or corrects_event_id is required",
      });
    }
  });

export type HqNoteBody = z.infer<typeof HqNoteBodySchema>;

export interface ParsedHqNote {
  ok: true;
  body: HqNoteBody;
}

export interface ParsedHqNoteError {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export function parseHqNoteBody(raw: unknown): ParsedHqNote | ParsedHqNoteError {
  const r = HqNoteBodySchema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_BODY",
      message: "Invalid HQ note payload",
      details: r.error.flatten(),
    };
  }
  return { ok: true, body: r.data };
}

/**
 * Build the canonical writer input. Caller still needs to supply
 * actor_user_id and aggregate. `aggregate_id` is the primary anchor
 * (match_id preferred, then poi_id / wad_id / engagement_id /
 * payment_reference / corrects_event_id).
 */
export function deriveAggregate(body: HqNoteBody): {
  aggregate_type: string;
  aggregate_id: string;
} {
  if (body.match_id) return { aggregate_type: "match", aggregate_id: body.match_id };
  if (body.poi_id) return { aggregate_type: "poi", aggregate_id: body.poi_id };
  if (body.wad_id) return { aggregate_type: "wad", aggregate_id: body.wad_id };
  if (body.engagement_id)
    return { aggregate_type: "engagement", aggregate_id: body.engagement_id };
  if (body.payment_reference)
    return { aggregate_type: "payment", aggregate_id: body.payment_reference };
  // Correction with no other anchor — aggregate is the corrected event itself.
  return { aggregate_type: "event", aggregate_id: body.corrects_event_id! };
}
