/**
 * P-5 Batch 5 — Phase 3
 * Governed Memory writer (client-side helper).
 *
 * All write logic runs DB-side in `public.p5b5_write_memory_from_finality`
 * (SECURITY DEFINER, service_role only). This module only:
 *   - documents and re-exports the exclusion rules,
 *   - documents the forbidden-field set used by the DB stripper,
 *   - exposes a typed RPC caller for service-role contexts (edge fns / RPCs).
 *
 * It does NOT call the writer from the browser. Browser callers must go
 * through an edge function that holds the service role key.
 */
import type {
  P5B5FinalOutcomeCode,
  P5B5MemoryStatus,
} from "./outcomes";

/** Outcome codes that MUST never produce reusable memory. */
export const P5B5_MEMORY_EXCLUDED_OUTCOMES: ReadonlyArray<P5B5FinalOutcomeCode> = [
  "TEST_OR_INVALID",
] as const;

/** Source classes accepted by the writer (informational; enforced by RPC). */
export const P5B5_MEMORY_PERMITTED_SOURCES = [
  "final_finality_non_test",
  "locked_evidence_rating_snapshot",
  "counterparty_completion_history",
  "accepted_waivers_relied_on",
  "material_exceptions_relied_on",
  "dispute_resolution",
  "correction_or_supersession_approval",
  "provider_dependency_outcome_provider_state",
  "repeated_pattern_after_threshold",
] as const;

/** Source classes that MUST be excluded from reusable memory. */
export const P5B5_MEMORY_FORBIDDEN_SOURCES = [
  "draft_ai_suggestions",
  "draft_cases",
  "incomplete_pois",
  "abandoned_forms",
  "unsent_submissions",
  "rejected_documents_not_relied_on",
  "unresolved_disputes",
  "allegations_and_complaints",
  "private_notes",
  "support_notes",
  "internal_commentary_unformalised",
  "provider_test_results",
  "sandbox_data",
  "duplicated_notifications",
  "test_payments",
  "raw_bank_details",
  "credentials",
  "api_keys",
  "webhook_secrets",
  "tokens",
  "sensitive_pii_not_required",
  "unverified_third_party_data",
  "scraped_claims",
  "media_rumours",
  "expired_provider_errors_no_finality_impact",
] as const;

/**
 * Forbidden field keys stripped from snapshots before they are written to
 * `safe_facts`. Kept in sync with `p5b5_strip_forbidden_fields` in the DB.
 */
export const P5B5_FORBIDDEN_FIELDS: ReadonlyArray<string> = [
  // raw provider / bank
  "raw_payload",
  "raw_provider_payload",
  "provider_raw",
  "raw_bank_details",
  "bank_account_number",
  "account_number",
  "iban",
  "swift",
  "sort_code",
  "routing_number",
  "bic",
  // credentials / secrets / tokens
  "password",
  "password_hash",
  "credentials",
  "api_key",
  "api_secret",
  "secret_key",
  "secret",
  "private_key",
  "access_token",
  "refresh_token",
  "bearer_token",
  "token",
  "webhook_secret",
  "encryption_key",
  "pepper",
  "salt",
  "key_hash",
  "key_history",
  "secret_hash",
  // pii not required for business purpose
  "email",
  "email_address",
  "contact_email",
  "phone",
  "phone_number",
  "mobile",
  "contact_phone",
  "date_of_birth",
  "dob",
  "id_number",
  "passport_number",
  "social_security",
  "tax_number",
  "vat_number",
  // internal commentary / draft ai
  "private_notes",
  "internal_notes",
  "internal_commentary",
  "internal_reasoning",
  "support_notes",
  "ai_draft",
  "ai_suggestion",
  "draft_suggestion",
  "draft_ai",
  // unverified / scraped
  "scraped_claim",
  "media_rumour",
  "unverified_third_party",
  // duplicated / test / sandbox
  "duplicated_notification",
  "test_payment",
  "sandbox_payload",
] as const;

/** Repeated-pattern threshold (mirrors the DB detector). */
export const P5B5_REPEATED_PATTERN_RULE = {
  min_finality_backed_events: 2,
  min_compliance_approved_material_events: 1,
} as const;

/**
 * Defensive client-side stripper. Mirrors `p5b5_strip_forbidden_fields`.
 * Used by tests; production writes go through the DB writer.
 */
export function p5b5StripForbiddenFields<T = unknown>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((v) => p5b5StripForbiddenFields(v)) as unknown as T;
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if ((P5B5_FORBIDDEN_FIELDS as readonly string[]).includes(k)) continue;
      out[k] = p5b5StripForbiddenFields(v);
    }
    return out as unknown as T;
  }
  return input;
}

/** Result of a writer invocation. */
export interface P5B5MemoryWriteResult {
  memory_record_id: string | null;
  memory_status: P5B5MemoryStatus | "not_written";
  excluded_reason?: string;
}

/**
 * Typed RPC caller. MUST be invoked with a Supabase client that holds the
 * service role key (i.e. inside an edge function). Browser clients will
 * receive a permission error from the RPC layer.
 */
export async function callP5B5WriteMemoryFromFinality(
  client: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  },
  args: { finality_record_id: string; actor_id?: string | null; reason?: string },
): Promise<string | null> {
  const { data, error } = await client.rpc("p5b5_write_memory_from_finality", {
    p_finality_record_id: args.finality_record_id,
    p_actor_id: args.actor_id ?? null,
    p_reason: args.reason ?? "memory_writer_from_finality",
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
