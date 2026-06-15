/**
 * Phase 2 - Zod schemas for the future facilitation outreach edge
 * functions. Browser mirror.
 *
 * No edge function is implemented yet in this batch. These schemas
 * exist so that:
 *   1. the UI (future) can validate forms with the exact same shape
 *      the server will enforce;
 *   2. the drift guard can prove client/server schema parity.
 *
 * Mirror of supabase/functions/_shared/facilitation-outreach-schemas.ts -
 * both files are pinned by scripts/check-facilitation-outreach-drift.mjs.
 */

import { z } from "zod";
import {
  TEMPLATE_STATUSES,
  CANDIDATE_STATUSES,
  ESCALATION_STATUSES,
} from "./facilitation-outreach-constants";

/** Template status update: draft -> approved | approved -> archived. */
export const TemplateStatusUpdateSchema = z.object({
  template_id: z.string().uuid(),
  next_status: z.enum(TEMPLATE_STATUSES),
  reason: z.string().min(1).max(2000),
});
export type TemplateStatusUpdateInput = z.infer<typeof TemplateStatusUpdateSchema>;

/** Add a candidate to a facilitation case (manual entry). */
export const CandidateAddSchema = z.object({
  facilitation_case_id: z.string().uuid(),
  counterparty_org_name: z.string().min(1).max(255),
  contact_email: z.string().email().max(320),
  contact_name: z.string().min(1).max(255).optional(),
  source_note: z.string().max(2000).optional(),
});
export type CandidateAddInput = z.infer<typeof CandidateAddSchema>;

/** Manual single-send request. Server enforces template-approved + gate=allow. */
export const SendRequestSchema = z.object({
  candidate_id: z.string().uuid(),
  template_id: z.string().uuid(),
  /** Required idempotency token so retries do not double-send. */
  idempotency_key: z.string().min(8).max(128),
  /** Operator must explicitly acknowledge any warn-level gate result. */
  acknowledged_warnings: z.array(z.string().min(1).max(128)).default([]),
});
export type SendRequestInput = z.infer<typeof SendRequestSchema>;

/** Open a compliance escalation against a facilitation case. platform_admin only. */
export const EscalationCreateSchema = z.object({
  facilitation_case_id: z.string().uuid(),
  reason: z.string().min(1).max(4000),
  candidate_id: z.string().uuid().optional(),
});
export type EscalationCreateInput = z.infer<typeof EscalationCreateSchema>;

/** Resolve or reopen a compliance escalation. compliance_analyst only. */
export const EscalationTransitionSchema = z.object({
  escalation_id: z.string().uuid(),
  next_status: z.enum(ESCALATION_STATUSES),
  resolution_note: z.string().min(1).max(4000),
});
export type EscalationTransitionInput = z.infer<typeof EscalationTransitionSchema>;

/** Candidate status - exposed for UI list filters only; mutations go through dedicated endpoints. */
export const CandidateStatusEnum = z.enum(CANDIDATE_STATUSES);

export const FACILITATION_OUTREACH_SCHEMA_NAMES = [
  "TemplateStatusUpdateSchema",
  "CandidateAddSchema",
  "SendRequestSchema",
  "EscalationCreateSchema",
  "EscalationTransitionSchema",
] as const;
