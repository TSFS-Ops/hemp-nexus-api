/**
 * Batch D — D4b Deno helper parity test.
 *
 * Verifies that the runtime allowlist exposed by
 * `_shared/batch-d-admin-notify.ts` is exactly the set of events the
 * TS catalogue (`src/lib/batch-d-events.ts`) marks
 * `adminDispatchEnabled: true`. Drift between the two files is the
 * #1 risk for the D4b safety contract — this test pins it.
 */

import { D4B_DISPATCH_EVENTS } from "./batch-d-admin-notify.ts";

const EXPECTED = [
  "engagement.binding_review_required",
  "engagement.disputed_being_named",
].sort();

Deno.test("D4b helper allowlist mirrors the TS catalogue", () => {
  const got = [...D4B_DISPATCH_EVENTS].sort();
  if (JSON.stringify(got) !== JSON.stringify(EXPECTED)) {
    throw new Error(
      `D4b allowlist drift: got ${JSON.stringify(got)} expected ${JSON.stringify(EXPECTED)}. ` +
        `Update src/lib/batch-d-events.ts AND _shared/batch-d-admin-notify.ts together.`,
    );
  }
});
