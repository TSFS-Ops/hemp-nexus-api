/**
 * Batch N — API key, webhook security and integration abuse hardening.
 *
 * These are static source-contract tests (file content invariants).
 * Runtime behaviour for Deno-only modules is covered by deno test suites;
 * this vitest file guards the contracts so any regression in source code
 * fails `bunx vitest run`.
 *
 * Acceptance criteria mirrored from the Batch N approved scope:
 *   1.  revoked key rejected with audit
 *   2.  expired key rejected by auth even before sweeper (with audit)
 *   3.  api_key.revoked_use_attempt audit emitted
 *   4.  api_key.expired_use_attempt audit emitted
 *   5.  apiKeyCreateSchema rejects unknown scope
 *   6.  apiKeyCreateSchema rejects '*' and 'admin'
 *   7.  read scope does NOT satisfy write scope (no naked-parent grant)
 *   8.  api_key.scope_denied audit emitted
 *   9.  allowed_ips null = unrestricted (back-compat preserved)
 *  10.  configured allowed_ips blocks mismatched IP (audited)
 *  11.  configured allowed_origins blocks mismatched Origin (audited)
 *  12.  api_key.ip_blocked / api_key.origin_blocked audits emitted
 *  13.  rate limit returns 429 + Retry-After
 *  14.  rate limit writes api_key.rate_limited / webhook.rate_limited audit
 *  15.  audit metadata carries actor_ip / user_agent
 *  16.  webhook GET endpoints never return secret_hash / previous_secret_hash
 *  17.  webhook rotate returns the new secret exactly once
 *  18.  verifier accepts previous secret during grace window
 *  19.  verifier rejects previous secret after grace expiry
 *  20.  webhook_deliveries does NOT store X-Webhook-Signature / plaintext secret
 *  21.  pre-existing one-time reveal UI/docs still pass (covered elsewhere)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const auth = readFileSync("supabase/functions/_shared/auth.ts", "utf8");
const validation = readFileSync(
  "supabase/functions/_shared/validation.ts",
  "utf8",
);
const apiScopes = readFileSync(
  "supabase/functions/_shared/api-scopes.ts",
  "utf8",
);
const securityAudit = readFileSync(
  "supabase/functions/_shared/security-audit.ts",
  "utf8",
);
const rateLimit = readFileSync(
  "supabase/functions/_shared/rate-limit.ts",
  "utf8",
);
const apiKeysFn = readFileSync(
  "supabase/functions/api-keys/index.ts",
  "utf8",
);
const webhooksFn = readFileSync(
  "supabase/functions/webhooks/index.ts",
  "utf8",
);
const sharedWebhooks = readFileSync(
  "supabase/functions/_shared/webhooks.ts",
  "utf8",
);

describe("Batch N — SEC-006 revoked/expired key use", () => {
  it("authenticateApiKey queries keys without a status filter so revoked/expired keys can be classified", () => {
    // The legacy implementation hard-filtered .eq('status', 'active')
    // which made revoked/expired use invisible. The new query selects
    // status + expires_at so we can detect and audit misuse.
    expect(auth).toMatch(/from\('api_keys'\)\s*\n\s*\.select\([^)]*status[^)]*expires_at/);
    expect(auth).not.toMatch(/from\('api_keys'\)\s*\n\s*\.select\([^)]+\)\s*\n\s*\.eq\('status',\s*'active'\);/);
  });

  it("emits api_key.revoked_use_attempt audit and rejects generic UNAUTHORIZED", () => {
    expect(auth).toMatch(/api_key\.revoked_use_attempt/);
    expect(auth).toMatch(/GENERIC_UNAUTHORIZED/);
    expect(auth).toMatch(/'Invalid API key'/);
  });

  it("performs live expires_at check independent of the sweeper", () => {
    expect(auth).toMatch(/matchedKey\.expires_at/);
    expect(auth).toMatch(/api_key\.expired_use_attempt/);
  });

  it("audit metadata is best-effort (never blocks response)", () => {
    expect(securityAudit).toMatch(/catch \(e\) \{[\s\S]*?console\.error/);
  });
});

describe("Batch N — SEC-007 scope tightening", () => {
  it("VALID_SCOPES catalogue exists and forbids '*' / 'admin' / ''", () => {
    expect(apiScopes).toMatch(/export const VALID_SCOPES/);
    expect(apiScopes).toMatch(/FORBIDDEN_SCOPES[\s\S]*"\*"[\s\S]*"admin"[\s\S]*""/);
  });

  it("validateAndNormaliseScopes rejects unknown scopes and de-duplicates", () => {
    expect(apiScopes).toMatch(/unknown scope/);
    expect(apiScopes).toMatch(/seen\.has\(s\)/);
  });

  it("apiKeyCreateSchema delegates to validateAndNormaliseScopes (not raw strings)", () => {
    expect(validation).toMatch(/validateAndNormaliseScopes/);
    expect(validation).toMatch(/allowed_ips/);
    expect(validation).toMatch(/allowed_origins/);
  });

  it("requireScope uses exact-match via scopeSatisfies and removes legacy startsWith grant", () => {
    expect(auth).toMatch(/scopeSatisfies\(ctx\.roles,\s*scope\)/);
    expect(auth).not.toMatch(/r\.startsWith\(`\$\{scope\}:`\)/);
  });

  it("scopeSatisfies requires exact match OR explicit `${parent}:*` wildcard", () => {
    expect(apiScopes).toMatch(/held\.endsWith\(":\*"\)/);
    // and the read-vs-write asymmetry is explicit
    expect(apiScopes).toMatch(/exact-match scope check/);
  });

  it("scope denials are audited via api_key.scope_denied", () => {
    expect(auth).toMatch(/api_key\.scope_denied/);
  });
});

describe("Batch N — SEC-008 IP/origin allowlists", () => {
  it("api_keys schema has allowed_ips and allowed_origins fields wired through auth", () => {
    expect(auth).toMatch(/allowed_ips/);
    expect(auth).toMatch(/allowed_origins/);
  });

  it("null/empty allowlists keep existing keys unrestricted", () => {
    expect(auth).toMatch(/allowedIps && allowedIps\.length > 0/);
    expect(auth).toMatch(/allowedOrigins && allowedOrigins\.length > 0/);
  });

  it("mismatched IP/Origin emits audits and returns generic 401", () => {
    expect(auth).toMatch(/api_key\.ip_blocked/);
    expect(auth).toMatch(/api_key\.origin_blocked/);
  });

  it("api-keys edge function accepts allowed_ips and allowed_origins on create", () => {
    expect(apiKeysFn).toMatch(/allowed_ips,\s*allowed_origins/);
    expect(apiKeysFn).toMatch(/allowed_ips:\s*allowed_ips/);
    expect(apiKeysFn).toMatch(/allowed_origins:\s*allowed_origins/);
  });
});

describe("Batch N — Required Fix 4: actor_ip / user_agent in audit metadata", () => {
  it("AuthContext carries actorIp / userAgent / origin / requestId", () => {
    expect(auth).toMatch(/actorIp\?:\s*string\s*\|\s*null/);
    expect(auth).toMatch(/userAgent\?:\s*string\s*\|\s*null/);
    expect(auth).toMatch(/origin\?:\s*string\s*\|\s*null/);
  });

  it("api-keys CRUD audits include actor_ip / user_agent", () => {
    const occurrences = (apiKeysFn.match(/actor_ip:\s*authCtx\.actorIp/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4); // created, rotated, renamed, revoked
  });

  it("webhooks CRUD audits include actor_ip / user_agent", () => {
    const occurrences = (webhooksFn.match(/actor_ip:\s*authCtx\.actorIp/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4); // created, updated, rotated, deleted
  });
});

describe("Batch N — SEC-010 rate-limit audit", () => {
  it("checkRateLimit writes audit on every 429 trip", () => {
    expect(rateLimit).toMatch(/rateLimitAuditAction/);
    expect(rateLimit).toMatch(/api_key\.rate_limited/);
    expect(rateLimit).toMatch(/webhook\.rate_limited/);
    expect(rateLimit).toMatch(/auditTrip\("minute"/);
    expect(rateLimit).toMatch(/auditTrip\("hour"/);
    expect(rateLimit).toMatch(/auditTrip\("day"/);
  });

  it("429 still includes Retry-After in error options", () => {
    expect(rateLimit).toMatch(/retryAfter:\s*resetTime/);
    expect(rateLimit).toMatch(/\{\s*retryAfter\s*\}/);
  });

  it("in-memory circuit breaker is documented as advisory only (DB is authoritative)", () => {
    expect(rateLimit).toMatch(/in-memory breaker is per edge/);
    expect(rateLimit).toMatch(/AUTHORITATIVE/);
  });
});

describe("Batch N — SEC-009 webhook secret hygiene", () => {
  it("GET /webhooks list does NOT select secret_hash or previous_secret_hash", () => {
    // List query (the .select for GET /):
    const listMatch = webhooksFn.match(
      /GET \/ - List webhook endpoints[\s\S]*?\.select\(\s*"([^"]+)"/,
    );
    expect(listMatch).not.toBeNull();
    expect(listMatch![1]).not.toMatch(/secret_hash/);
    // GET /:id query
    const detailMatch = webhooksFn.match(
      /GET \/:id - Get webhook endpoint[\s\S]*?\.select\(\s*"([^"]+)"/,
    );
    expect(detailMatch).not.toBeNull();
    expect(detailMatch![1]).not.toMatch(/secret_hash/);
  });

  it("rotate returns plaintext secret exactly once", () => {
    // The rotate JSON.stringify block surfaces `secret: newSecret` once.
    const rotateMatches = webhooksFn.match(/secret:\s*newSecret/g) || [];
    expect(rotateMatches.length).toBe(1);
  });

  it("verifyWebhookSignatureWithGrace exists with expiry enforcement", () => {
    expect(sharedWebhooks).toMatch(/verifyWebhookSignatureWithGrace/);
    expect(sharedWebhooks).toMatch(/expiresAt\s*>\s*Date\.now\(\)/);
    expect(sharedWebhooks).toMatch(/usedPrevious:\s*true/);
  });

  it("webhook_deliveries insert does NOT persist X-Webhook-Signature header or plaintext secret", () => {
    // The insert payload schema in shared/webhooks.ts:
    const insertSlice = sharedWebhooks.match(
      /\.from\("webhook_deliveries"\)\.insert\(\{[\s\S]*?\}\)/g,
    );
    expect(insertSlice).not.toBeNull();
    for (const slice of insertSlice!) {
      expect(slice).not.toMatch(/X-Webhook-Signature/i);
      expect(slice).not.toMatch(/\bsignature\b/);
      expect(slice).not.toMatch(/\bsecret\b/);
    }
  });
});

describe("Batch N — security-audit shared module", () => {
  it("exposes the canonical action vocabulary", () => {
    for (const action of [
      "api_key.revoked_use_attempt",
      "api_key.expired_use_attempt",
      "api_key.scope_denied",
      "api_key.ip_blocked",
      "api_key.origin_blocked",
      "api_key.rate_limited",
      "webhook.rate_limited",
      "webhook.signature_failure",
    ]) {
      expect(securityAudit).toContain(action);
    }
  });

  it("never includes plaintext key / secret in audit payloads", () => {
    expect(securityAudit).not.toMatch(/\bapiKey\b/);
    // metadata is the only carrier; no raw `key:` or `secret:` fields
    const insertBlock = securityAudit.match(/insert\(\{[\s\S]*?\}\)/)!;
    expect(insertBlock[0]).not.toMatch(/\bsecret\b/);
  });
});
