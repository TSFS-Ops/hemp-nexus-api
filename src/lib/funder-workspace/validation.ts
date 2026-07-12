/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Zod schemas for admin-console form validation. Client-side only;
 * DB CHECK constraints + fw_admin_* RPCs are the authoritative enforcer.
 */
import { z } from "zod";
import { CONSENT_STATUSES, FUNDER_TYPES } from "./types";
import { requiresAdminOverride } from "./permissions";

const nonEmpty = (label: string, max = 255) =>
  z.string().trim().min(1, { message: `${label} is required` }).max(max);

export const approveOnboardingSchema = z.object({
  request_id: z.string().uuid(),
  notes_internal: z.string().trim().max(2000).optional().nullable(),
});

export const rejectOnboardingSchema = z.object({
  request_id: z.string().uuid(),
  reason: nonEmpty("Rejection reason", 1000),
});

export const revokeReleaseSchema = z.object({
  release_id: z.string().uuid(),
  reason: nonEmpty("Revocation reason", 1000),
});

export const releaseFormSchema = z
  .object({
    funder_organisation_id: z
      .string()
      .uuid({ message: "Funder organisation is required" }),
    match_id: z.string().uuid({ message: "Canonical deal selection is required" }),
    deal_reference: z.string().trim().max(128).optional().default(""),
    evidence_pack_id: z.string().uuid({ message: "Evidence pack selection is required" }),
    evidence_pack_version: z
      .string()
      .trim()
      .min(1, { message: "Evidence pack selection is required" })
      .max(64),
    release_reason: nonEmpty("Release reason", 1000),
    expires_at: z
      .string()
      .min(1, { message: "Expiry date is required" })
      .refine((v) => {
        const t = Date.parse(v);
        return Number.isFinite(t) && t > Date.now();
      }, { message: "Expiry date must be in the future" }),
    buyer_consent_status: z.enum(CONSENT_STATUSES),
    seller_consent_status: z.enum(CONSENT_STATUSES),
    admin_override_reason: z.string().trim().max(1000).optional().nullable(),
    can_view_evidence_summary: z.boolean(),
    can_view_evidence_room: z.boolean(),
    can_download_compiled_pack: z.boolean(),
    can_view_raw_documents: z.boolean(),
    can_download_raw_documents: z.boolean(),
    can_view_unmasked_sensitive_details: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (requiresAdminOverride(v.buyer_consent_status, v.seller_consent_status)) {
      const trimmed = (v.admin_override_reason ?? "").trim();
      if (trimmed === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["admin_override_reason"],
          message:
            "Admin override reason is required when buyer or seller consent is not granted or not_required.",
        });
      }
    }
  });

export const linkReleaseToMatchSchema = z.object({
  release_id: z.string().uuid(),
  match_id: z.string().uuid({ message: "Canonical deal selection is required" }),
  reason: nonEmpty("Linkage reason", 1000),
});

export type ReleaseFormValues = z.infer<typeof releaseFormSchema>;


export const funderTypeSchema = z.enum(FUNDER_TYPES);
