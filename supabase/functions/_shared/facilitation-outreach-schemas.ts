/**
 * Phase 2 — Zod schemas (server SSOT) for the future facilitation
 * outreach edge functions.
 *
 * Mirror of src/lib/facilitation-outreach-schemas.ts —
 * both files are pinned by scripts/check-facilitation-outreach-drift.mjs.
 *
 * No edge function is implemented yet. This file is schema vocabulary
 * only and does not export any handler.
 */

import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import {
  TEMPLATE_STATUSES,
  CANDIDATE_STATUSES,
  ESCALATION_STATUSES,
} from "./facilitation-outreach-constants.ts";

export const TemplateStatusUpdateSchema = z.object({
  template_id: z.string().uuid(),
  next_status: z.enum(TEMPLATE_STATUSES),
  reason: z.string().min(1).max(2000),
});
export type TemplateStatusUpdateInput = z.infer<typeof TemplateStatusUpdateSchema>;

export const CandidateAddSchema = z.object({
  facilitation_case_id: z.string().uuid(),
  counterparty_org_name: z.string().min(1).max(255),
  contact_email: z.string().email().max(320),
  contact_name: z.string().min(1).max(255).optional(),
  source_note: z.string().max(2000).optional(),
});
export type CandidateAddInput = z.infer<typeof CandidateAddSchema>;

export const SendRequestSchema = z.object({
  candidate_id: z.string().uuid(),
  template_id: z.string().uuid(),
  idempotency_key: z.string().min(8).max(128),
  acknowledged_warnings: z.array(z.string().min(1).max(128)).default([]),
});
export type SendRequestInput = z.infer<typeof SendRequestSchema>;

export const EscalationCreateSchema = z.object({
  facilitation_case_id: z.string().uuid(),
  reason: z.string().min(1).max(4000),
  candidate_id: z.string().uuid().optional(),
});
export type EscalationCreateInput = z.infer<typeof EscalationCreateSchema>;

export const EscalationTransitionSchema = z.object({
  escalation_id: z.string().uuid(),
  next_status: z.enum(ESCALATION_STATUSES),
  resolution_note: z.string().min(1).max(4000),
});
export type EscalationTransitionInput = z.infer<typeof EscalationTransitionSchema>;

export const CandidateStatusEnum = z.enum(CANDIDATE_STATUSES);

export const FACILITATION_OUTREACH_SCHEMA_NAMES = [
  "TemplateStatusUpdateSchema",
  "CandidateAddSchema",
  "SendRequestSchema",
  "EscalationCreateSchema",
  "EscalationTransitionSchema",
] as const;
