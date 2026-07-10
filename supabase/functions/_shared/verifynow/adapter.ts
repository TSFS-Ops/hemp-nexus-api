/**
 * Batch V -- VerifyNow server-side adapter.
 *
 * SERVER-ONLY. Never import from `src/**`. A guard test scans the browser
 * bundle to prove this file (and its secrets) are not referenced there.
 *
 * Secrets (Deno.env):
 *   VERIFYNOW_API_KEY   -- required for live calls. Fail-closed when absent.
 *   VERIFYNOW_BASE_URL  -- default https://www.verifynow.co.za/api/external
 *   VERIFYNOW_MODE      -- "sandbox" (default) | "production"
 *
 * Production idempotency:
 *   All production requests MUST include `Idempotency-Key: <uuid v4>`.
 *   Callers are expected to persist the key alongside the outbound
 *   request. Reusing a key with a DIFFERENT payload is treated as
 *   provider_error and routed to manual review + audit.
 *
 * This adapter DOES NOT persist to Memory. It does not call live
 * providers in local tests -- the calling function must inject a
 * `fetchImpl` under test to satisfy the fetch tripwire.
 *
 * Provider contract alignment (2026-07-08): the outbound URL, reportType
 * and body field mapping are now sourced ONLY from
 * `./provider-contract-map.ts`, keyed by internal document_type. Routes
 * without a confirmed entry there fail closed to PROVIDER_MISCONFIGURED
 * and never reach fetch. See that file for confirmed vs unconfirmed
 * routes.
 *
 * Classifier hardening (Batch V-Hardening, static-analysis only): no
 * confirmed VerifyNow response-shape example exists anywhere in this
 * repo's evidence trail -- only the request shape was ever confirmed by
 * Daniel/VerifyNow. classifyProviderResponse's original body-shape check
 * only recognised top-level `status` and `match` strings. This revision
 * adds a narrow, explicit second tier of checks (see
 * readVerificationSignal / readNestedWrapperSignal below) for a small set
 * of unambiguous positive/negative verification signals, one level deep
 * under a fixed list of safe wrapper keys. It deliberately does NOT widen
 * to ambiguous signals such as `success: true` alone, `status: "success"`
 * alone, `status: "completed"` alone, or any unrecognised shape -- all of
 * those still fall through to `provider_error`, unchanged from before.
 */

import {
      resolveVerifyNowOutcome,
      type IdvResolvedOutcome,
      type VerifyNowRawOutcome,
} from "./result-mapping.ts";
import {
      resolveIdvRoute,
      type IdvRouteInput,
      type IdvRouteResolution,
} from "../idv-route-table.ts";
import { resolveProviderContract } from "./provider-contract-map.ts";
import { summariseResponseShape, type ShapeSummary } from "./response-shape.ts";

export interface VerifyNowAdapterConfig {
      apiKey?: string;
      baseUrl?: string;
      mode?: "sandbox" | "production";
      fetchImpl?: typeof fetch;
}

export interface VerifyNowCallInput {
      route: IdvRouteInput;
      /** Minimal identity payload -- caller MUST validate before passing. */
  payload: Record<string, string>;
      /** UUID v4. Required for production. Ignored in sandbox. */
  idempotencyKey?: string;
      /**
       * Prior key/payload store -- if the same idempotency key was previously
       * used with a different payload, we return provider_error. Optional; if
       * omitted the check is skipped.
       */
  priorPayloadForKey?: Record<string, string> | null;
}

export interface VerifyNowAdapterOutcome {
      route_resolution: IdvRouteResolution;
      raw_outcome: VerifyNowRawOutcome | null;
      resolved: IdvResolvedOutcome | null;
      provider: "verifynow" | null;
      provider_reference?: string | null;
      idempotency_key?: string | null;
      error_code?:
        | "PROVIDER_MISCONFIGURED"
        | "IDEMPOTENCY_KEY_REQUIRED"
        | "IDEMPOTENCY_CONFLICT"
        | "PROVIDER_NOT_AVAILABLE"
        | "PROVIDER_AUTH_FAILED"
        | "PROVIDER_REQUEST_REJECTED"
        | "PROVIDER_RATE_LIMITED"
        | "PROVIDER_FAILED"
        | null;
      /**
       * Instrumentation-only diagnostics. VALUES-FREE. Never returned to the
       * end user; the caller (idv-person-verify) persists these into
       * `raw_provider_payload_admin_only` and logs them behind an
       * admin-only diagnostic line. `raw_http_status` is 0 if the fetch
       * threw. `response_body_shape` is null when no HTTP call was made
       * (route/config/idempotency fail-closed paths).
       */
  raw_http_status?: number | null;
      response_body_shape?: ShapeSummary | null;
}

