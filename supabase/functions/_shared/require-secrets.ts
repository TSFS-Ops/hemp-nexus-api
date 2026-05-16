/**
 * Batch U — Required Fix 3: shared secret health helper.
 *
 * Every edge function that depends on environment-supplied secrets
 * should call `requireSecrets({ required, optional })` at startup.
 * The helper:
 *
 *   - Reads each secret name via `Deno.env.get` (presence-only).
 *   - NEVER logs, returns, or echoes the secret value itself —
 *     only the *name* of any missing secret is surfaced.
 *   - Emits a structured result the caller can:
 *       * use to fail-closed when a required secret is missing,
 *       * use to degrade gracefully when only an optional secret
 *         is missing,
 *       * forward to an admin/health writer so HealthBoard can
 *         show the project as failed/degraded BEFORE a user hits
 *         the broken path.
 *
 * Status semantics:
 *   "ok"      — all required + optional present
 *   "degraded"— all required present, ≥1 optional missing
 *   "failed"  — ≥1 required missing
 *
 * The helper is intentionally synchronous and dependency-free so it can
 * be imported by any edge function without bloating cold-start.
 */

export type SecretHealthStatus = "ok" | "degraded" | "failed";

export interface RequireSecretsInput {
  /** Names of secrets that MUST be present. Missing → failed. */
  required?: readonly string[];
  /** Names of secrets that, when missing, should degrade rather than fail. */
  optional?: readonly string[];
  /** Function name (for audit / log correlation). Never includes values. */
  source?: string;
}

export interface SecretHealthResult {
  status: SecretHealthStatus;
  source: string;
  missing_required: string[];
  missing_optional: string[];
  /**
   * Convenience flag: true when all *required* secrets are present.
   * Callers that can run in degraded mode should check this rather
   * than `status === "ok"`.
   */
  required_ok: boolean;
}

function read(name: string): string | undefined {
  try {
    const v = Deno.env.get(name);
    if (v === undefined || v === null) return undefined;
    // Treat blank as missing — env vars sometimes resolve to "".
    return v.length === 0 ? undefined : v;
  } catch {
    return undefined;
  }
}

/**
 * Inspect the runtime environment for the listed secrets.
 *
 * IMPORTANT: this function never returns or logs the *value* of any
 * secret — only the missing *names*. Do not change that contract.
 */
export function requireSecrets(input: RequireSecretsInput): SecretHealthResult {
  const required = input.required ?? [];
  const optional = input.optional ?? [];

  const missing_required: string[] = [];
  for (const name of required) {
    if (read(name) === undefined) missing_required.push(name);
  }
  const missing_optional: string[] = [];
  for (const name of optional) {
    if (read(name) === undefined) missing_optional.push(name);
  }

  const required_ok = missing_required.length === 0;
  let status: SecretHealthStatus = "ok";
  if (!required_ok) status = "failed";
  else if (missing_optional.length > 0) status = "degraded";

  return {
    status,
    source: input.source ?? "unknown",
    missing_required,
    missing_optional,
    required_ok,
  };
}

/**
 * Convenience: throw if any required secret is missing. Callers that
 * cannot safely run in degraded mode should call this first.
 *
 * The error message lists only the missing *names* — never values.
 */
export function assertRequiredSecrets(input: RequireSecretsInput): SecretHealthResult {
  const r = requireSecrets(input);
  if (!r.required_ok) {
    throw new Error(
      `SECRET_MISSING: ${r.source} is missing required secret(s): ${r.missing_required.join(", ")}`,
    );
  }
  return r;
}
