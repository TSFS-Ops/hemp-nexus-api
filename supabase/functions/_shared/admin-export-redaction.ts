/**
 * Admin Export Controls — Batch 8 (Redaction Contract).
 *
 * Pure, deterministic redaction helper for Governance Record-shaped
 * payloads. NON-GENERATING: this module produces in-memory redacted
 * objects + a redaction manifest only. It does NOT, and MUST NOT:
 *
 *   - generate files (CSV / JSON file / PDF)
 *   - write to storage
 *   - create signed URLs / download URLs / download tokens
 *   - call admin-governance-export-prepare / -download / -destroy
 *   - mutate export_requests / governance records / legal_holds
 *   - call any RPC, edge function, or external API
 *
 * The Batch 7C production refusal guard and the Batch 2-6 surfaces
 * are NOT touched by this helper. DATA-004 (cron / retention /
 * cold-storage) is NOT touched by this helper.
 *
 * The contract intentionally duplicates none of the file-output
 * surface of `_shared/export-redaction.ts` (DATA-005 / 010). That
 * module ships CSV projection helpers for user-self-export. This
 * module defines per-mode field policy for admin Governance Record
 * redaction WITHOUT generating any output artifact.
 */

export type RedactionMode =
  | "redacted_client_safe"
  | "evidence_only"
  | "metadata_only"
  | "full_internal";

export const REDACTION_MODES: readonly RedactionMode[] = Object.freeze([
  "redacted_client_safe",
  "evidence_only",
  "metadata_only",
  "full_internal",
]);

export const DEFAULT_REDACTION_MODE: RedactionMode = "redacted_client_safe";

/**
 * Field-name substrings that are ALWAYS removed regardless of mode.
 * Match is case-insensitive substring on the field name (not the
 * value). Any nested object or array property whose name contains one
 * of these substrings is dropped from the redacted output and recorded
 * in the manifest's `forbidden_fields_blocked` list.
 */
export const ALWAYS_FORBIDDEN_FIELD_SUBSTRINGS: readonly string[] = Object.freeze([
  // secrets / auth material
  "password",
  "password_hash",
  "encrypted_password",
  "password_salt",
  "api_key",
  "auth_token",
  "session_token",
  "refresh_token",
  "reset_token",
  "verification_token",
  "webhook_secret",
  "signing_secret",
  "bearer",
  "totp",
  "mfa_secret",
  // payment instruments
  "card_number",
  "card_cvv",
  "card_cvc",
  "card_expiry",
  "pan",
  // file / download / storage surface (must NEVER leave this helper)
  "signed_url",
  "download_url",
  "download_token",
  "storage_path",
  "storage_object",
  "file_path",
  "file_url",
  "object_key",
  "bucket",
  // raw compliance / third-party payloads
  "sanctions_raw",
  "pep_raw",
  "adverse_media_raw",
  "raw_api_response",
  "third_party_confidential",
  "auto_sources_raw",
  // internal notes / privileged
  "internal_notes",
  "admin_notes",
  "privileged_legal_notes",
  "internal_investigation_notes",
  // raw legal-hold context (only safe summary survives — see below)
  "legal_hold_reason",
  "legal_hold_notes",
  "released_reason",
  "released_by",
  "applied_by_user",
]);

/**
 * Field-name substrings that are MASKED (value replaced with a
 * deterministic mask token) rather than removed, in every mode except
 * `full_internal`. `full_internal` may retain the underlying value for
 * platform_admin internal review but still records the field in the
 * manifest's `masked_fields` audit trail.
 */
export const PII_MASK_FIELD_SUBSTRINGS: readonly string[] = Object.freeze([
  "email",
  "phone",
  "phone_number",
  "msisdn",
  "physical_address",
  "postal_address",
  "street_address",
  "address_line",
  "national_id",
  "passport",
  "tax_id",
  "id_number",
  "date_of_birth",
  "dob",
]);

/** Deterministic mask token used for redacted PII values. */
export const MASK_TOKEN = "[REDACTED]";

/**
 * Per-mode allow-list of TOP-LEVEL fields that may appear in the
 * redacted output, after ALWAYS_FORBIDDEN removal. Nested objects on
 * an allowed field are recursively walked: nested ALWAYS_FORBIDDEN
 * fields are removed, nested PII is masked.
 *
 * Allow-list is the floor. Any top-level field not in the per-mode
 * allow-list is dropped and recorded in `removed_fields`.
 */
