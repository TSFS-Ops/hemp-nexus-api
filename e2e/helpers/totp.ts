/**
 * Secure TOTP helper for Smoke A–D.
 *
 * Hard rules (must not regress):
 *   1. STAGING-ONLY. Refuses to run unless SMOKE_ENV is explicitly set
 *      to "staging" or "test". Production TOTP secrets must never be
 *      handed to test tooling.
 *   2. NO LOGGING. The secret and the generated 6-digit code are never
 *      written to stdout, stderr, files, Playwright traces, or thrown
 *      error messages. Errors reference the env var *name* only.
 *   3. ZERO PERSISTENCE. The secret lives in process memory for the
 *      duration of one generate() call and is then dropped from the
 *      local scope. Callers should source it from env, never from a
 *      file committed to the repo.
 *
 * These rules apply equally to automated (Playwright) and manual
 * (interactive CLI) use — see scripts/totp-prompt.mjs for the manual
 * flow which reuses generateTotp() under the same guard.
 */

const ALLOWED_ENVS = new Set(["staging", "test"]);

export function assertStagingOnly(): void {
  const env = (process.env.SMOKE_ENV ?? "").toLowerCase();
  if (!ALLOWED_ENVS.has(env)) {
    throw new Error(
      "TOTP helper refused: SMOKE_ENV must be 'staging' or 'test'. " +
        "Production TOTP material must never be used with automated tests.",
    );
  }
}

/**
 * Generate the current 6-digit TOTP code for a base32 secret.
 *
 * Throws a redacted error if `otpauth` is not installed or the secret
 * env var is unset. The returned code is intentionally NOT logged by
 * this helper — callers must also avoid logging it.
 */
export async function generateTotp(secretEnvVar: string): Promise<string> {
  assertStagingOnly();
  const secret = process.env[secretEnvVar];
  if (!secret) {
    throw new Error(`Missing env ${secretEnvVar} (TOTP secret).`);
  }
  let TOTP: typeof import("otpauth").TOTP;
  let Secret: typeof import("otpauth").Secret;
  try {
    const mod = await import("otpauth");
    TOTP = mod.TOTP;
    Secret = mod.Secret;
  } catch {
    throw new Error("Install `otpauth` (npm i -D otpauth) to generate TOTP codes.");
  }
  // Construct, generate, drop references. The intermediate `totp`
  // object holds the secret; we let it fall out of scope immediately.
  const code = new TOTP({
    secret: Secret.fromBase32(secret.trim()),
    digits: 6,
    period: 30,
  }).generate();
  return code;
}