const DEFAULT_BASE_URL = "https://www.verifynow.co.za/api/external";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableStringify(obj: Record<string, string>): string {
      return JSON.stringify(
              Object.keys(obj)
                .sort()
                .reduce<Record<string, string>>((acc, k) => {
                            acc[k] = obj[k];
                            return acc;
                }, {}),
            );
}

export function loadConfig(): VerifyNowAdapterConfig {
      const env = (globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno?.env;
      return {
              apiKey: env?.get("VERIFYNOW_API_KEY") || undefined,
              baseUrl: env?.get("VERIFYNOW_BASE_URL") || DEFAULT_BASE_URL,
              mode: (env?.get("VERIFYNOW_MODE") === "production" ? "production" : "sandbox"),
      };
}

/**
 * Attempt an IDV via VerifyNow. Returns a normalised outcome. Never
 * throws for domain errors -- every failure is a typed outcome the caller
 * can persist. Only throws for programmer errors.
 */
export async function verifyNowIdv(
      input: VerifyNowCallInput,
      cfgOverride?: VerifyNowAdapterConfig,
    ): Promise<VerifyNowAdapterOutcome> {
      const cfg = { ...loadConfig(), ...(cfgOverride ?? {}) };
      const mode = cfg.mode ?? "sandbox";

  // 1. Route lookup FIRST. Unsupported -> return without touching the
  // network. Ensures unsupported routes never trigger a provider call.
  const routeRes = resolveIdvRoute(input.route);
      if (routeRes.kind !== "route") {
              const resolved = resolveVerifyNowOutcome({
                        raw_outcome:
                                    routeRes.reason === "unsupported_country"
                            ? "unsupported_country"
                                      : "unsupported_document_type",
                        route_can_unlock: false,
              });
              return {
                        route_resolution: routeRes,
                        raw_outcome: resolved.raw_outcome,
                        resolved,
                        provider: null,
                        error_code: "PROVIDER_NOT_AVAILABLE",
              };
      }

  // 2. Configuration check. Fail-closed with PROVIDER_MISCONFIGURED -- the
  // caller is expected to audit and route to manual review.
  if (!cfg.apiKey) {
          const resolved = resolveVerifyNowOutcome({
                    raw_outcome: "provider_error",
                    route_can_unlock: routeRes.entry.can_unlock_controlled_actions,
          });
          return {
                    route_resolution: routeRes,
                    raw_outcome: "provider_error",
                    resolved,
                    provider: "verifynow",
                    error_code: "PROVIDER_MISCONFIGURED",
          };
  }

  // 2.5. Resolve the confirmed provider contract for this document type.
  // Unconfirmed / unmapped routes MUST fail closed here -- never guess a
  // reportType or endpoint from the internal document_type. See
  // provider-contract-map.ts for the confirmed/unconfirmed route list.
  const contract = resolveProviderContract(routeRes.entry.document_type);
      if (!contract) {
              const resolved = resolveVerifyNowOutcome({
                        raw_outcome: "provider_error",
                        route_can_unlock: routeRes.entry.can_unlock_controlled_actions,
              });
              return {
                        route_resolution: routeRes,
                        raw_outcome: "provider_error",
                        resolved,
                        provider: "verifynow",
                        error_code: "PROVIDER_MISCONFIGURED",
              };
      }

  // 3. Production idempotency contract.
  if (mode === "production") {
          if (!input.idempotencyKey || !UUID_V4.test(input.idempotencyKey)) {
                    const resolved = resolveVerifyNowOutcome({
                                raw_outcome: "provider_error",
                                route_can_unlock: routeRes.entry.can_unlock_controlled_actions,
                    });
                    return {
                                route_resolution: routeRes,
                                raw_outcome: "provider_error",
                                resolved,
                                provider: "verifynow",
                                error_code: "IDEMPOTENCY_KEY_REQUIRED",
                    };
          }
          if (input.priorPayloadForKey) {
                    if (stableStringify(input.priorPayloadForKey) !== stableStringify(input.payload)) {
                                const resolved = resolveVerifyNowOutcome({
                                              raw_outcome: "provider_error",
                                              route_can_unlock: routeRes.entry.can_unlock_controlled_actions,
                                });
                                return {
                                              route_resolution: routeRes,
                                              raw_outcome: "provider_error",
                                              resolved,
                                              provider: "verifynow",
                                              idempotency_key: input.idempotencyKey,
                                              error_code: "IDEMPOTENCY_CONFLICT",
                                };
                    }
          }
  }

  // 4. Perform request. Callers MUST inject fetchImpl in tests (fetch
  // tripwire in adapter_smoke_test.ts proves this file makes no
  // uninjected network calls).
  const doFetch = cfg.fetchImpl ?? fetch;
      const url = `${(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/${contract.endpoint_path}`;
      const headers: Record<string, string> = {
              "content-type": "application/json",
              "x-api-key": cfg.apiKey,
      };
      if (mode === "production" && input.idempotencyKey) {
              headers["Idempotency-Key"] = input.idempotencyKey;
      }

  // Build the provider body strictly from the confirmed contract mapping
  // -- never pass the internal payload through unmodified. Always include
  // `mode` explicitly; add `reportType` only when the contract specifies
  // one (SA /verify routes).
  const providerBody: Record<string, string> = { ...(contract.constant_fields || {}) };
      for (const [internalField, providerField] of Object.entries(contract.field_mapping)) {
              const v = input.payload[internalField];
              if (typeof v === "string") providerBody[providerField] = v;
      }
      if (contract.report_type) providerBody.reportType = contract.report_type;
      providerBody.mode = mode;

  // 3.5. Fail-closed if the caller did not supply every field this
  // confirmed contract requires (e.g. a legacy/old caller sending only
  // free-text `details_text` instead of the structured payload the
  // confirmed route now expects). Never send an incomplete/malformed
  // body to VerifyNow -- treat this exactly like an unconfirmed route.
  const requiredProviderFields = Object.values(contract.field_mapping);
      const hasAllRequiredFields = requiredProviderFields.every(
              (providerField) => typeof providerBody[providerField] === "string" && providerBody[providerField].length > 0,
            );
      if (!hasAllRequiredFields) {
              const resolved = resolveVerifyNowOutcome({
                        raw_outcome: "provider_error",
                        route_can_unlock: routeRes.entry.can_unlock_controlled_actions,
              });
              return {
                        route_resolution: routeRes,
                        raw_outcome: "provider_error",
                        resolved,
                        provider: "verifynow",
                        error_code: "PROVIDER_MISCONFIGURED",
              };
      }

  let httpStatus = 0;
      let body: unknown = null;
      try {
              const resp = await doFetch(url, {
                        method: "POST",
                        headers,
                        body: JSON.stringify(providerBody),
              });
              httpStatus = resp.status;
              try {
                        body = await resp.json();
              } catch {
                        body = null;
              }
      } catch {
              const resolved = resolveVerifyNowOutcome({
                        raw_outcome: "source_unavailable",
                        route_can_unlock: routeRes.entry.can_unlock_controlled_actions,
              });
              return {
                        route_resolution: routeRes,
                        raw_outcome: "source_unavailable",
                        resolved,
                        provider: "verifynow",
                        idempotency_key: input.idempotencyKey ?? null,
                        error_code: null,
                        raw_http_status: 0,
                        response_body_shape: null,
              };
      }

  // 5. Normalise HTTP + body to raw outcome. This is deliberately
  // conservative: unknown provider strings map to provider_error, not
  // to any success state. See Batch O and Batch V-Hardening.
  const raw = classifyProviderResponse(httpStatus, body);
      const resolved = resolveVerifyNowOutcome({
              raw_outcome: raw,
              route_can_unlock: routeRes.entry.can_unlock_controlled_actions,
      });
      const providerRef =
              body && typeof body === "object" && "reference" in body
          ? String((body as { reference: unknown }).reference ?? "")
                : null;
      // Values-free structural summary for admin diagnostics only. NEVER
  // returned to the UI, NEVER logged with raw values.
  const responseBodyShape = summariseResponseShape(body);
      return {
              route_resolution: routeRes,
              raw_outcome: raw,
              resolved,
              provider: "verifynow",
              provider_reference: providerRef,
              idempotency_key: input.idempotencyKey ?? null,
              error_code: deriveProviderErrorCode(httpStatus, raw),
              raw_http_status: httpStatus,
              response_body_shape: responseBodyShape,
      };
}

/**
 * Batch V-Hardening -- narrow, explicit verification-signal reader.
 *
 * Only recognises an unambiguous positive or negative signal on a single
 * object. Deliberately does NOT recognise `success`, generic `status:
 * "success"`/`"completed"`, or `message`-only fields as either signal --
 * those remain ambiguous and must fall through to `provider_error`
 * upstream. Never reads any key not explicitly listed here.
 */
function readVerificationSignal(obj: Record<string, unknown>): "positive" | "negative" | null {
      if (obj.verified === true || obj.isVerified === true || obj.identityVerified === true) {
              return "positive";
      }
      if (obj.verified === false || obj.isVerified === false || obj.identityVerified === false) {
              return "negative";
      }

  const status = typeof obj.status === "string" ? obj.status.toLowerCase() : "";
      const verificationStatus =
              typeof obj.verificationStatus === "string" ? obj.verificationStatus.toLowerCase() : "";
      if (status === "verified" || verificationStatus === "verified") return "positive";

  const match = typeof obj.match === "string" ? obj.match.toLowerCase() : "";
      if (match === "verified" || match === "clear" || match === "clear_match") return "positive";
      if (match === "mismatch" || match === "clear_mismatch") return "negative";

  return null;
}

/**
 * Batch V-Hardening -- checks the same explicit signals one level deep
 * under a fixed list of safe wrapper keys VerifyNow-style providers
 * commonly use to envelope a result. Never recurses further than one
 * level; never inspects a wrapper key outside this fixed list.
 */
function readNestedWrapperSignal(body: Record<string, unknown>): "positive" | "negative" | null {
      const wrapperKeys = ["data", "result", "verification", "response"] as const;
      for (const key of wrapperKeys) {
              const wrapper = body[key];
              if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) {
                        const signal = readVerificationSignal(wrapper as Record<string, unknown>);
                        if (signal) return signal;
              }
      }
      return null;
}

