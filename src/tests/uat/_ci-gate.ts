/**
 * Batch 21 — UAT provisioning secret gate.
 *
 * UAT journey tests rely on the `provision-test-user` edge function which
 * requires a service-role-issued provisioning secret. That secret is NOT
 * available in local sandboxes and the function returns 401 when called
 * without it.
 *
 * Set `UAT_PROVISIONING_ENABLED=1` in the CI environment that has the
 * secret wired into the edge function to opt those runs in. When the env
 * var is absent we skip the entire describe block with a clear message
 * rather than failing.
 */
export const UAT_PROVISIONING_ENABLED =
  typeof import.meta !== "undefined" &&
  // Vitest exposes the env via import.meta.env
  (import.meta as any).env?.UAT_PROVISIONING_ENABLED === "1";

export const UAT_SKIP_REASON =
  "Skipped locally: requires CI provisioning secret (UAT_PROVISIONING_ENABLED=1 with provision-test-user secret wired).";

if (!UAT_PROVISIONING_ENABLED) {
  // Vitest prints describe-level skip reasons; emit one stable log line so
  // the test-summary script can prove the suite was skipped, not failed.
  // eslint-disable-next-line no-console
  console.info(`[uat] ${UAT_SKIP_REASON}`);
}
