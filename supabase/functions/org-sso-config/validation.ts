/**
 * Batch 4 — org-sso-config pure validation.
 *
 * Extracted so Deno tests can exercise the schema without booting Deno.serve.
 * The PUT schema deliberately EXCLUDES `status='live'` and `status='failed'`.
 * Only `org-sso-test-connection` may promote (the DB trigger
 * `tg_org_sso_configs_guard_live_status` enforces this independently).
 */
import { z } from "https://esm.sh/zod@3.23.8";

export const PutSchema = z.object({
  org_id: z.string().uuid(),
  provider: z.enum(["saml"]).optional(),
  metadata_url: z.string().url().nullable().optional(),
  metadata_xml_ref: z.string().min(1).max(512).nullable().optional(),
  verified_domains: z.array(z.string().min(3).max(253)).max(64).optional(),
  entity_id: z.string().max(512).nullable().optional(),
  acs_url: z.string().url().nullable().optional(),
  supabase_sso_provider_id: z.string().max(255).nullable().optional(),
  certificate_status: z.enum(["none", "present", "expiring", "expired"]).optional(),
  status: z
    .enum([
      "not_configured",
      "pending_metadata",
      "configured_not_connected",
      "disabled",
    ])
    .optional(),
  failure_reason: z.string().max(2000).nullable().optional(),
});

export type SsoConfigPutBody = z.infer<typeof PutSchema>;