/**
 * Batch V-Hardening -- enriches the admin-only error_code with a more
 * specific reason when the raw outcome is `provider_error`, based solely
 * on the HTTP status already received. Never changes raw_outcome, never
 * changes fail-closed behaviour, never returned differently to the UI
 * (the UI only ever sees `internal_status` / `unlocks_controlled_actions`,
 * never this field). Returns null for any outcome other than
 * `provider_error` so existing non-provider_error branches are untouched.
 */
export function deriveProviderErrorCode(
      httpStatus: number,
      raw: VerifyNowRawOutcome,
    ): "PROVIDER_AUTH_FAILED" | "PROVIDER_REQUEST_REJECTED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_FAILED" | null {
      if (raw !== "provider_error") return null;
      if (httpStatus === 401 || httpStatus === 403) return "PROVIDER_AUTH_FAILED";
      if (httpStatus === 400 || httpStatus === 405 || httpStatus === 422) return "PROVIDER_REQUEST_REJECTED";
      if (httpStatus === 429) return "PROVIDER_RATE_LIMITED";
      return "PROVIDER_FAILED";
}

/**
 * Conservative HTTP+body -> raw outcome mapper.
 * - 5xx / network -> source_unavailable
 * - 408 / body "timeout" -> timeout
 * - 404 / body "not_found" -> not_found
 * - 409 (idempotency conflict) -> provider_error
 * - 401 / 403 -> provider_error (see deriveProviderErrorCode for the
 *   finer-grained admin-only error_code)
 * - 200 with explicit body.match === "clear" -> clear_match
 * - 200 with body.match === "possible_mismatch" -> possible_mismatch
 * - 200 with body.match === "mismatch" -> clear_mismatch
 * - 200 with body.status in {"blocked","deceased","suspected_fraud"} -> mapped
 * - Batch V-Hardening: 200 with an unambiguous verified/isVerified/
 *   identityVerified/verificationStatus/match signal (top-level or one
 *   level deep under data/result/verification/response) -> clear_match /
 *   possible_mismatch, per readVerificationSignal
 * - Anything else (unknown provider strings, `success`/`status:"success"`/
 *   `status:"completed"`/message-only bodies) -> provider_error
 */