export const ALLOWED_FIELDS_BY_MODE: Record<RedactionMode, readonly string[]> =
  Object.freeze({
    metadata_only: Object.freeze([
      "governance_record_id",
      "export_request_id",
      "match_id",
      "status",
      "redaction_mode",
      "requested_at",
      "approved_at",
      "updated_at",
      "created_at",
      "is_demo",
      "is_test",
      "demo",
      "test_mode",
      "legal_hold",
    ]),
    redacted_client_safe: Object.freeze([
      "governance_record_id",
      "export_request_id",
      "match_id",
      "status",
      "redaction_mode",
      "requested_at",
      "approved_at",
      "updated_at",
      "created_at",
      "is_demo",
      "is_test",
      "demo",
      "test_mode",
      "legal_hold",
      "decision_summary",
      "outcome_summary",
      "purpose",
      "reason_summary",
      "approval_note_summary",
      "counterparty_label",
    ]),
    evidence_only: Object.freeze([
      "governance_record_id",
      "export_request_id",
      "match_id",
      "status",
      "redaction_mode",
      "requested_at",
      "approved_at",
      "updated_at",
      "created_at",
      "is_demo",
      "is_test",
      "demo",
      "test_mode",
      "legal_hold",
      "evidence_summary",
      "evidence_counts",
    ]),
    full_internal: Object.freeze([
      "governance_record_id",
      "export_request_id",
      "match_id",
      "status",
      "redaction_mode",
      "requested_at",
      "approved_at",
      "updated_at",
      "created_at",
      "is_demo",
      "is_test",
      "demo",
      "test_mode",
      "legal_hold",
      "decision_summary",
      "outcome_summary",
      "purpose",
      "reason_summary",
      "approval_note_summary",
      "counterparty_label",
      "evidence_summary",
      "evidence_counts",
      "requester_user_id",
      "approver_user_id",
      "audit_reference_ids",
      "previous_status",
      "new_status",
    ]),
  });

/**
 * Safe legal-hold context schema. The redactor reduces any incoming
 * `legal_hold` object to ONLY these fields. Raw reason / notes /
 * released_* / applied_by are dropped (and also blocked by the
 * ALWAYS_FORBIDDEN list as defence-in-depth).
 */
export const LEGAL_HOLD_SAFE_FIELDS: readonly string[] = Object.freeze([
  "has_legal_hold",
  "scope",
  "hold_count",
  "hold_sources",
  "primary_scope",
  "detected_at",
  "detection_source",
  "detection_version",
]);

export interface RedactionManifest {
  mode: RedactionMode;
  allowed_fields: string[];
  removed_fields: string[];
  masked_fields: string[];
  forbidden_fields_blocked: string[];
  legal_hold_reduced: boolean;
  notes: string[];
}

export interface RedactionResult<T = Record<string, unknown>> {
  redacted: T;
  manifest: RedactionManifest;
}

export class UnsupportedRedactionModeError extends Error {
  readonly code = "UNSUPPORTED_REDACTION_MODE";
  constructor(mode: string) {
    super(`Unsupported redaction mode: ${mode}`);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function matchesAny(name: string, subs: readonly string[]): boolean {
  const lc = name.toLowerCase();
  return subs.some((s) => lc === s || lc.includes(s));
}

function isForbiddenName(name: string): boolean {
  return matchesAny(name, ALWAYS_FORBIDDEN_FIELD_SUBSTRINGS);
}

function isPiiName(name: string): boolean {
  return matchesAny(name, PII_MASK_FIELD_SUBSTRINGS);
}

/**
 * Recursively walks a value, removing ALWAYS_FORBIDDEN fields and
 * masking PII fields (unless `keepPiiRaw` is true, used only for
 * `full_internal`). Records every removal / mask into the supplied
 * manifest accumulators.
 *
 * Pure — never mutates the input. Returns a deep-cloned, sanitised
 * value.
 */
function sanitiseValue(
  value: unknown,
  path: string,
  acc: {
    removed: Set<string>;
    masked: Set<string>;
    forbidden: Set<string>;
  },
  keepPiiRaw: boolean,
): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) =>
      sanitiseValue(v, `${path}[${i}]`, acc, keepPiiRaw),
    );
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const childPath = path ? `${path}.${k}` : k;
      if (isForbiddenName(k)) {
        acc.forbidden.add(childPath);
        continue;
      }
      if (isPiiName(k)) {
        acc.masked.add(childPath);
        out[k] = keepPiiRaw
          ? sanitiseValue(v, childPath, acc, keepPiiRaw)
          : MASK_TOKEN;
        continue;
      }
      out[k] = sanitiseValue(v, childPath, acc, keepPiiRaw);
    }
    return out;
  }
  // primitive — return as-is (deep-clone is a no-op for primitives).
  return value;
}

