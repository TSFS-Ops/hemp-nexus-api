// Static guard: no Stage 2A/2B-converted edge function may contain a hardcoded
// `Access-Control-Allow-Origin: "*"` (any quote style). The shared CORS helper
// (_shared/cors.ts) is the only allow-listed location for an explicit wildcard,
// and only when ALLOWED_ORIGINS is explicitly set to '*' at runtime.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const STAGE_2A_FILES = [
  "supabase/functions/token-purchase/index.ts",
  "supabase/functions/admin-users/index.ts",
  "supabase/functions/admin-org-reconciliation/index.ts",
  "supabase/functions/admin-user-journey/index.ts",
  "supabase/functions/delete-account/index.ts",
  "supabase/functions/send-team-invite/index.ts",
  "supabase/functions/draft-poi/index.ts",
  "supabase/functions/due-diligence/index.ts",
  "supabase/functions/poi-transition/index.ts",
  "supabase/functions/validate-upload/index.ts",
  "supabase/functions/verification-walkthrough/index.ts",
];

const STAGE_2B_FILES = [
  "supabase/functions/auth-email-hook/index.ts",
  "supabase/functions/handle-email-unsubscribe/index.ts",
  "supabase/functions/dispatch-acceptance-receipts/index.ts",
  "supabase/functions/outreach-sla-monitor/index.ts",
  "supabase/functions/storage-retention-cleanup/index.ts",
  "supabase/functions/clip-on-record-billing-failure/index.ts",
  "supabase/functions/preview-transactional-email/index.ts",
  "supabase/functions/send-transactional-email/index.ts",
  "supabase/functions/send-verification-email/index.ts",
  "supabase/functions/provision-test-user/index.ts",
];

const WILDCARD_PATTERNS = [
  /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
];

async function scanFile(path: string): Promise<string[]> {
  let src: string;
  try {
    src = await Deno.readTextFile(path);
  } catch {
    return [`MISSING_FILE: ${path}`];
  }
  const offenders: string[] = [];
  src.split("\n").forEach((line, idx) => {
    for (const re of WILDCARD_PATTERNS) {
      if (re.test(line)) {
        offenders.push(`${path}:${idx + 1}: ${line.trim()}`);
      }
    }
  });
  return offenders;
}

Deno.test("Stage 2A converted edge functions contain no Allow-Origin: '*' wildcard", async () => {
  const all: string[] = [];
  for (const f of STAGE_2A_FILES) {
    all.push(...(await scanFile(f)));
  }
  assertEquals(all, [], `Stage 2A wildcard offenders found:\n${all.join("\n")}`);
});

Deno.test("Stage 2B converted edge functions contain no Allow-Origin: '*' wildcard", async () => {
  const all: string[] = [];
  for (const f of STAGE_2B_FILES) {
    all.push(...(await scanFile(f)));
  }
  assertEquals(all, [], `Stage 2B wildcard offenders found:\n${all.join("\n")}`);
});
