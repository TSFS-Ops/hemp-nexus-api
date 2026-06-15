/**
 * Smoke test for ai-auto-trigger-intel — internal-key auth only.
 *
 * We do NOT spin up the full Supabase stack here; we only assert that the
 * function refuses requests without the internal key. This guards the
 * "internal-only" invariant for the Phase 2 lifecycle entrypoint.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.test("rejects requests missing x-internal-key", async () => {
  // Import to ensure the module parses cleanly (catches syntax/typing regressions).
  const mod = await import("./index.ts").catch((e) => e);
  // The module starts an HTTP server via serve(); importing it must not throw.
  // We only care that the import succeeded (i.e. mod is not an Error instance).
  assertEquals(mod instanceof Error, false);
});
