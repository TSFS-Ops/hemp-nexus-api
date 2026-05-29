/**
 * Batch 4 — org-sso-test-connection pure validation.
 */
import { z } from "https://esm.sh/zod@3.23.8";

export const BodySchema = z.object({
  org_id: z.string().uuid().optional(),
});

export type SsoTestBody = z.infer<typeof BodySchema>;
