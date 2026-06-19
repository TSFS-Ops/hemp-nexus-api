/**
 * Public API V1 · Batch 10 — Single source-of-truth specification.
 *
 * This module is the ONLY place where the public-facing description of
 * Public API V1 lives. Both endpoints introduced in Batch 10 read from
 * here:
 *
 *   • GET /v1/docs              → renders readable HTML from this spec
 *   • GET /v1/docs/openapi.json → serves the JSON spec directly
 *
 * Drift guard: the readable docs MUST NOT introduce endpoints, scopes,
 * error codes, or limits that are absent from this spec. Tests in
 * src/tests/public-api-v1-batch10-docs-openapi.test.ts enforce that
 * every currently-available endpoint listed below appears in both
 * surfaces, and that no deferred endpoint is described as available.
 *
 * Hard exclusions for Batch 10 — kept in this module so they cannot be
 * accidentally over-stated by the docs HTML:
 *   • no support-ticket intake
 *   • no payment collection / invoices
 *   • no PayFast / Paystack changes
 *   • no webhook changes
 *   • no write APIs
 *   • no evidence / document downloads
 *   • no POI / WaD actions
 *   • no automatic verification / payment / credit / compliance decisions
 *   • no self-serve signup
 *   • no OAuth
 *   • no public lookup / search
 */

export const V1_API_TITLE = "Izenzo Public API V1";
export const V1_API_VERSION = "1.0.0";

// Canonical base URLs — kept identical in the OpenAPI `servers` array and
// in the readable HTML. Sandbox and production are hard-separated.
export const V1_SANDBOX_BASE_URL = "https://api-sandbox.trade.izenzo.co.za/v1";
export const V1_PRODUCTION_BASE_URL = "https://api.trade.izenzo.co.za/v1";

// Required legal warning — exact wording. Tests assert this string is
// present in both the readable docs and the OpenAPI description.
export const V1_LEGAL_WARNING = "API responses provide Izenzo status and risk signals based on available records at the time of the request. They are not legal advice, not a bank-payment guarantee, not a compliance clearance, not a credit decision, and not a substitute for the client’s own approval process unless expressly agreed in writing. No API response creates a POI, WaD, verified status, or binding transaction approval by itself.";

// Batch 9 — exact warning wording mandated by client sign-off. These are
// rendered verbatim in the readable docs.
export const V1_SANDBOX_WARNING = "Sandbox records are fictional test records. Sandbox responses, statuses, errors, webhooks and usage reports must not be used for live business decisions, compliance decisions, payment decisions or counterparty approvals.";
export const V1_PRODUCTION_WARNING = "Production API responses provide Izenzo status and risk signals based on available records and approved response fields. They are not legal advice, not a payment guarantee, not a compliance clearance, not a bank-account verification guarantee and not a substitute for the client’s own approval process unless separately agreed in writing. No API response automatically creates a POI, issues a WaD, clears a compliance block or approves a transaction.";

export const V1_SUPPORT_TEXT =
  "Support for API issues is available via the in-product API Support tab " +
  "in the Developer Centre. Authorised client admins can raise tickets for " +
  "authentication, sandbox, production, rate-limit, monthly-limit, " +
  "unexpected-response, outage, billing-visibility, documentation or other " +
  "API issues. Tickets are visible only to your own API client and to " +
  "authorised Izenzo internal staff; internal notes are never shown to " +
  "client users. There is no public /v1/support endpoint and there is no " +
  "live chat or 24/7 human support guarantee. You may also contact your " +
  "Izenzo account owner or Izenzo support outside the app.";

// Canonical scope catalogue — kept aligned with _shared/api-scopes.ts.
export const V1_SCOPE_CATALOGUE: Array<{ scope: string; description: string }> = [
  { scope: "api:status_read",        description: "Read gateway health, status, documentation and OpenAPI spec." },
  { scope: "counterparty:lookup",    description: "Submit a structured counterparty lookup request." },
  { scope: "counterparty:summary_read", description: "Retrieve a previously-returned counterparty summary by id." },
  { scope: "profile:summary_read",   description: "Compatibility alias for counterparty:summary_read." },
  { scope: "signals:read",           description: "Compatibility/supporting scope — receive signal-bearing fields (risk_signal_summary, verification_status) in lookup and summary responses. Required IN ADDITION to counterparty:lookup or summary scopes." },
  { scope: "usage:read",             description: "Read your own usage figures via approved surfaces (dashboard / internal channels). No public /v1/usage endpoint exists in V1." },
  { scope: "webhook:test",           description: "Trigger sandbox webhook test deliveries against a registered sandbox endpoint." },
  { scope: "webhook:events_read",    description: "Read your own webhook delivery records via approved surfaces." },
];