function reduceLegalHold(
  value: unknown,
  acc: {
    removed: Set<string>;
    masked: Set<string>;
    forbidden: Set<string>;
  },
): unknown {
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (isForbiddenName(k)) {
      acc.forbidden.add(`legal_hold.${k}`);
      continue;
    }
    if (LEGAL_HOLD_SAFE_FIELDS.includes(k)) {
      // `detected` sub-object may carry the safe summary too —
      // sanitise recursively but keep only safe fields at the root.
      out[k] = sanitiseValue(v, `legal_hold.${k}`, acc, false);
      continue;
    }
    acc.removed.add(`legal_hold.${k}`);
  }
  return out;
}

/**
 * Apply the Batch 8 redaction contract to an input payload.
 *
 * Pure. Deterministic. Never mutates `input`. Never performs IO.
 *
 *   - Unsupported `mode` throws UnsupportedRedactionModeError.
 *   - Omitted `mode` defaults to DEFAULT_REDACTION_MODE.
 *   - Output contains ONLY fields from ALLOWED_FIELDS_BY_MODE[mode],
 *     after ALWAYS_FORBIDDEN removal and PII masking.
 *   - `legal_hold` is reduced to LEGAL_HOLD_SAFE_FIELDS only.
 *   - Demo / test labels are preserved verbatim.
 *   - No mode ever returns signed_url / download_url / file_path /
 *     storage_object / raw API payloads / tokens / secrets / raw
 *     legal-hold reasons.
 */
export function redactGovernanceRecord<T extends Record<string, unknown>>(
  input: T,
  mode: RedactionMode | string | undefined = DEFAULT_REDACTION_MODE,
): RedactionResult {
  const resolved: RedactionMode =
    mode === undefined || mode === null
      ? DEFAULT_REDACTION_MODE
      : (mode as RedactionMode);
  if (!REDACTION_MODES.includes(resolved)) {
    throw new UnsupportedRedactionModeError(String(mode));
  }
  if (!isPlainObject(input)) {
    throw new TypeError("redactGovernanceRecord: input must be a plain object");
  }

  const allowed = ALLOWED_FIELDS_BY_MODE[resolved];
  const removed = new Set<string>();
  const masked = new Set<string>();
  const forbidden = new Set<string>();
  // `full_internal` keeps PII raw at the top level for internal review,
  // but every PII touch is still recorded in the manifest.
  const keepPiiRaw = resolved === "full_internal";

  const redacted: Record<string, unknown> = {};
  let legalHoldReduced = false;

  for (const [k, v] of Object.entries(input)) {
    if (isForbiddenName(k)) {
      forbidden.add(k);
      continue;
    }
    if (!allowed.includes(k)) {
      removed.add(k);
      continue;
    }
    if (k === "legal_hold") {
      redacted[k] = reduceLegalHold(v, {
        removed,
        masked,
        forbidden,
      });
      legalHoldReduced = true;
      continue;
    }
    if (isPiiName(k)) {
      masked.add(k);
      redacted[k] = keepPiiRaw
        ? sanitiseValue(v, k, { removed, masked, forbidden }, keepPiiRaw)
        : MASK_TOKEN;
      continue;
    }
    redacted[k] = sanitiseValue(
      v,
      k,
      { removed, masked, forbidden },
      keepPiiRaw,
    );
  }

  // Always stamp the resolved mode for downstream auditing, even if
  // the input did not carry one. Never overwritten silently above
  // because `redaction_mode` is in every mode's allow-list.
  if (!("redaction_mode" in redacted)) {
    redacted.redaction_mode = resolved;
  }

  const manifest: RedactionManifest = {
    mode: resolved,
    allowed_fields: [...allowed],
    removed_fields: [...removed].sort(),
    masked_fields: [...masked].sort(),
    forbidden_fields_blocked: [...forbidden].sort(),
    legal_hold_reduced: legalHoldReduced,
    notes:
      resolved === "full_internal"
        ? [
            "full_internal retains PII at top level for platform_admin internal review.",
            "All forbidden fields (secrets, signed URLs, raw legal-hold reasons, raw third-party payloads) remain blocked.",
          ]
        : [],
  };

  return { redacted, manifest };
}