export function classifyProviderResponse(
      httpStatus: number,
      body: unknown,
    ): VerifyNowRawOutcome {
      if (httpStatus === 0) return "source_unavailable";
      if (httpStatus >= 500) return "source_unavailable";
      if (httpStatus === 408) return "timeout";
      if (httpStatus === 404) return "not_found";
      if (httpStatus === 409) return "provider_error";
      if (httpStatus === 401 || httpStatus === 403) return "provider_error";
      if (httpStatus >= 400 && httpStatus < 500) return "provider_error";

  if (!body || typeof body !== "object") return "provider_error";
      const b = body as Record<string, unknown>;
      const status = typeof b.status === "string" ? b.status.toLowerCase() : "";
      if (status === "blocked") return "blocked_id";
      if (status === "deceased") return "deceased";
      if (status === "suspected_fraud" || status === "fraud") return "suspected_fraud";
      if (status === "timeout") return "timeout";
      if (status === "not_found") return "not_found";
      if (status === "source_unavailable") return "source_unavailable";

  const match = typeof b.match === "string" ? b.match.toLowerCase() : "";
      if (match === "clear" || match === "clear_match" || match === "verified") return "clear_match";
      if (match === "possible_mismatch") return "possible_mismatch";
      if (match === "mismatch" || match === "clear_mismatch") return "clear_mismatch";

  // Batch V-Hardening: narrow, explicit second tier -- top level, then one
  // level deep under a fixed set of safe wrapper keys. Never treats an
  // unrecognised shape, or an ambiguous success/status:"success"/
  // status:"completed"/message-only body, as a pass.
  const topSignal = readVerificationSignal(b);
      if (topSignal === "positive") return "clear_match";
      if (topSignal === "negative") return "possible_mismatch";

  const nestedSignal = readNestedWrapperSignal(b);
      if (nestedSignal === "positive") return "clear_match";
      if (nestedSignal === "negative") return "possible_mismatch";

  return "provider_error";
}