// Scopes that are explicitly forbidden in V1 and will be rejected at
// key-issuance time. Kept aligned with _shared/api-scopes.ts.
export const V1_FORBIDDEN_SCOPES: string[] = [
  "write:*",
  "admin:*",
  "evidence_export",
  "governance_record_write",
  "verification_override",
  "payment_approve",
  "compliance_clearance",
  "poi:create",
  "wad:issue",
  "document_upload",
  "bank_detail_change",
  "client_data_export",
];


// Currently AVAILABLE endpoints. Every entry here is also surfaced in
// the OpenAPI `paths` object and the readable HTML.
export interface V1EndpointDescriptor {
  method: "GET" | "POST";
  path: string;                    // public path, e.g. "/v1/health"
  summary: string;
  scopes: string[];                // required scopes (all must be held)
  billable: boolean;               // counts toward the monthly allowance
  notes?: string;
}

export const V1_AVAILABLE_ENDPOINTS: V1EndpointDescriptor[] = [
  {
    method: "GET",
    path: "/v1/health",
    summary: "Liveness probe for the V1 gateway.",
    scopes: ["api:status_read"],
    billable: false,
  },
  {
    method: "GET",
    path: "/v1/status",
    summary: "Echo current API key status, scopes, environment and expiry.",
    scopes: ["api:status_read"],
    billable: false,
  },
  {
    method: "POST",
    path: "/v1/counterparty/lookup",
    summary: "Structured counterparty lookup against the approved signal layer.",
    scopes: ["counterparty:lookup", "signals:read"],
    billable: true,
    notes: "Sandbox calls read fictional test records only and are NEVER billable. Production calls are conservative in this release: when no approved production source is wired, the response is `no_match` and the call remains non-billable.",
  },
  {
    method: "GET",
    path: "/v1/counterparty/{id}/summary",
    summary: "Retrieve a previously-returned counterparty summary by id.",
    scopes: ["profile:summary_read", "signals:read"],
    billable: true,
    notes: "Sandbox returns only sandbox-seeded records; production is conservative — see lookup notes.",
  },
  {
    method: "GET",
    path: "/v1/docs",
    summary: "Readable HTML documentation for Public API V1.",
    scopes: ["api:status_read"],
    billable: false,
  },
  {
    method: "GET",
    path: "/v1/docs/openapi.json",
    summary: "Machine-readable OpenAPI 3.1 specification.",
    scopes: ["api:status_read"],
    billable: false,
  },
  {
    method: "GET",
    path: "/v1/test/error/{code}",
    summary: "Sandbox-only deterministic error simulator. Production hosts return sandbox_endpoint_required.",
    scopes: ["api:status_read"],
    billable: false,
    notes:
      "Allowed codes: invalid_api_key, expired_api_key, insufficient_scope, missing_required_field, invalid_country, rate_limit_exceeded, provider_unavailable, internal_error_simulated. " +
      "Note: invalid_api_key and expired_api_key simulations still require a valid sandbox key — they exercise the response shape without weakening real authentication.",
  },
];


// Endpoints that have been DELIBERATELY DEFERRED. The docs must list
// these as "not available yet" — never as available.
export const V1_DEFERRED_ENDPOINTS: Array<{ path: string; reason: string }> = [
  { path: "/v1/usage/current",          reason: "Use the client usage dashboard. No public usage endpoint in V1." },
  { path: "Write APIs",                 reason: "V1 is read-only." },
  { path: "Webhooks",                   reason: "Webhook surface is not part of V1." },
  { path: "Evidence / document downloads", reason: "Never exposed via the public API." },
  { path: "POI / WaD actions",          reason: "Governance state changes are not exposed via the public API." },
  { path: "Automatic verification / payment / compliance / credit decisions", reason: "Out of scope for V1." },
  { path: "Self-serve signup",          reason: "Approved institutional onboarding only." },
  { path: "OAuth",                      reason: "X-API-Key only in V1." },
  { path: "Public lookup / search",     reason: "All endpoints require an approved API key." },
  { path: "Invoices / payment collection", reason: "Billing is estimate-visibility only in V1." },
];

// Canonical V1 error catalogue (mirrors _shared/public-api-v1.ts).
// Kept here so the docs cannot drift from the gateway.
export const V1_ERROR_CATALOGUE: Array<{ code: string; http: number; description: string }> = [
  { code: "invalid_api_key",            http: 401, description: "API key is missing or not recognised." },
  { code: "expired_api_key",            http: 401, description: "API key has passed its expiry date." },
  { code: "insufficient_scope",         http: 403, description: "API key does not hold a scope required for this endpoint." },
  { code: "suspended_key",              http: 401, description: "API key (or its api_client) is suspended." },
  { code: "revoked_key",                http: 401, description: "API key (or its api_client) is revoked." },
  { code: "missing_required_field",     http: 400, description: "A required header or body field is missing." },
  { code: "invalid_country",            http: 400, description: "The country value is not a valid ISO-3166 alpha-2 code." },
  { code: "unsupported_country",        http: 400, description: "Country is not covered by this API client." },
  { code: "invalid_identifier_format",  http: 400, description: "An identifier (e.g. lookup id) is malformed." },
  { code: "rate_limit_exceeded",        http: 429, description: "Per-minute or concurrency limit hit. See Retry-After." },
  { code: "monthly_limit_reached",      http: 429, description: "Monthly request allowance has been reached for this api_client + environment." },
  { code: "sandbox_record_only",        http: 403, description: "A sandbox-only record was requested with a production key." },
  { code: "production_access_required", http: 403, description: "Production access is required for this resource." },
  { code: "no_match",                   http: 404, description: "No matching record was found." },
  { code: "multiple_possible_matches",  http: 409, description: "More than one possible match — refine the request." },
  { code: "provider_unavailable",       http: 502, description: "A downstream provider is temporarily unavailable." },
  { code: "timeout",                    http: 504, description: "The request timed out." },
  { code: "internal_error",             http: 500, description: "An internal error occurred. Stack traces are never exposed." },
];

