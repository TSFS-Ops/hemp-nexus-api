/**
 * replay-guard — atomic replay protection for inbound signed webhooks.
 *
 * Why this exists
 * ───────────────
 * Our inbound webhook handlers (auth-email-hook, handle-email-suppression,
 * any future signed inbound) verify HMAC signature + a timestamp freshness
 * window. That stops *forged* requests but does NOT stop *replays*: an
 * attacker who captures a single valid signed POST can re-send it within
 * the freshness window and the signature will still verify.
 *
 * The fix is a one-shot ledger: once we accept a (source, signature) pair,
 * any further request with the same pair is rejected as a replay. The
 * unique index on `webhook_replay_guard(source, signature_hash)` is the
 * actual atomicity primitive — a duplicate INSERT raises a Postgres
 * 23505 unique-violation, which we translate into a stable 409 response.
 *
 * Storage shape: we hash the signature with SHA-256 before storing it so
 * the table never contains reusable secret material and the index stays
 * compact (64 hex chars, btree-friendly).
 *
 * Usage
 * ─────
 *   const guard = await assertNotReplayed(supabase, {
 *     source: "lovable_email",
 *     signature: req.headers.get("x-lovable-signature") ?? "",
 *     timestampHeader: req.headers.get("x-lovable-timestamp"),
 *   });
 *   if (!guard.ok) return guard.response;  // 409, already-handled body
 *
 * The caller decides ordering — we recommend running this AFTER the
 * library-level signature verification, so an attacker cannot use this
 * endpoint to fill the table with garbage hashes (each call requires a
 * valid signature + timestamp first).
 */

// We accept any object that exposes a chainable `.from(table).insert(row)`
// returning a thenable that resolves to a `{ error }` shape. This
// deliberately avoids importing the concrete `SupabaseClient` type,
// because edge functions in this project import supabase-js from BOTH
// `npm:` and `https://esm.sh/...`, and the two produce
// nominally-incompatible classes that cannot be assigned to each other
// even though they're functionally identical at runtime.
//
// We also use `unknown` for the row type to avoid colliding with the
// generated table types which may not include webhook_replay_guard yet
// in callers that haven't regenerated.
// deno-lint-ignore no-explicit-any
export type ReplayGuardClient = any;

// ── Public types ──────────────────────────────────────────────────────────

export interface ReplayGuardOptions {
  /** Logical source name, e.g. "lovable_email", "lovable_suppression". */
  source: string;
  /** Raw signature header value. Will be SHA-256 hashed before storage. */
  signature: string;
  /** Raw timestamp header value (string). Used for staleness check. */
  timestampHeader?: string | null;
  /**
   * Maximum age, in seconds, that the timestamp is allowed to be.
   * Defaults to 300 (5 minutes), matching the upstream library default.
   */
  toleranceSeconds?: number;
  /**
   * Edge-function name (used in structured decision logs). Defaults to
   * "unknown" so older callers still produce queryable logs.
   */
  fnName?: string;
  /** Caller's own request id, threaded into the decision log. */
  requestId?: string | null;
  /**
   * Override the HTTP status returned on a detected replay.
   *
   * Default `409` is correct for most signed-webhook senders that treat
   * 4xx as "do not retry". Some providers (notably Paystack) treat any
   * non-2xx as failure and keep retrying — which is wasteful when we
   * already know the event is a known-safe duplicate. Pass `200` for
   * those providers; the body still carries `code: WEBHOOK_REPLAY` so
   * monitoring continues to count replays correctly.
   */
  replayResponseStatus?: number;
}

export type ReplayGuardResult =
  | { ok: true }
  | { ok: false; response: Response };

/**
 * Stable error response shape used by EVERY call site so monitoring,
 * client SDKs, and operators can recognise replay rejections uniformly.
 *
 * - HTTP 409 Conflict (semantically: "the signature is valid, but this
 *   exact request has already been processed"). We deliberately do NOT
 *   use 401 — that would trigger sender-side "rotate your secret"
 *   alarms even though the secret is fine.
 * - Body always contains `{ error, code, message }`.
 */
export const REPLAY_RESPONSE_BODY = {
  error: "replay_detected",
  code: "WEBHOOK_REPLAY",
  message: "Webhook already processed",
} as const;

export const STALE_TIMESTAMP_RESPONSE_BODY = {
  error: "stale_timestamp",
  code: "WEBHOOK_STALE_TIMESTAMP",
  message: "Webhook timestamp is outside the freshness window",
} as const;

export const MISSING_SIGNATURE_RESPONSE_BODY = {
  error: "missing_signature",
  code: "WEBHOOK_MISSING_SIGNATURE",
  message: "Webhook signature header is missing",
} as const;

// ── Internal helpers ──────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

/**
 * Detect Postgres unique-violation. supabase-js surfaces it on
 * `error.code === "23505"`. We match defensively in case the
 * driver reshapes the error.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "23505") return true;
  if (typeof e.message === "string" && /duplicate key value/i.test(e.message)) return true;
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Verify (timestamp freshness + signature uniqueness) and atomically
 * record the signature so further replays are rejected.
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, response }` with a
 * ready-to-return Response on any failure (missing signature, stale
 * timestamp, replay detected, or DB error). Caller should `return
 * result.response` immediately — and merge in their own CORS headers if
 * they have them.
 */
