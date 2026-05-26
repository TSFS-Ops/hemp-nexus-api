/**
 * basic-memory-record-write — Basic Memory Record v1 internal writer.
 *
 * Purpose
 * ───────
 *   Append-only writer for `public.basic_memory_records`. Called by
 *   internal backend code (collapse / p3-wad / dispute-resolve will
 *   hook in a later batch) to record an HQ-visible retained-outcome
 *   row after a critical lifecycle event.
 *
 * Scope (v1 — DO NOT EXPAND HERE)
 * ───────────────────────────────
 *   - Only three trigger_event_types: finality.collapsed, wad.sealed,
 *     dispute.resolved.
 *   - Only three outcomes / reasons / three environments.
 *   - No update path. No delete path. No correction path. No export.
 *   - No raw provider payloads, document bodies, or secrets accepted.
 *   - No frontend / browser invocation path. service_role bearer or
 *     `x-internal-key: INTERNAL_CRON_KEY` only.
 *
 * Idempotency
 * ───────────
 *   Enforced at the DB by UNIQUE(trigger_event_type, source_record_id).
 *   On a unique-violation we fetch and return the existing row so
 *   callers can safely retry without producing duplicates.
 *
 * Auth
 * ────
 *   - `x-internal-key: <INTERNAL_CRON_KEY>`, OR
 *   - service_role bearer.
 *   Anything else returns 401 UNAUTHORIZED — no platform_admin path,
 *   no anon path, no authenticated-browser path.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { webhookCorsHeaders } from "../_shared/cors.ts";

const corsHeaders = { ...webhookCorsHeaders() };

// ─── Approved v1 vocabularies (mirror of src/lib/basic-memory/outcomes.ts
//     and the CHECK constraints on public.basic_memory_records). Drift is
//     prevented by scripts/check-basic-memory-vocab-drift.mjs. ───────────
const TRIGGER_TYPES = new Set([
  "finality.collapsed",
  "wad.sealed",
  "dispute.resolved",
]);
const OUTCOMES = new Set(["completed", "wad_sealed", "dispute_resolved"]);
const OUTCOME_REASONS = new Set([
  "collapse_recorded",
  "attestations_complete",
  "dispute_resolved",
]);
const ENVIRONMENTS = new Set(["live", "demo", "test"]);

// status_snapshot must be a JSON object and stay small — Batch 1
// schema is jsonb, but the writer is the choke point that bounds size
// so we do not let a future caller dump an entire provider payload.
const STATUS_SNAPSHOT_MAX_BYTES = 8 * 1024; // 8 KiB
const AUDIT_EVENT_IDS_MAX = 32;
const OUTCOME_SUMMARY_MAX = 500;

// Fields that must never appear on the payload — they would smuggle
// raw provider payloads, document bodies or secrets into Memory.
const FORBIDDEN_KEYS = new Set([
  "raw_payload",
  "provider_payload",
  "payload",
  "document",
  "document_content",
  "document_body",
  "file",
  "file_bytes",
  "secret",
  "secrets",
  "password",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "refresh_token",
  "bearer",
  "authorization",
  "private_key",
  "ssn",
  "card_number",
  "cvv",
  "pan",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface WritePayload {
  trigger_event_type: string;
  outcome: string;
  outcome_reason: string;
  outcome_summary?: string | null;
  match_id?: string | null;
  poi_id?: string | null;
  wad_id?: string | null;
  engagement_id?: string | null;
  dispute_id?: string | null;
  source_table: string;
  source_record_id: string;
  source_function: string;
  status_snapshot?: Record<string, unknown>;
  audit_event_ids?: string[];
  environment_classification: string;
}

interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

function validate(body: unknown): ValidationError | WritePayload {
  if (!isPlainObject(body)) {
    return { code: "INVALID_PAYLOAD", message: "Body must be a JSON object" };
  }

  // Forbidden keys — reject the entire request rather than silently strip.
  for (const k of Object.keys(body)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
      return {
        code: "FORBIDDEN_FIELD",
        message: `Field '${k}' is not permitted on Basic Memory writes`,
        field: k,
      };
    }
  }

  const b = body as Record<string, unknown>;

  if (typeof b.trigger_event_type !== "string" ||
      !TRIGGER_TYPES.has(b.trigger_event_type)) {
    return {
      code: "INVALID_TRIGGER",
      message: "trigger_event_type is not in the approved v1 set",
      field: "trigger_event_type",
    };
  }
  if (typeof b.outcome !== "string" || !OUTCOMES.has(b.outcome)) {
    return {
      code: "INVALID_OUTCOME",
      message: "outcome is not in the approved v1 set",
      field: "outcome",
    };
  }
  if (
    typeof b.outcome_reason !== "string" ||
    !OUTCOME_REASONS.has(b.outcome_reason)
  ) {
    return {
      code: "INVALID_OUTCOME_REASON",
      message: "outcome_reason is not in the approved v1 set",
      field: "outcome_reason",
    };
  }
  if (
    typeof b.environment_classification !== "string" ||
    !ENVIRONMENTS.has(b.environment_classification)
  ) {
    return {
      code: "INVALID_ENVIRONMENT",
      message: "environment_classification must be live | demo | test",
      field: "environment_classification",
    };
  }

  for (const f of ["source_table", "source_function"] as const) {
    if (typeof b[f] !== "string" || (b[f] as string).trim() === "") {
      return { code: "MISSING_FIELD", message: `${f} is required`, field: f };
    }
    if ((b[f] as string).length > 200) {
      return {
        code: "FIELD_TOO_LONG",
        message: `${f} exceeds 200 chars`,
        field: f,
      };
    }
  }
  if (typeof b.source_record_id !== "string" ||
      !UUID_RE.test(b.source_record_id)) {
    return {
      code: "INVALID_SOURCE_RECORD_ID",
      message: "source_record_id must be a UUID",
      field: "source_record_id",
    };
  }

  // Optional UUID anchors.
  const anchorFields = [
    "match_id",
    "poi_id",
    "wad_id",
    "engagement_id",
    "dispute_id",
  ] as const;
  for (const f of anchorFields) {
    if (b[f] != null) {
      if (typeof b[f] !== "string" || !UUID_RE.test(b[f] as string)) {
        return {
          code: "INVALID_UUID",
          message: `${f} must be a UUID when supplied`,
          field: f,
        };
      }
    }
  }
  // Require at least one anchor.
  if (!anchorFields.some((f) => typeof b[f] === "string" && b[f])) {
    return {
      code: "MISSING_ANCHOR",
      message:
        "At least one anchor id is required (match_id, poi_id, wad_id, engagement_id or dispute_id)",
    };
  }

  if (b.outcome_summary != null) {
    if (typeof b.outcome_summary !== "string") {
      return {
        code: "INVALID_OUTCOME_SUMMARY",
        message: "outcome_summary must be a string",
        field: "outcome_summary",
      };
    }
    if (b.outcome_summary.length > OUTCOME_SUMMARY_MAX) {
      return {
        code: "OUTCOME_SUMMARY_TOO_LONG",
        message: `outcome_summary exceeds ${OUTCOME_SUMMARY_MAX} chars`,
        field: "outcome_summary",
      };
    }
  }

  if (b.status_snapshot !== undefined) {
    if (!isPlainObject(b.status_snapshot)) {
      return {
        code: "INVALID_STATUS_SNAPSHOT",
        message: "status_snapshot must be a JSON object",
        field: "status_snapshot",
      };
    }
    // Forbidden keys within status_snapshot too.
    for (const k of Object.keys(b.status_snapshot)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
        return {
          code: "FORBIDDEN_FIELD",
          message: `status_snapshot.${k} is not permitted`,
          field: `status_snapshot.${k}`,
        };
      }
    }
    const size = new TextEncoder().encode(
      JSON.stringify(b.status_snapshot),
    ).byteLength;
    if (size > STATUS_SNAPSHOT_MAX_BYTES) {
      return {
        code: "STATUS_SNAPSHOT_TOO_LARGE",
        message: `status_snapshot exceeds ${STATUS_SNAPSHOT_MAX_BYTES} bytes`,
        field: "status_snapshot",
      };
    }
  }

  if (b.audit_event_ids !== undefined) {
    if (!Array.isArray(b.audit_event_ids)) {
      return {
        code: "INVALID_AUDIT_EVENT_IDS",
        message: "audit_event_ids must be an array of UUIDs",
        field: "audit_event_ids",
      };
    }
    if (b.audit_event_ids.length > AUDIT_EVENT_IDS_MAX) {
      return {
        code: "AUDIT_EVENT_IDS_TOO_MANY",
        message: `audit_event_ids exceeds ${AUDIT_EVENT_IDS_MAX} entries`,
        field: "audit_event_ids",
      };
    }
    for (const id of b.audit_event_ids) {
      if (typeof id !== "string" || !UUID_RE.test(id)) {
        return {
          code: "INVALID_AUDIT_EVENT_ID",
          message: "audit_event_ids must contain only UUID strings",
          field: "audit_event_ids",
        };
      }
    }
  }

  return b as unknown as WritePayload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const INTERNAL_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    // Do not leak which is missing.
    return json(500, { error: "SERVER_MISCONFIGURED" });
  }

  const internalHeader = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const isInternalCron =
    !!INTERNAL_KEY && internalHeader === INTERNAL_KEY;
  const isServiceRole = authHeader === `Bearer ${SERVICE_ROLE}`;

  if (!isInternalCron && !isServiceRole) {
    return json(401, { error: "UNAUTHORIZED" });
  }

  let raw: unknown;
  try {
    const txt = await req.text();
    if (!txt || txt.trim() === "") {
      return json(400, { error: "INVALID_JSON" });
    }
    raw = JSON.parse(txt);
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }

  const validated = validate(raw);
  if ("code" in validated) {
    return json(400, {
      error: validated.code,
      message: validated.message,
      field: validated.field,
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const row = {
    trigger_event_type: validated.trigger_event_type,
    outcome: validated.outcome,
    outcome_reason: validated.outcome_reason,
    outcome_summary: validated.outcome_summary ?? null,
    match_id: validated.match_id ?? null,
    poi_id: validated.poi_id ?? null,
    wad_id: validated.wad_id ?? null,
    engagement_id: validated.engagement_id ?? null,
    dispute_id: validated.dispute_id ?? null,
    source_table: validated.source_table,
    source_record_id: validated.source_record_id,
    source_function: validated.source_function,
    status_snapshot: validated.status_snapshot ?? {},
    audit_event_ids: validated.audit_event_ids ?? [],
    environment_classification: validated.environment_classification,
  };

  const { data: inserted, error: insertErr } = await admin
    .from("basic_memory_records")
    .insert(row)
    .select("*")
    .single();

  if (!insertErr && inserted) {
    return json(201, { record: inserted, duplicate: false });
  }

  // Idempotent path: UNIQUE(trigger_event_type, source_record_id).
  // Postgres unique_violation = 23505.
  const code = (insertErr as { code?: string } | null)?.code;
  if (code === "23505") {
    const { data: existing, error: fetchErr } = await admin
      .from("basic_memory_records")
      .select("*")
      .eq("trigger_event_type", validated.trigger_event_type)
      .eq("source_record_id", validated.source_record_id)
      .maybeSingle();
    if (!fetchErr && existing) {
      return json(200, { record: existing, duplicate: true });
    }
    console.error(
      "[basic-memory-record-write] duplicate refetch failed",
      fetchErr,
    );
    return json(500, { error: "WRITE_FAILED" });
  }

  // Do not leak raw DB error text — log server-side only.
  console.error("[basic-memory-record-write] insert failed", insertErr);
  return json(500, { error: "WRITE_FAILED" });
});