// Default limits — kept aligned with public-api-v1-usage.ts defaults.
// Note: Batch 6 split limits by environment. The values below reflect the
// per-environment defaults documented to clients.
export const V1_ENV_LIMITS = {
  sandbox: {
    requests_per_minute_per_key: 30,
    monthly_requests: 1_000,
    concurrent_requests_per_key: 10,
    billable: false,
  },
  production: {
    requests_per_minute_per_key: 60,
    default_monthly_lookups: 5_000,
    concurrent_requests_per_key: 3,
    billable_note: "Billable production lookup calls may consume tokens/credits. Health/docs are non-billable. Overage continues only if the contract permits; threshold events fire at 80/100/120% of the monthly allowance.",
  },
} as const;

// Required sandbox test records (Batch 9 § Sandbox test cases). Tests
// assert that all six are surfaced in the readable docs.
export const V1_SANDBOX_TEST_RECORDS: Array<{
  legal_name: string;
  country_code: string;
  registration_number?: string;
  company_name?: string;
  expected: string;
}> = [
  { legal_name: "TEST Verified Energy (Pty) Ltd",   country_code: "ZA", registration_number: "TEST-2019-000001", expected: "verified_match" },
  { legal_name: "TEST Unverified Trading Ltd",      country_code: "ZA", registration_number: "TEST-2019-000002", expected: "unverified_match" },
  { legal_name: "TEST No Match Holdings",           country_code: "ZA", registration_number: "TEST-NOMATCH",     expected: "no_match" },
  { legal_name: "TEST Duplicate Supplies Ltd",      country_code: "ZA", company_name: "TEST Duplicate Supplies", expected: "multiple_possible_matches" },
  { legal_name: "TEST Blocked Entity Ltd",          country_code: "ZA", registration_number: "TEST-BLOCKED",     expected: "blocked_record" },
  { legal_name: "TEST Stale Agrivoltaics Ltd",      country_code: "ZA", registration_number: "TEST-STALE",       expected: "stale_record" },
];

// Webhook contract surfaced in docs (Batch 7 signing/retry rules).
export const V1_WEBHOOK_DOCS = {
  signing_headers: [
    "X-Izenzo-Signature",
    "X-Izenzo-Timestamp",
    "X-Izenzo-Event-Id",
    "X-Izenzo-Webhook-Version: v1",
  ],
  signature_algorithm: "HMAC-SHA256 over `timestamp.payload`",
  retry_schedule: ["initial", "+1 minute", "+5 minutes", "+30 minutes", "then webhook.delivery_failed"],
  production_requires_sandbox_test_pass: true,
  payload_exclusions: [
    "raw documents",
    "internal notes",
    "identity documents",
    "raw bank details",
    "evidence packs",
    "another client's data",
  ],
} as const;

// Key lifecycle rules surfaced in docs (Batch 3).
export const V1_KEY_LIFECYCLE_DOCS = {
  sandbox_expiry_days: 90,
  production_expiry_months: 12,
  production_expiry_warning_days: [30, 14, 3] as const,
  raw_secret_visibility: "shown_once_only",
  rotation_returns_new_secret_once: true,
  suspended_revoked_expired_rejected: true,
  production_actions_require_authorised_admin: true,
} as const;

// Hard first-version exclusions surfaced in docs. Tests assert the
// readable docs name each of these as "not supported".
export const V1_FIRST_VERSION_EXCLUSIONS: string[] = [
  "write APIs",
  "public self-serve API signup",
  "browser/mobile direct API use",
  "OAuth/SSO",
  "evidence pack download through API",
  "automatic verification decisions",
  "automatic compliance clearance",
  "automatic payment approval",
  "automatic POI creation",
  "automatic WaD issuance",
  "real-time streaming",
  "bulk export",
];

// Sandbox-only response fields. These never appear in production
// responses. Documented so client integrations can branch safely.
export const V1_SANDBOX_ONLY_RESPONSE_FIELDS: string[] = [
  "test_record",
  "sandbox_case_id",
  "simulated_provider",
];