export async function assertNotReplayed(
  supabase: ReplayGuardClient,
  opts: ReplayGuardOptions,
  extraResponseHeaders: Record<string, string> = {},
): Promise<ReplayGuardResult> {
  const tolerance = opts.toleranceSeconds ?? 300;
  const fnName = opts.fnName ?? "unknown";
  const requestId = opts.requestId ?? null;

  // Lazy import so functions that don't currently log don't pay the cost.
  const { logWebhookDecision } = await import("./webhook-decision-log.ts");

  if (!opts.signature || opts.signature.length === 0) {
    logWebhookDecision({
      fn: fnName,
      phase: "replay",
      decision: "reject",
      reason: "missing_signature",
      source: opts.source,
      requestId,
    });
    return {
      ok: false,
      response: jsonResponse(MISSING_SIGNATURE_RESPONSE_BODY, 401, extraResponseHeaders),
    };
  }

  // Timestamp freshness — defence in depth. The upstream library may
  // already check this, but bounding it here means even if a caller
  // forgets to use a verifying parser, we still won't accept ancient
  // signatures. We accept either Unix-seconds or ISO-8601.
  if (opts.timestampHeader != null && opts.timestampHeader !== "") {
    const ts = parseTimestamp(opts.timestampHeader);
    if (ts == null) {
      logWebhookDecision({
        fn: fnName,
        phase: "timestamp",
        decision: "reject",
        reason: "invalid_timestamp",
        source: opts.source,
        requestId,
      });
      return {
        ok: false,
        response: jsonResponse(STALE_TIMESTAMP_RESPONSE_BODY, 401, extraResponseHeaders),
      };
    }
    const ageSeconds = Math.abs((Date.now() - ts) / 1000);
    if (ageSeconds > tolerance) {
      logWebhookDecision({
        fn: fnName,
        phase: "timestamp",
        decision: "reject",
        reason: "stale_timestamp",
        source: opts.source,
        timestampAgeSeconds: ageSeconds,
        requestId,
        meta: { tolerance_seconds: tolerance },
      });
      return {
        ok: false,
        response: jsonResponse(STALE_TIMESTAMP_RESPONSE_BODY, 401, extraResponseHeaders),
      };
    }
  }

  const signatureHash = await sha256Hex(opts.signature);
  const sigPrefix = signatureHash.slice(0, 8);

  const { error } = await supabase
    .from("webhook_replay_guard")
    .insert({ source: opts.source, signature_hash: signatureHash });

  if (error) {
    if (isUniqueViolation(error)) {
      logWebhookDecision({
        fn: fnName,
        phase: "replay",
        decision: "reject",
        reason: "replay_detected",
        source: opts.source,
        signaturePrefix: sigPrefix,
        requestId,
      });
      return {
        ok: false,
        response: jsonResponse(
          { ...REPLAY_RESPONSE_BODY, replayed: true, idempotent: true },
          opts.replayResponseStatus ?? 409,
          extraResponseHeaders,
        ),
      };
    }
    // Unexpected DB error. Fail CLOSED — a webhook we can't replay-check
    // is one we should not process, otherwise an attacker who can knock
    // the DB offline can replay freely. 503 signals the sender to retry
    // (their retry will succeed once the DB recovers).
    logWebhookDecision({
      fn: fnName,
      phase: "replay",
      decision: "reject",
      reason: "guard_unavailable",
      source: opts.source,
      signaturePrefix: sigPrefix,
      requestId,
      meta: {
        db_error_code: (error as { code?: string }).code ?? null,
        db_error_message:
          typeof (error as { message?: string }).message === "string"
            ? (error as { message?: string }).message?.slice(0, 200)
            : null,
      },
    });
    return {
      ok: false,
      response: jsonResponse(
        {
          error: "replay_guard_unavailable",
          code: "WEBHOOK_REPLAY_GUARD_UNAVAILABLE",
          message: "Could not verify webhook uniqueness; please retry.",
        },
        503,
        extraResponseHeaders,
      ),
    };
  }

  logWebhookDecision({
    fn: fnName,
    phase: "replay",
    decision: "accept",
    reason: "ok",
    source: opts.source,
    signaturePrefix: sigPrefix,
    requestId,
  });

  return { ok: true };
}

/**
 * Parse a webhook timestamp header. Accepts:
 *   - Unix seconds (e.g. "1715000000")
 *   - Unix milliseconds (e.g. "1715000000000")
 *   - ISO-8601 (e.g. "2026-04-24T18:00:00Z")
 * Returns the timestamp as Unix milliseconds, or null if unparseable.
 */
function parseTimestamp(raw: string): number | null {
  const trimmed = raw.trim();
  // Pure numeric → seconds or milliseconds.
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    // Heuristic: anything < 10^12 is seconds (year 33658 in ms), >= is ms.
    return n < 1_000_000_000_000 ? n * 1000 : n;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
