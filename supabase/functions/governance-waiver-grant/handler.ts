/**
 * Batch D — HQ governance waiver/bypass grant + renew handler logic.
 *
 * Pure validation extracted so Deno tests can exercise without auth/db.
 *
 * Contract:
 *   - mode = "grant"  → grant a new waiver/bypass against an anchor.
 *   - mode = "renew"  → renew an existing waiver by waiver_id; copies anchors
 *                       and creates a new row with renewed_from set.
 *   - Both require platform_admin + AAL2 (enforced in index.ts).
 *   - reason_code is required; if reason_code === "other" then note required
 *     and must be >= 16 chars.
 */

import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/** Allowed reason codes for Batch D waiver grants. Subset of APPROVED_REASON_CODES. */
export const WAIVER_REASON_CODES = [
  "client_instruction",
  "incorrect_data_correction",
  "manual_verification_completed",
  "dispute_reviewed",
  "system_recovery",
  "waiver_renewed",
  "other",
] as const;
export type WaiverReasonCode = (typeof WAIVER_REASON_CODES)[number];

export const MIN_NOTE_LENGTH = 8;
export const MAX_NOTE_LENGTH = 4000;
export const OTHER_NOTE_MIN_LENGTH = 16;

const Uuid = z.string().uuid();
const OptUuid = z.union([Uuid, z.null()]).optional();

const BaseGrant = z.object({
  mode: z.literal("grant"),
  posture: z.enum(["waiver", "bypass"]),
  scope: z.string().min(1).max(64),
  scope_id: OptUuid,
  org_id: Uuid,
  match_id: OptUuid,
  poi_id: OptUuid,
  wad_id: OptUuid,
  reason_code: z.enum(WAIVER_REASON_CODES),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional().nullable(),
  /** Optional override; helper clamps to <= 7 days from now. */
  expires_at: z.string().datetime().optional().nullable(),
  max_uses: z.number().int().min(1).max(10).optional(),
}).strict();

const BaseRenew = z.object({
  mode: z.literal("renew"),
  prior_waiver_id: Uuid,
  reason_code: z.enum(WAIVER_REASON_CODES),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
  max_uses: z.number().int().min(1).max(10).optional(),
}).strict();

export const WaiverBodySchema = z
  .discriminatedUnion("mode", [BaseGrant, BaseRenew])
  .superRefine((v, ctx) => {
    if (v.reason_code === "other") {
      const n = (v.note ?? "").trim();
      if (n.length < OTHER_NOTE_MIN_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["note"],
          message: `reason_code 'other' requires a note of at least ${OTHER_NOTE_MIN_LENGTH} characters`,
        });
      }
    }
    if (v.mode === "grant") {
      const hasAnchor = Boolean(v.match_id || v.poi_id || v.wad_id || v.scope_id);
      if (!hasAnchor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["match_id"],
          message:
            "at least one anchor (match_id, poi_id, wad_id, or scope_id) is required for grant",
        });
      }
    }
  });

export type WaiverBody = z.infer<typeof WaiverBodySchema>;

export interface ParsedOk {
  ok: true;
  body: WaiverBody;
}
export interface ParsedErr {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export function parseWaiverBody(raw: unknown): ParsedOk | ParsedErr {
  const r = WaiverBodySchema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_BODY",
      message: "Invalid waiver payload",
      details: r.error.flatten(),
    };
  }
  return { ok: true, body: r.data };
}