// Back-compatible aggregate of the per-environment limits (Batch 6).
// Kept so the readable HTML and OpenAPI `x-izenzo` metadata can render
// production defaults in one place. Sandbox values are reported via
// V1_ENV_LIMITS.sandbox.
export const V1_LIMITS = {
  requests_per_minute_per_key: V1_ENV_LIMITS.production.requests_per_minute_per_key,
  concurrent_requests_per_key: V1_ENV_LIMITS.production.concurrent_requests_per_key,
  default_monthly_production_lookups: V1_ENV_LIMITS.production.default_monthly_lookups,
  default_monthly_sandbox_requests: V1_ENV_LIMITS.sandbox.monthly_requests,
  threshold_notifications_percent: [80, 100, 120] as const,
};

// ─── OpenAPI 3.1 spec builder ─────────────────────────────────────────────
export function buildOpenApiSpec(_serverUrlIgnored?: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  const errorSchemaRef = { $ref: "#/components/schemas/ErrorEnvelope" };
  const securityReq = [{ ApiKeyAuth: [] }];

  const sharedHeaders = {
    "X-Izenzo-Environment": {
      name: "X-Izenzo-Environment",
      in: "header",
      required: true,
      description: "Target environment. Must be `sandbox` or `production`. Sandbox and production API keys are separate.",
      schema: { type: "string", enum: ["sandbox", "production"] },
    },
    "X-External-Reference": {
      name: "X-External-Reference",
      in: "header",
      required: false,
      description: "Optional client-supplied correlation identifier; echoed in logs only.",
      schema: { type: "string", maxLength: 128 },
    },
  } as const;

  // Response headers stamped on every V1 response — successful and error.
  const responseHeaders = {
    "X-Izenzo-Environment": {
      description: "Echo of the resolved environment for this request (`sandbox` or `production`). Host-derived environment wins over any header value.",
      schema: { type: "string", enum: ["sandbox", "production"] },
    },
    "X-Izenzo-Request-Id": {
      description: "Request identifier (UUIDv4). Also returned in the response body.",
      schema: { type: "string", format: "uuid" },
    },
  } as const;

  const stdResponses = (extra: Record<string, unknown>) => ({
    "400": { description: "missing_required_field / invalid_country / unsupported_country / invalid_identifier_format", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    "401": { description: "invalid_api_key / expired_api_key / suspended_key / revoked_key", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    "403": { description: "insufficient_scope / sandbox_record_only / production_access_required / sandbox_endpoint_required", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    "404": { description: "no_match", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    "409": { description: "multiple_possible_matches", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    "429": { description: "rate_limit_exceeded / monthly_limit_reached", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    "500": { description: "internal_error", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    "502": { description: "provider_unavailable", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    "504": { description: "timeout", headers: responseHeaders, content: { "application/json": { schema: errorSchemaRef } } },
    ...extra,
  });

  for (const ep of V1_AVAILABLE_ENDPOINTS) {
    const op: Record<string, unknown> = {
      summary: ep.summary,
      description:
        (ep.notes ? ep.notes + "\n\n" : "") +
        `Required scopes: ${ep.scopes.join(", ")}. ` +
        (ep.billable ? "Successful production calls are billable." : "Not billable."),
      security: securityReq,
      parameters: [sharedHeaders["X-Izenzo-Environment"], sharedHeaders["X-External-Reference"]],
      responses: stdResponses({
        "200": {
          description: "OK",
          headers: responseHeaders,
          content: { "application/json": { schema: responseSchemaFor(ep) } },
        },
      }),
    };

    if (ep.method === "POST" && ep.path === "/v1/counterparty/lookup") {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/LookupRequest" } } },
      };
    }
    const key = ep.path;
    paths[key] = paths[key] || {};
    paths[key][ep.method.toLowerCase()] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: V1_API_TITLE,
      version: V1_API_VERSION,
      description:
        "Izenzo Public API V1 is a governed, server-to-server institutional signal API for approved clients.\n\n" +
        "LEGAL WARNING: " + V1_LEGAL_WARNING + "\n\n" +
        "This API does NOT: collect payment, issue invoices, modify webhooks, " +
        "expose evidence or governance trails, create POI/WaD records, perform " +
        "automatic verification / payment / credit / compliance decisions, " +
        "support self-serve signup, support OAuth, or support public lookup.",
      contact: { name: "Izenzo Support" },
    },
    servers: [
      { url: V1_SANDBOX_BASE_URL,    description: "Public API V1 — Sandbox (fictional test records, non-billable)." },
      { url: V1_PRODUCTION_BASE_URL, description: "Public API V1 — Production (read-only in V1; production access requires approval)." },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "Approved institutional API key. Sandbox and production keys are issued separately. Sandbox keys cannot reach production routes; production keys cannot reach sandbox-only routes. Keys are prefixed `sk_` and the raw secret is shown once only.",
        },
      },
      schemas: {
        ErrorEnvelope: {

          type: "object",
          required: ["request_id", "error_code", "message", "timestamp"],
          properties: {
            request_id: { type: "string", format: "uuid" },
            error_code: { type: "string", enum: V1_ERROR_CATALOGUE.map((e) => e.code) },
            message: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
            retry_after: { type: ["integer", "null"], minimum: 0 },
          },
        },
        HealthResponse: {
          type: "object",
          properties: {
            request_id: { type: "string", format: "uuid" },
            environment: { type: "string", enum: ["sandbox", "production"] },
            status: { type: "string", enum: ["ok"] },
            service: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
        StatusResponse: {
          type: "object",
          properties: {
            request_id: { type: "string", format: "uuid" },
            environment: { type: "string", enum: ["sandbox", "production"] },
            api_client_status: { type: ["string", "null"] },
            key_status: { type: "string" },
            scopes: { type: "array", items: { type: "string" } },
            expires_at: { type: ["string", "null"], format: "date-time" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
        LookupRequest: {
          type: "object",
          description: "At least one identifying combination is required: (legal_name + country) OR (registration_number + country).",
          properties: {
            legal_name: { type: "string", maxLength: 255 },
            registration_number: { type: "string", maxLength: 64 },
            country: { type: "string", description: "ISO-3166 alpha-2", minLength: 2, maxLength: 2 },
            external_reference: { type: "string", maxLength: 128 },
          },
        },
        LookupResponse: {
          type: "object",
          properties: {
            request_id: { type: "string", format: "uuid" },
            environment: { type: "string" },
            match_status: { type: "string", enum: ["match", "no_match", "multiple_possible_matches"] },
            counterparty_id: { type: ["string", "null"], format: "uuid" },
            legal_name: { type: ["string", "null"] },
            country: { type: ["string", "null"] },
            verification_status: { type: ["string", "null"], description: "Allowlisted signal label. Never raw internal state." },
            risk_signal_summary: { type: ["string", "null"], description: "Allowlisted high-level signal. Never internal notes." },
            test_data: { type: "boolean", description: "True for any sandbox response." },
            test_record: { type: "boolean", description: "Sandbox-only marker. Never present in production responses." },
            sandbox_case_id: { type: ["string", "null"], description: "Sandbox-only deterministic scenario code (e.g. TEST-2019-000001). Never present in production responses." },
            simulated_provider: { type: ["string", "null"], description: "Sandbox-only label of the simulated upstream provider. Never present in production responses." },
            timestamp: { type: "string", format: "date-time" },
          },
        },
        SummaryResponse: {
          type: "object",
          properties: {
            request_id: { type: "string", format: "uuid" },
            environment: { type: "string" },
            counterparty_id: { type: "string", format: "uuid" },
            legal_name: { type: "string" },
            country: { type: "string" },
            verification_status: { type: ["string", "null"] },
            risk_signal_summary: { type: ["string", "null"] },
            test_data: { type: "boolean" },
            test_record: { type: "boolean", description: "Sandbox-only marker. Never present in production responses." },
            sandbox_case_id: { type: ["string", "null"], description: "Sandbox-only deterministic scenario code. Never present in production responses." },
            simulated_provider: { type: ["string", "null"], description: "Sandbox-only label. Never present in production responses." },
            timestamp: { type: "string", format: "date-time" },
          },
        },

        MultipleMatchesResponse: {
          type: "object",
          properties: {
            request_id: { type: "string", format: "uuid" },
            environment: { type: "string" },
            match_status: { type: "string", enum: ["multiple_possible_matches"] },
            candidates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  counterparty_id: { type: "string", format: "uuid" },
                  legal_name: { type: "string" },
                  country: { type: "string" },
                },
              },
            },
            timestamp: { type: "string", format: "date-time" },
          },
        },
      },
    },
    security: securityReq,
    paths,
    "x-izenzo": {
      legal_warning: V1_LEGAL_WARNING,
      sandbox_warning: V1_SANDBOX_WARNING,
      production_warning: V1_PRODUCTION_WARNING,
      support: V1_SUPPORT_TEXT,
      scopes: V1_SCOPE_CATALOGUE,
      forbidden_scopes: V1_FORBIDDEN_SCOPES,
      limits: V1_LIMITS,
      env_limits: V1_ENV_LIMITS,
      sandbox_test_records: V1_SANDBOX_TEST_RECORDS,
      sandbox_only_response_fields: V1_SANDBOX_ONLY_RESPONSE_FIELDS,
      webhook_docs: V1_WEBHOOK_DOCS,
      key_lifecycle: V1_KEY_LIFECYCLE_DOCS,
      first_version_exclusions: V1_FIRST_VERSION_EXCLUSIONS,
      deferred_endpoints: V1_DEFERRED_ENDPOINTS,
      error_catalogue: V1_ERROR_CATALOGUE,
      production_read_only: true,
      sandbox_data_is_fictional: true,
      sandbox_usage_non_billable: true,
      no_response_creates_poi_wad_compliance_payment: true,
      billing_visibility: {
        model: "estimate_only",
        notes: "All amounts shown via dashboards or status surfaces are estimates only. V1 does NOT issue invoices and does NOT collect payment. Only successful production lookup/summary calls are billable.",
      },
    },

  };
}

function responseSchemaFor(ep: V1EndpointDescriptor): Record<string, unknown> {
  if (ep.path === "/v1/health") return { $ref: "#/components/schemas/HealthResponse" };
  if (ep.path === "/v1/status") return { $ref: "#/components/schemas/StatusResponse" };
  if (ep.path === "/v1/counterparty/lookup") {
    return {
      oneOf: [
        { $ref: "#/components/schemas/LookupResponse" },
        { $ref: "#/components/schemas/MultipleMatchesResponse" },
      ],
    };
  }
  if (ep.path === "/v1/counterparty/{id}/summary") return { $ref: "#/components/schemas/SummaryResponse" };
  if (ep.path === "/v1/docs") return { type: "string", description: "HTML document" };
  if (ep.path === "/v1/docs/openapi.json") return { type: "object", description: "OpenAPI 3.1 JSON spec" };
  if (ep.path === "/v1/test/error/{code}") return { $ref: "#/components/schemas/ErrorEnvelope" };
  return { type: "object" };
}


// ─── Readable HTML renderer (drift-guarded by buildOpenApiSpec source) ───
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

export function buildReadableDocsHtml(serverUrl: string): string {
  const scopeRows = V1_SCOPE_CATALOGUE
    .map((s) => `<tr><td><code>${esc(s.scope)}</code></td><td>${esc(s.description)}</td></tr>`)
    .join("");
  const epRows = V1_AVAILABLE_ENDPOINTS
    .map((e) => `<tr><td><code>${esc(e.method)}</code></td><td><code>${esc(e.path)}</code></td><td>${esc(e.summary)}</td><td><code>${esc(e.scopes.join(", "))}</code></td><td>${e.billable ? "yes (prod success only)" : "no"}</td></tr>`)
    .join("");
  const errRows = V1_ERROR_CATALOGUE
    .map((e) => `<tr><td><code>${esc(e.code)}</code></td><td>${e.http}</td><td>${esc(e.description)}</td></tr>`)
    .join("");
  const deferredRows = V1_DEFERRED_ENDPOINTS
    .map((d) => `<li><strong>${esc(d.path)}</strong> — ${esc(d.reason)}</li>`)
    .join("");
  const forbiddenRows = V1_FORBIDDEN_SCOPES
    .map((s) => `<li><code>${esc(s)}</code></li>`)
    .join("");
  const sandboxRecordRows = V1_SANDBOX_TEST_RECORDS
    .map((r) => `<tr><td>${esc(r.legal_name)}</td><td><code>${esc(r.country_code)}</code></td><td><code>${esc(r.registration_number || "")}</code></td><td><code>${esc(r.company_name || "")}</code></td><td><code>${esc(r.expected)}</code></td></tr>`)
    .join("");
  const sandboxErrorCodes = [
    "invalid_api_key",
    "expired_api_key",
    "insufficient_scope",
    "missing_required_field",
    "invalid_country",
    "rate_limit_exceeded",
    "provider_unavailable",
    "internal_error_simulated",
  ];
  const sandboxErrorRows = sandboxErrorCodes
    .map((c) => `<li><code>${esc(c)}</code></li>`)
    .join("");
  const exclusionRows = V1_FIRST_VERSION_EXCLUSIONS
    .map((e) => `<li>${esc(e)}</li>`)
    .join("");
  const webhookHeaderRows = V1_WEBHOOK_DOCS.signing_headers
    .map((h) => `<li><code>${esc(h)}</code></li>`)
    .join("");
  const retryRows = V1_WEBHOOK_DOCS.retry_schedule
    .map((r) => `<li>${esc(r)}</li>`)
    .join("");


  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>${esc(V1_API_TITLE)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #0F172A; max-width: 920px; margin: 32px auto; padding: 0 20px; }
  h1, h2, h3 { color: #0F172A; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin-top: 32px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; background: #F8FAFC; padding: 1px 5px; border: 1px solid #E2E8F0; border-radius: 4px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th, td { border: 1px solid #E2E8F0; padding: 6px 8px; vertical-align: top; text-align: left; }
  th { background: #F8FAFC; }
  .warn { border: 1px solid #047857; background: #ECFDF5; padding: 12px 14px; border-radius: 6px; margin: 16px 0; }
  .muted { color: #475569; font-size: 12px; }
  ul { padding-left: 20px; }
  pre { background: #0F172A; color: #F8FAFC; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
</style>
</head><body>
<h1>${esc(V1_API_TITLE)}</h1>
<div class="muted">Version ${esc(V1_API_VERSION)} · Sandbox <code>${esc(V1_SANDBOX_BASE_URL)}</code> · Production <code>${esc(V1_PRODUCTION_BASE_URL)}</code> · Active server <code>${esc(serverUrl)}</code></div>

<div class="warn"><strong>Legal warning.</strong> ${esc(V1_LEGAL_WARNING)}</div>
<div class="warn"><strong>Sandbox warning.</strong> ${esc(V1_SANDBOX_WARNING)}</div>
<div class="warn"><strong>Production warning.</strong> ${esc(V1_PRODUCTION_WARNING)}</div>

<h2>Overview</h2>
<ul>
  <li>Public API V1 is a <strong>governed institutional signal API</strong>.</li>
  <li>It is <strong>server-to-server only</strong>.</li>
  <li>It is for <strong>approved institutional clients only</strong> — no self-serve signup, no OAuth, no public search.</li>
  <li>Production access in V1 is <strong>read-only</strong> and requires approval. Sandbox data is fictional and sandbox usage is non-billable.</li>
  <li><strong>Host-derived environment wins over any header</strong>. Calling <code>${esc(V1_SANDBOX_BASE_URL)}</code> always resolves to sandbox; calling <code>${esc(V1_PRODUCTION_BASE_URL)}</code> always resolves to production. Sandbox keys do not work in production; production keys do not work on sandbox-only routes.</li>
</ul>

<h2>Base URLs</h2>
<ul>
  <li>Sandbox: <code>${esc(V1_SANDBOX_BASE_URL)}</code></li>
  <li>Production: <code>${esc(V1_PRODUCTION_BASE_URL)}</code></li>
</ul>

  <li>Public API V1 is a <strong>governed institutional signal API</strong>.</li>
  <li>It is <strong>server-to-server only</strong>.</li>
  <li>It is for <strong>approved institutional clients only</strong> — no self-serve signup, no OAuth, no public search.</li>
</ul>

<h2>Authentication</h2>
<ul>
  <li>Header <code>X-API-Key</code> — your approved institutional API key (prefix <code>sk_</code>).</li>
  <li>Header <code>X-Izenzo-Environment</code> — required, value <code>sandbox</code> or <code>production</code>.</li>
  <li>Header <code>X-External-Reference</code> — optional correlation id, echoed in logs only.</li>
  <li>API keys are environment-specific. Sandbox keys cannot reach production data and vice versa.</li>
</ul>

<h2>Environments</h2>
<ul>
  <li><strong>Sandbox</strong> — reads only from a fictional, isolated test record set. Every sandbox response carries <code>test_data: true</code>. Sandbox calls are <strong>never billable</strong>.</li>
  <li><strong>Production</strong> — approved production access only. While the production signal source is being wired in a later batch, production lookups remain conservative and return <code>no_match</code> rather than expose internal records.</li>
</ul>

<h2>Response headers</h2>
<ul>
  <li><code>X-Izenzo-Environment</code> — echo of the resolved environment (sandbox or production). Stamped on every response including errors and unknown routes.</li>
  <li><code>X-Izenzo-Request-Id</code> — UUIDv4 request identifier. Also returned in the response body. Use when contacting support.</li>
</ul>

<h2>Allowed scopes</h2>
<table><thead><tr><th>Scope</th><th>What it allows</th></tr></thead><tbody>${scopeRows}</tbody></table>

<h2>Forbidden scopes</h2>
<p>These scopes are rejected at key-issuance time and are not available in V1:</p>
<ul>${forbiddenRows}</ul>

<h2>Available endpoints</h2>
<table>
  <thead><tr><th>Method</th><th>Path</th><th>Summary</th><th>Required scopes</th><th>Billable</th></tr></thead>
  <tbody>${epRows}</tbody>
</table>

<h2>Sandbox test records</h2>
<p>The following six records are guaranteed-present in sandbox and produce deterministic outcomes:</p>
<table>
  <thead><tr><th>Legal name</th><th>Country</th><th>Registration #</th><th>Company name</th><th>Expected</th></tr></thead>
  <tbody>${sandboxRecordRows}</tbody>
</table>

<h2>Sandbox error route</h2>
<p><code>GET /v1/test/error/{code}</code> is <strong>sandbox-only</strong>. Production hosts return <code>sandbox_endpoint_required</code>. Allowed codes:</p>
<ul>${sandboxErrorRows}</ul>
<p>The <code>invalid_api_key</code> and <code>expired_api_key</code> simulations require a valid sandbox key — they test the response shape safely without weakening real authentication.</p>

<h2>Lookup request examples</h2>
<pre>POST /v1/counterparty/lookup
X-API-Key: sk_...
X-Izenzo-Environment: sandbox
Content-Type: application/json

{ "legal_name": "Acme Holdings", "country": "ZA" }</pre>

<h2>Response examples</h2>
<p>Verified sandbox match (illustrative):</p>
<pre>{
  "request_id": "...",
  "environment": "sandbox",
  "match_status": "match",
  "counterparty_id": "...",
  "legal_name": "Acme Holdings",
  "country": "ZA",
  "verification_status": "verified",
  "risk_signal_summary": "clear",
  "test_data": true,
  "test_record": true,
  "sandbox_case_id": "TEST-2019-000001",
  "simulated_provider": "sandbox",
  "timestamp": "..."
}</pre>
<p>Sandbox-only response fields (<code>test_record</code>, <code>sandbox_case_id</code>, <code>simulated_provider</code>) <strong>never appear in production responses</strong>.</p>

<h2>Error catalogue</h2>
<table><thead><tr><th>Code</th><th>HTTP</th><th>Description</th></tr></thead><tbody>${errRows}</tbody></table>

<h2>Rate limits and usage</h2>
<ul>
  <li><strong>Sandbox</strong>: ${V1_ENV_LIMITS.sandbox.requests_per_minute_per_key} requests / minute / key · ${V1_ENV_LIMITS.sandbox.monthly_requests.toLocaleString("en-GB")} calls / month · ${V1_ENV_LIMITS.sandbox.concurrent_requests_per_key} concurrent.</li>
  <li><strong>Production</strong>: ${V1_ENV_LIMITS.production.requests_per_minute_per_key} requests / minute / key · default ${V1_ENV_LIMITS.production.default_monthly_lookups.toLocaleString("en-GB")} calls / month if no plan is configured · ${V1_ENV_LIMITS.production.concurrent_requests_per_key} concurrent.</li>
  <li>A production package allowance overrides the default. A <code>platform_admin</code>-approved override can change limits.</li>
  <li>A <code>429</code> response includes <code>rate_limit_exceeded</code>, <code>retry_after</code>, <code>limit_type</code> and <code>request_id</code>.</li>
  <li>Sandbox calls are <strong>non-billable</strong>. Production health/docs calls are non-billable. Billable production lookup calls may consume tokens/credits.</li>
  <li>Overage can continue only if the contract permits. Threshold events fire at <strong>80 / 100 / 120</strong>% of the monthly allowance.</li>
  <li>All amounts shown are <strong>estimates only</strong>, not invoices.</li>
</ul>

<h2>Webhooks (V1)</h2>
<ul>
  <li>Sandbox webhooks are for <strong>testing only</strong>. Production webhooks are optional and <strong>require a passed sandbox webhook test</strong> for the same client.</li>
  <li>Event types are limited to the approved V1 list.</li>
  <li>Signing headers:</li>
</ul>
<ul>${webhookHeaderRows}</ul>
<p>Signature algorithm: ${esc(V1_WEBHOOK_DOCS.signature_algorithm)}.</p>
<p>Retry schedule:</p>
<ul>${retryRows}</ul>
<p>Webhook payloads never include raw documents, internal notes, identity documents, raw bank details, evidence packs or another client's data.</p>

<h2>Key lifecycle</h2>
<ul>
  <li>Sandbox keys expire after <strong>${V1_KEY_LIFECYCLE_DOCS.sandbox_expiry_days} days</strong>.</li>
  <li>Production keys expire after <strong>${V1_KEY_LIFECYCLE_DOCS.production_expiry_months} months</strong>.</li>
  <li>Production expiry warnings fire at <strong>${V1_KEY_LIFECYCLE_DOCS.production_expiry_warning_days.join(" / ")} days</strong> before expiry.</li>
  <li>Production keys require production approval / sign-off.</li>
  <li>Raw API key secret is <strong>shown once only</strong>.</li>
  <li>Key rotation returns a new secret once.</li>
  <li>Suspended, revoked and expired keys are <strong>rejected</strong>.</li>
  <li>Production key actions require an authorised admin control.</li>
</ul>



<h2>Billing visibility</h2>
<ul>
  <li>Estimated usage and estimated charges only.</li>
  <li>No payment collection in V1.</li>
  <li>No invoices in V1.</li>
  <li>Billable calls are <strong>successful production lookup / summary calls only</strong>.</li>
</ul>

<h2>Support</h2>
<p>${esc(V1_SUPPORT_TEXT)}</p>

<h2>First-version exclusions — not supported in V1</h2>
<ul>${exclusionRows}</ul>

<h2>What this API does NOT do</h2>
<ul>${deferredRows}</ul>

<p>No API response automatically creates a POI, issues a WaD, clears a compliance block or approves a transaction.</p>


<h2>Security and data boundaries</h2>
<ul>
  <li>No raw API secrets returned.</li>
  <li>No bank account details.</li>
  <li>No documents or evidence.</li>
  <li>No governance trail.</li>
  <li>No internal notes.</li>
  <li>No compliance notes.</li>
  <li>No POI / WaD records.</li>
  <li>No other client's data.</li>
  <li>No unapproved AI output.</li>
</ul>

<h2>Machine-readable spec</h2>
<p>The OpenAPI 3.1 specification is served at <code>GET /v1/docs/openapi.json</code> using the same single source of truth as this page.</p>

</body></html>`;
}
