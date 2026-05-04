/**
 * AAL2 / MFA enforcement helper for sensitive admin endpoints.
 *
 * Background
 * ──────────
 * Supabase auth issues JWTs with an `aal` claim:
 *   - "aal1" — single-factor (password / magic-link / OAuth) only.
 *   - "aal2" — user has completed an MFA challenge (TOTP) in this session.
 *
 * Per project P0 SEC-001, money-moving and manual state-override admin
 * endpoints (e.g. `admin-credit-org`, future manual POI overrides, future
 * direct token mutations) MUST refuse callers whose session is only
 * aal1 — even if their RBAC role check passes.
 *
 * Scope (deliberately narrow)
 * ───────────────────────────
 * `break-glass` is intentionally NOT migrated to this helper because it
 * already requires server-side password re-authentication via the GoTrue
 * `/token?grant_type=password` endpoint, which is a stronger proof of
 * identity in that exact moment than an MFA challenge cached in the JWT.
 *
 * Behaviour
 * ─────────
 *   - Returns void on success.
 *   - Throws `ApiException("MFA_REQUIRED", ..., 403)` when the JWT is
 *     not aal2. Callers should let this bubble out of the standard
 *     `errorResponse` mapper so the client receives a stable 403 with
 *     code `MFA_REQUIRED`.
 *
 * The token here is the same Bearer token already validated by the
 * caller's auth path — we re-decode the unverified payload only to read
 * the `aal` claim. We do NOT re-verify the signature; the caller has
 * already done that via `auth.getUser()` / `auth.getClaims()`.
 *
 * Audit hook is best-effort: on a denied call we write an
 * `admin.mfa_required_denied` row to `admin_audit_logs` if a service
 * client is supplied.
 */

import { ApiException } from "./errors.ts";

interface JwtPayload {
  aal?: string;
  amr?: Array<{ method: string; timestamp?: number }>;
  sub?: string;
  exp?: number;
}

/** Best-effort base64url decode — never throws. */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const json = atob(payload);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** Read the `aal` claim from a Bearer token without re-verifying. */
export function readAal(token: string | null | undefined): "aal1" | "aal2" | "unknown" {
  if (!token) return "unknown";
  const cleaned = token.startsWith("Bearer ") ? token.slice(7) : token;
  const payload = decodeJwtPayload(cleaned);
  const aal = payload?.aal;
  if (aal === "aal1" || aal === "aal2") return aal;
  return "unknown";
}

export interface AssertAal2Options {
  /** Optional service-role client used to write a denial audit row. */
  // deno-lint-ignore no-explicit-any
  adminClient?: any;
  /** Caller user id (for audit). */
  callerUserId?: string | null;
  /** Action label (for audit), e.g. "admin.credit_org". */
  action?: string;
  /** Free-form context for audit details. */
  context?: Record<string, unknown>;
}

/**
 * Throws `ApiException("MFA_REQUIRED", ..., 403)` if the supplied
 * Authorization header is not an aal2 (MFA-challenged) JWT.
 *
 * `unknown` is treated as failure — fail-closed.
 */
export async function assertAal2(
  authHeader: string | null,
  opts: AssertAal2Options = {},
): Promise<void> {
  const aal = readAal(authHeader);
  if (aal === "aal2") return;

  // Best-effort denial audit.
  if (opts.adminClient) {
    try {
      await opts.adminClient.from("admin_audit_logs").insert({
        admin_user_id: opts.callerUserId ?? null,
        action: "admin.mfa_required_denied",
        target_type: "system",
        target_id: null,
        details: {
          attempted_action: opts.action ?? "unknown",
          observed_aal: aal,
          ...(opts.context ?? {}),
        },
      });
    } catch (e) {
      console.error("[assertAal2] audit write failed:", e);
    }
  }

  throw new ApiException(
    "MFA_REQUIRED",
    "This action requires multi-factor authentication. Enrol an authenticator app and complete an MFA challenge before retrying.",
    403,
    { observed_aal: aal },
  );
}
