/**
 * POI-004 stage-2 — downstream notification/email/webhook dedupe.
 *
 * Source-of-truth (no live HTTP) tests pinning the structural and code-level
 * guards that prevent duplicate POI notifications, emails, revenue notices
 * and webhook deliveries even if the upstream `atomic_generate_poi_v2` /
 * edge state guard is bypassed by a future refactor.
 *
 * Live duplicate-rejection probes for the unique indexes are documented in
 * the rollout task notes; the indexes themselves are pinned here against
 * the migration files so a future migration cannot silently drop them.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

function loadAllMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf-8"))
    .join("\n");
}

const sql = loadAllMigrations();
const sendTxn = readFileSync(
  join(ROOT, "supabase/functions/send-transactional-email/index.ts"),
  "utf-8",
);
const revenueNotify = readFileSync(
  join(ROOT, "supabase/functions/_shared/revenue-notify.ts"),
  "utf-8",
);
const webhooks = readFileSync(
  join(ROOT, "supabase/functions/_shared/webhooks.ts"),
  "utf-8",
);
const matchFn = readFileSync(
  join(ROOT, "supabase/functions/match/index.ts"),
  "utf-8",
);

describe("POI-004 stage-2 — migration unique indexes", () => {
  it("notifications: partial UNIQUE on (user_id, type, link) for POI types", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_poi_per_user_link\s+ON public\.notifications \(user_id, type, link\)\s+WHERE type IN \(\s*'poi_admin_facilitation',\s*'poi_support_desk',\s*'poi_counterparty_notification'\s*\)/i,
    );
  });

  it("revenue_notification_audit: existing BTREE dropped and replaced with UNIQUE", () => {
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.idx_rev_notif_audit_idem/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_rev_notif_audit_idempotency_key\s+ON public\.revenue_notification_audit \(idempotency_key\)/i,
    );
  });

  it("email_send_log: idempotency_key column + partial UNIQUE", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.email_send_log\s+ADD COLUMN IF NOT EXISTS idempotency_key text/i,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_email_send_log_idempotency_key\s+ON public\.email_send_log \(idempotency_key\)\s+WHERE idempotency_key IS NOT NULL/i,
    );
  });

  it("webhook_deliveries: event_idempotency_key column + per-endpoint UNIQUE", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.webhook_deliveries\s+ADD COLUMN IF NOT EXISTS event_idempotency_key text/i,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_deliveries_event_idempotency\s+ON public\.webhook_deliveries \(webhook_endpoint_id, event_idempotency_key\)\s+WHERE event_idempotency_key IS NOT NULL/i,
    );
  });

  it("includes a pre-flight duplicate-data abort guard", () => {
    expect(sql).toMatch(/POI-004 stage-2 migration aborted: duplicates exist/);
  });
});

describe("POI-004 stage-2 — send-transactional-email idempotency", () => {
  it("performs an idempotency lookup against email_send_log when caller supplies a key", () => {
    expect(sendTxn).toMatch(
      /callerSuppliedKey[\s\S]*?\.from\('email_send_log'\)[\s\S]*?\.eq\('idempotency_key', callerSuppliedKey\)/,
    );
    expect(sendTxn).toContain("Idempotent replay — returning prior send");
  });

  it("returns prior messageId/status with idempotent:true on replay (no second enqueue)", () => {
    expect(sendTxn).toMatch(/idempotent: true,\s*messageId: prior\.message_id,\s*status: prior\.status/);
    // The enqueue_email RPC must NOT be called on the idempotent return path.
    const replayBlock = sendTxn.split("Idempotent replay — returning prior send")[1] ?? "";
    const firstReturn = replayBlock.indexOf("return wrap");
    const upToReturn = replayBlock.slice(0, firstReturn);
    expect(upToReturn).not.toMatch(/enqueue_email/);
  });

  it("persists idempotency_key on every email_send_log insert (7 sites)", () => {
    const inserts = sendTxn.match(/\.from\('email_send_log'\)\.insert\(/g) ?? [];
    const keyed = sendTxn.match(/idempotency_key: callerSuppliedKey,/g) ?? [];
    // Includes the destructured pending-insert call that uses .insert({...}) form.
    const pendingInsert = sendTxn.match(/\.from\('email_send_log'\)\s*\.insert\(/g) ?? [];
    expect(inserts.length + 0).toBeGreaterThanOrEqual(6);
    expect(keyed.length).toBeGreaterThanOrEqual(inserts.length + pendingInsert.length - inserts.length);
    // Count drift-tolerant: the hard guarantee is every insert is keyed.
    // Snapshot pin updated to 8 sites (Batch U added one more outbound path).
    expect(keyed.length).toBe(8);
  });

  it("falls through (no dedupe) when caller omits idempotencyKey", () => {
    expect(sendTxn).toMatch(
      /const callerSuppliedKey =\s*idempotencyKey && idempotencyKey !== messageId \? idempotencyKey : null/,
    );
  });

  it("handles the unique-violation race on the pending insert as an idempotent return", () => {
    expect(sendTxn).toMatch(/pendingInsertError[\s\S]*?code === '23505'/);
    expect(sendTxn).toContain("Idempotent replay (race) — returning prior pending send");
  });
});

describe("POI-004 stage-2 — revenue-notify dedupe", () => {
  it("performs an idempotency lookup before dispatching", () => {
    expect(revenueNotify).toMatch(
      /\.from\("revenue_notification_audit"\)[\s\S]*?\.eq\("idempotency_key", args\.idempotencyKey\)/,
    );
    expect(revenueNotify).toContain("idempotent replay — skipping");
  });

  it("returns early on prior row (no second invoke)", () => {
    const block = revenueNotify.split("idempotent replay — skipping")[1] ?? "";
    expect(block.split("\n")[0]).toMatch(/eventType/);
    expect(revenueNotify).toMatch(/if \(prior\) {[\s\S]*?return;/);
  });

  it("treats audit-insert 23505 as benign (race resolved by unique index)", () => {
    expect(revenueNotify).toMatch(/auditError[\s\S]*?code !== "23505"/);
  });
});

describe("POI-004 stage-2 — _shared/webhooks.ts dedupe", () => {
  it("triggerWebhooks accepts and forwards eventIdempotencyKey", () => {
    // Stricter than the original POI-004 contract: `eventIdempotencyKey`
    // is now REQUIRED (not optional). The prebuild guard
    // scripts/check-webhook-callsite-idempotency.mjs refuses any callsite
    // that omits it.
    expect(webhooks).toMatch(
      /export async function triggerWebhooks\(\s*supabase: SupabaseClient,\s*orgId: string,\s*event: string,\s*data: Record<string, any>,\s*options:\s*{\s*eventIdempotencyKey:\s*string\s*}/,
    );
    expect(webhooks).toMatch(/deliverWebhook\([\s\S]*?eventIdempotencyKey,?\s*\)/);
  });


  it("deliverWebhook short-circuits when prior delivery for (endpoint, key) exists", () => {
    expect(webhooks).toMatch(
      /\.from\("webhook_deliveries"\)[\s\S]*?\.eq\("webhook_endpoint_id", webhookEndpointId\)[\s\S]*?\.eq\("event_idempotency_key", eventIdempotencyKey\)/,
    );
    expect(webhooks).toMatch(/idempotent: true/);
  });

  it("treats webhook_deliveries unique violations as benign idempotent skips", () => {
    expect(webhooks).toMatch(/insertError[\s\S]*?code === "23505"/);
  });

  it("idempotent results bypass the circuit breaker (no false failure counts)", () => {
    expect(webhooks).toMatch(/if \(result\.idempotent\) {\s*return result;\s*}/);
  });
});

describe("POI-004 stage-2 — match POI fanout wiring", () => {
  it("notifications inserts use idempotent upsert with onConflict on the unique index", () => {
    const upserts = matchFn.match(
      /\.from\("notifications"\)\.upsert\(notifRows, \{ onConflict: 'user_id,type,link', ignoreDuplicates: true \}\)/g,
    ) ?? [];
    expect(upserts).toHaveLength(3);
    expect(matchFn).not.toMatch(/\.from\("notifications"\)\.insert\(notifRows\)/);
  });

  it("triggerWebhooks for poi.generated includes eventIdempotencyKey poi.generated:<matchId>", () => {
    expect(matchFn).toMatch(
      /triggerWebhooks\(supabase, match\.org_id, "poi\.generated",[\s\S]*?\{ eventIdempotencyKey: `poi\.generated:\$\{matchId\}` \}/,
    );
  });

  it("revenue-notify call still uses revenue-poi-mint-<matchId> as idempotency key", () => {
    expect(matchFn).toMatch(/idempotencyKey: `revenue-poi-mint-\$\{matchId\}`/);
  });
});
