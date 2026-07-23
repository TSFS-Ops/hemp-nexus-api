/**
 * PayFast provider helpers — Phase 2B (sandbox ITN foundation).
 *
 * SCOPE
 * ─────
 * This module contains the PURE helpers PayFast needs (parsing,
 * signature, validation, status mapping, IP allowlist shape) plus a
 * pure `processPayfastItn` orchestrator. The Deno edge entry point
 * lives in `supabase/functions/payfast-itn/index.ts` and is a thin
 * wrapper that injects the real Supabase client, the real validate
 * post-back, and the real request IP into `processPayfastItn`.
 *
 * Everything in here is import-safe under Vitest (Node) — no Deno
 * globals, no `npm:` specifiers, no `https://` specifiers. The MD5
 * primitive comes from `node:crypto`, which Deno natively supports.
 *
 * NON-GOALS
 * ─────────
 *   • No customer-facing checkout initiation — Phase 2C work.
 *   • No live wiring — PayFast is sandbox-only this phase.
 *   • No USD↔ZAR FX — PayFast is ZAR-native. The legacy `_shared/fx.ts`
 *     helper is NOT imported and MUST NOT be revived here.
 *   • No refunds — Phase 2C/2D work.
 *   • No mutation of Paystack runtime behaviour. Paystack remains the
 *     sole live customer-facing provider after Phase 2B.
 */
import { createHash } from "node:crypto";
import type { PaymentProvider } from "./provider.ts";

// ─── Provider descriptor ──────────────────────────────────────────────────
//
// `liveEnabled: false` — PayFast is NOT registered as a live provider
// (see `select.ts`). This descriptor exists so tests, audit code, and
// future Phase 2C wiring have a single place to read the identity from.

export const PAYFAST_PROVIDER: PaymentProvider = {
  id: "payfast",
  label: "PayFast",
  currency: "ZAR",
  liveEnabled: false,
  // PayFast rows land in the provider-agnostic `provider_reference`
  // column added by Phase 2A. We never reuse `paystack_reference`.
  referenceColumn: "provider_reference",
};

// ─── PHP-style URL encoding ───────────────────────────────────────────────
//
// PayFast's signature is computed over a PHP `urlencode`-encoded
// concatenation. PHP's urlencode differs from JS's encodeURIComponent:
//   • spaces become "+" (not "%20")
//   • hex digits are uppercase ("%2F", not "%2f")
//   • `!'()*` are encoded
// Getting this wrong silently produces a wrong signature.

export function pfUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
}

// ─── Form-encoded body parser preserving order ────────────────────────────
//
// PayFast signs ITN fields in the ORDER they appear in the POST body,
// not in alphabetical order. The native `URLSearchParams` iterator does
// preserve insertion order, but we wrap it so the contract is explicit
// and we can return a fresh array (defensive against mutation).

export type OrderedField = readonly [string, string];

export function parseFormEncodedOrdered(body: string): OrderedField[] {
  const out: Array<OrderedField> = [];
  if (!body) return out;
  // Use URLSearchParams to handle percent-decoding + "+" → " ".
  const params = new URLSearchParams(body);
  for (const [k, v] of params) out.push([k, v] as const);
  return out;
}

/** Convert the ordered field list into a plain object for downstream use. */
export function fieldsToRecord(fields: ReadonlyArray<OrderedField>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fields) {
    // First occurrence wins — PayFast does not send duplicate keys.
    if (!(k in out)) out[k] = v;
  }
  return out;
}

// ─── Signature: build + verify ────────────────────────────────────────────

/**
 * Build the canonical PayFast signature string for the given ordered
 * fields. Skips the `signature` field itself and any empty value. If a
 * passphrase is provided it is appended last as `&passphrase=<enc>`.
 *
 * Used by both `buildPayfastSignature` (for tests / future checkout
 * initiation) and `verifyPayfastSignature` (for ITN verification).
 */
export function buildPayfastSignatureBase(
  fields: ReadonlyArray<OrderedField>,
  passphrase?: string | null,
): string {
  const parts: string[] = [];
  for (const [k, v] of fields) {
    if (k === "signature") continue;
    if (v == null || v === "") continue;
    parts.push(`${k}=${pfUrlEncode(v)}`);
  }
  let base = parts.join("&");
  if (passphrase && passphrase.length > 0) {
    base = base.length > 0
      ? `${base}&passphrase=${pfUrlEncode(passphrase)}`
      : `passphrase=${pfUrlEncode(passphrase)}`;
  }
  return base;
}

function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/** Compute the lowercase-hex MD5 PayFast signature. */
export function buildPayfastSignature(
  fields: ReadonlyArray<OrderedField>,
  passphrase?: string | null,
): string {
  return md5Hex(buildPayfastSignatureBase(fields, passphrase));
}

/**
 * Constant-time-ish signature comparison. PayFast signatures are
 * 32-char lowercase hex. The caller is expected to lowercase both
 * sides — we still normalise defensively.
 */
export function verifyPayfastSignature(
  fields: ReadonlyArray<OrderedField>,
  providedSignature: string | null | undefined,
  passphrase?: string | null,
): boolean {
  if (!providedSignature) return false;
  const expected = buildPayfastSignature(fields, passphrase);
  const got = providedSignature.toLowerCase();
  if (expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Raw-body signature verification (PayFast PHP reference approach).
 *
 * PayFast signs the ITN by taking the POST body as sent, removing the
 * trailing `&signature=...` segment, appending
 * `&passphrase=<urlencoded passphrase>` if configured, and MD5-ing the
 * result. This avoids any re-encoding drift between PayFast's PHP
 * urlencode and our reconstruction. Used as a fallback when the
 * reconstructed-from-parsed-fields signature does not match.
 */
export function verifyPayfastSignatureFromRawBody(
  rawBody: string,
  providedSignature: string | null | undefined,
  passphrase?: string | null,
): boolean {
  if (!providedSignature || !rawBody) return false;
  const sigIdx = rawBody.lastIndexOf("&signature=");
  const head = sigIdx >= 0 ? rawBody.slice(0, sigIdx) : rawBody;

  // Defensive: this fallback re-derives the signature from the raw body to
  // avoid re-encoding drift, but it must only ever authenticate a body where
  // `signature` is genuinely the trailing field. If any additional data
  // follows the signature value (e.g. an appended or duplicated field), the
  // body was altered after signing and must be rejected, not silently
  // accepted.
  if (sigIdx >= 0) {
    const tail = rawBody.slice(sigIdx + "&signature=".length);
    if (tail.toLowerCase() !== providedSignature.toLowerCase()) return false;
  }
  const base = passphrase && passphrase.length > 0
    ? `${head}&passphrase=${pfUrlEncode(passphrase)}`
    : head;
  const expected = md5Hex(base);
  const got = providedSignature.toLowerCase();
  if (expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Status mapping ───────────────────────────────────────────────────────
//
// PayFast `payment_status` values (sandbox + live):
//   COMPLETE   — credit
//   FAILED     — mark failed
//   CANCELLED  — mark cancelled (treated as abandoned, no credit)
//   PENDING    — do nothing yet; ignore (no credit)
//   anything else — treated as unknown, do nothing, risk-log

export type PayfastInternalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "pending"
  | "unknown";

export function mapPayfastStatus(raw: string | null | undefined): PayfastInternalStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "COMPLETE":
      return "completed";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "PENDING":
      return "pending";
    default:
      return "unknown";
  }
}

// ─── Provider reference extraction ────────────────────────────────────────
//
// PayFast emits two ids on COMPLETE ITNs:
//   • `m_payment_id`  — our reference (we set this at checkout init)
//   • `pf_payment_id` — PayFast's id (stable per settlement)
//
// We persist `m_payment_id` as `token_purchases.provider_reference`
// (the row identity we control) and we PREFER `pf_payment_id` for the
// idempotent credit allocation key when present, because `pf_payment_id`
// is the value that uniquely identifies the settlement event on
// PayFast's side. If PayFast does not send it (early-stage statuses)
// we fall back to `m_payment_id`. Either way the same logical purchase
// always lands on the same `p_reference_id`, which is what the atomic
// RPC's partial UNIQUE index on `token_ledger.request_id` needs.
//
// This is documented in the Phase 2B report.

export function extractPayfastProviderReference(
  fields: Record<string, string>,
): { lookupRef: string | null; creditRef: string | null } {
  const m = (fields.m_payment_id ?? "").trim();
  const pf = (fields.pf_payment_id ?? "").trim();
  return {
    lookupRef: m.length > 0 ? m : null,
    creditRef: pf.length > 0 ? pf : (m.length > 0 ? m : null),
  };
}

// ─── IP allowlist (PayFast publishes these) ───────────────────────────────
//
// PayFast publishes a list of source hostnames whose A-records define
// the IPs ITNs originate from (e.g. www.payfast.co.za, sandbox.payfast.co.za,
// w1w.payfast.co.za, w2w.payfast.co.za). Resolving those at request time
// is environment-specific and expensive, so the live wrapper in
// `payfast-itn/index.ts` is expected to inject the resolved set.
//
// For Phase 2B we expose the SHAPE of the check here and let tests and
// the entry-point compose the actual allowlist. There is NO broad
// production bypass in this module.

export interface IpCheckInput {
  /** Remote IP as observed by the edge function. */
  remoteIp: string | null | undefined;
  /** Allowlist of permitted source IPs (resolved upstream). */
  allowedIps: ReadonlyArray<string>;
  /**
   * Sandbox bypass flag. ONLY honoured when the handler is invoked in
   * sandbox mode AND the caller explicitly sets it. Production paths
   * MUST NOT set this; the Phase 2B report documents the requirement.
   */
  sandboxBypass?: boolean;
}

export function isAllowedPayfastIp(input: IpCheckInput): boolean {
  if (input.sandboxBypass === true) return true;
  if (!input.remoteIp) return false;
  return input.allowedIps.includes(input.remoteIp);
}

// ─── Validate post-back wrapper ───────────────────────────────────────────
//
// PayFast requires a server-to-server "validate" call where we POST the
// exact ITN body back and expect "VALID" in the response. We expose
// this as a wrapper so tests can mock it.

export type PayfastMode = "sandbox" | "live";

export type PayfastValidateResult =
  | { ok: true; raw: "VALID" }
  | { ok: false; reason: "invalid" | "timeout" | "network_error" | "unexpected_response"; raw?: string };

export type PayfastValidatePostback = (
  rawBody: string,
  mode: PayfastMode,
) => Promise<PayfastValidateResult>;

export const PAYFAST_VALIDATE_URLS: Record<PayfastMode, string> = {
  sandbox: "https://sandbox.payfast.co.za/eng/query/validate",
  live: "https://www.payfast.co.za/eng/query/validate",
};

/**
 * Default validate post-back implementation. Used by the edge entry
 * point. Tests inject a mock instead — they MUST NOT call this.
 */
export const defaultPayfastValidatePostback: PayfastValidatePostback = async (
  rawBody,
  mode,
) => {
  const url = PAYFAST_VALIDATE_URLS[mode];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: rawBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = (await res.text()).trim();
    if (text.startsWith("VALID")) return { ok: true, raw: "VALID" };
    if (text.startsWith("INVALID")) return { ok: false, reason: "invalid", raw: text };
    return { ok: false, reason: "unexpected_response", raw: text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "network_error", raw: msg };
  }
};

// ─── Orchestrator (pure; deps injected) ───────────────────────────────────
//
// `processPayfastItn` is the testable core. It returns a structured
// `ItnOutcome` describing what happened so the caller can render an
// HTTP response and so tests can assert without mocking HTTP.

export type ItnDecision =
  | "credited"
  | "already_credited"
  | "failed_recorded"
  | "cancelled_recorded"
  | "pending_ignored"
  | "rejected";

export type ItnRejectReason =
  | "method_not_allowed"
  | "empty_body"
  | "missing_signature"
  | "invalid_signature"
  | "invalid_ip"
  | "validate_invalid"
  | "validate_timeout"
  | "validate_network_error"
  | "validate_unexpected_response"
  | "replay_detected"
  | "missing_provider_reference"
  | "purchase_not_found"
  | "purchase_provider_mismatch"
  | "currency_mismatch"
  | "amount_missing"
  | "amount_not_numeric"
  | "amount_mismatch"
  | "package_mismatch"
  | "org_metadata_missing"
  | "unknown_status"
  | "credit_rpc_failed";

export interface ItnOutcome {
  decision: ItnDecision;
  status: number;
  /** Provider reference resolved (m_payment_id) — null if missing. */
  providerReference: string | null;
  /** Reference used for credit allocation (pf_payment_id || m_payment_id). */
  creditReference: string | null;
  reason?: ItnRejectReason;
  /** Human/operator-facing explanation. Persisted into audit metadata. */
  detail?: string;
  /** Internal status mapping (whether or not we credited). */
  mappedStatus?: PayfastInternalStatus;
}

// We deliberately type the Supabase client as `any` here — the same
// reason `_shared/replay-guard.ts` does (two parallel supabase-js
// import paths in this project produce nominally distinct classes).
// deno-lint-ignore no-explicit-any
export type ItnSupabaseClient = any;

export interface ProcessItnDeps {
  supabase: ItnSupabaseClient;
  mode: PayfastMode;
  /** Optional MERCHANT passphrase for signature verification. */
  passphrase?: string | null;
  /** Resolved PayFast source IP allowlist. */
  allowedIps: ReadonlyArray<string>;
  /** Remote IP as observed by the edge runtime. */
  remoteIp: string | null;
  /** Set true ONLY by tests / explicit sandbox dev mode. */
  sandboxBypassIp?: boolean;
  /** Injected validate post-back (mocked in tests). */
  validatePostback: PayfastValidatePostback;
  /** Stable clock for tests. */
  now?: () => Date;
}

export interface ProcessItnInput {
  method: string;
  rawBody: string;
}

/**
 * Pure-ish orchestrator. Side effects are confined to `deps.supabase`
 * calls and the injected `validatePostback`. Always resolves — never
 * throws — so the edge wrapper can unconditionally return HTTP 200 to
 * PayFast (the body still carries the decision for observability).
 */
export async function processPayfastItn(
  input: ProcessItnInput,
  deps: ProcessItnDeps,
): Promise<ItnOutcome> {
  const now = deps.now ?? (() => new Date());

  if (input.method.toUpperCase() !== "POST") {
    return {
      decision: "rejected",
      status: 405,
      reason: "method_not_allowed",
      detail: `method ${input.method} not allowed`,
      providerReference: null,
      creditReference: null,
    };
  }
  if (!input.rawBody || input.rawBody.length === 0) {
    return {
      decision: "rejected",
      status: 200,
      reason: "empty_body",
      providerReference: null,
      creditReference: null,
    };
  }

  const ordered = parseFormEncodedOrdered(input.rawBody);
  const fields = fieldsToRecord(ordered);
  const signature = fields.signature ?? null;
  const { lookupRef, creditRef } = extractPayfastProviderReference(fields);

  const writeAuditAndRisk = async (
    reason: ItnRejectReason,
    detail: string,
    severity: "low" | "medium" | "high",
    extraMetadata: Record<string, unknown> = {},
  ) => {
    let auditOrgId: string | null = null;
    if (lookupRef) {
      try {
        const { data, error } = await deps.supabase
          .from("token_purchases")
          .select("org_id")
          .eq("provider", "payfast")
          .eq("provider_reference", lookupRef)
          .maybeSingle();
        if (error) {
          console.log(JSON.stringify({
            tag: "payfast-itn-audit-write",
            target: "token_purchases_lookup",
            ok: false,
            reason,
            providerReference: lookupRef,
            error: { code: error.code ?? null, message: error.message ?? String(error) },
          }));
        } else if (typeof data?.org_id === "string" && data.org_id.length > 0) {
          auditOrgId = data.org_id;
        }
      } catch (e) {
        console.log(JSON.stringify({
          tag: "payfast-itn-audit-write",
          target: "token_purchases_lookup",
          ok: false,
          reason,
          providerReference: lookupRef,
          error: { message: e instanceof Error ? e.message : String(e) },
        }));
      }
    }

    const metadata: Record<string, unknown> = {
      provider: "payfast",
      provider_reference: lookupRef,
      pf_payment_id: fields.pf_payment_id ?? null,
      payment_status: fields.payment_status ?? null,
      amount_gross: fields.amount_gross ?? null,
      reason,
      detail,
      mode: deps.mode,
      ...extraMetadata,
    };

    if (auditOrgId) {
      // entity_id is uuid in schema; provider_reference is a text token
      // ("izpf_…"), so it goes in metadata, not entity_id. Leave entity_id
      // null when we cannot resolve a purchase row.
      const { error } = await deps.supabase.from("audit_logs").insert({
        org_id: auditOrgId,
        action: "credits.purchase_rejected",
        entity_type: "token_purchase",
        entity_id: null,
        metadata,
        created_at: now().toISOString(),
      });
      if (error) {
        console.log(JSON.stringify({
          tag: "payfast-itn-audit-write",
          target: "audit_logs",
          ok: false,
          reason,
          providerReference: lookupRef,
          error: { code: error.code ?? null, message: error.message ?? String(error) },
        }));
      }
    } else {
      console.log(JSON.stringify({
        tag: "payfast-itn-audit-write",
        target: "audit_logs",
        ok: false,
        reason,
        providerReference: lookupRef,
        error: { message: "skipped: no resolved org_id for audit_logs.org_id" },
      }));
    }

    try {
      const riskRow = {
        kind: "payfast_itn_rejected",
        severity,
        title: `PayFast ITN rejected: ${reason}`,
        description: detail,
        dedup_key: `payfast_itn:${reason}:${lookupRef ?? "no_ref"}:${
          fields.pf_payment_id ?? "no_pf"
        }`,
        metadata,
        created_at: now().toISOString(),
        updated_at: now().toISOString(),
      };
      const { error } = await deps.supabase.from("admin_risk_items").insert(riskRow);
      if (error) {
        const code = (error as { code?: string }).code;
        const message = String((error as { message?: string }).message ?? error);
        const duplicate = code === "23505" || /duplicate key value/i.test(message);
        if (duplicate) {
          const { error: updateError } = await deps.supabase
            .from("admin_risk_items")
            .update({
              status: "open",
              severity,
              title: riskRow.title,
              description: riskRow.description,
              metadata: {
                ...metadata,
                last_seen_at: now().toISOString(),
              },
              updated_at: now().toISOString(),
            })
            .eq("dedup_key", riskRow.dedup_key);
          if (updateError) {
            console.log(JSON.stringify({
              tag: "payfast-itn-audit-write",
              target: "admin_risk_items_update",
              ok: false,
              reason,
              providerReference: lookupRef,
              error: { code: updateError.code ?? null, message: updateError.message ?? String(updateError) },
            }));
          }
        } else {
          console.log(JSON.stringify({
            tag: "payfast-itn-audit-write",
            target: "admin_risk_items_insert",
            ok: false,
            reason,
            providerReference: lookupRef,
            error: { code: error.code ?? null, message },
          }));
        }
      }
    } catch (e) {
      console.log(JSON.stringify({
        tag: "payfast-itn-audit-write",
        target: "admin_risk_items_exception",
        ok: false,
        reason,
        providerReference: lookupRef,
        error: { message: e instanceof Error ? e.message : String(e) },
      }));
    }
  };

  // 1. Signature.
  if (!signature) {
    await writeAuditAndRisk("missing_signature", "PayFast ITN missing signature field", "high");
    return {
      decision: "rejected",
      status: 200,
      reason: "missing_signature",
      providerReference: lookupRef,
      creditReference: creditRef,
    };
  }
  const sigOkReconstructed = verifyPayfastSignature(ordered, signature, deps.passphrase ?? null);
  const sigOkRaw = sigOkReconstructed
    ? true
    : verifyPayfastSignatureFromRawBody(input.rawBody, signature, deps.passphrase ?? null);
  console.log(JSON.stringify({
    tag: "payfast-itn-sig-verify",
    sigOkReconstructed,
    sigOkRaw,
    hasPassphrase: !!(deps.passphrase && deps.passphrase.length > 0),
  }));
  if (!sigOkReconstructed && !sigOkRaw) {
    await writeAuditAndRisk(
      "invalid_signature",
      "PayFast ITN signature did not verify",
      "high",
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "invalid_signature",
      providerReference: lookupRef,
      creditReference: creditRef,
    };
  }

  // 2. Source IP allowlist.
  if (
    !isAllowedPayfastIp({
      remoteIp: deps.remoteIp,
      allowedIps: deps.allowedIps,
      sandboxBypass: deps.sandboxBypassIp,
    })
  ) {
    await writeAuditAndRisk(
      "invalid_ip",
      `PayFast ITN from non-allowlisted IP ${deps.remoteIp ?? "<none>"}`,
      "high",
      { remote_ip: deps.remoteIp ?? null },
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "invalid_ip",
      providerReference: lookupRef,
      creditReference: creditRef,
    };
  }

  // 3. Replay guard. We use signature as the uniqueness token, hashed
  // SHA-256 by the shared insert into `webhook_replay_guard`. A
  // duplicate signature for the same source = replay.
  try {
    const sigHash = createHash("sha256").update(signature, "utf8").digest("hex");
    const { error: replayErr } = await deps.supabase
      .from("webhook_replay_guard")
      .insert({ source: `payfast_itn_${deps.mode}`, signature_hash: sigHash });
    if (replayErr) {
      const code = (replayErr as { code?: string }).code;
      const message = String((replayErr as { message?: string }).message ?? "");
      const isUnique = code === "23505" || /duplicate key value/i.test(message);
      if (isUnique) {
        await writeAuditAndRisk(
          "replay_detected",
          "Duplicate PayFast ITN signature",
          "medium",
        );
        return {
          decision: "rejected",
          status: 200,
          reason: "replay_detected",
          providerReference: lookupRef,
          creditReference: creditRef,
        };
      }
      // Other DB errors fall through — we still want to attempt validate
      // so a transient blip does not deny a legitimate settlement; the
      // RPC's idempotency on `p_reference_id` is the final defence.
    }
  } catch { /* defensive */ }

  // 4. Validate post-back.
  const validate = await deps.validatePostback(input.rawBody, deps.mode);
  if (validate.ok !== true) {
    const failReason = validate.reason;
    const reason: ItnRejectReason =
      failReason === "invalid"
        ? "validate_invalid"
        : failReason === "timeout"
          ? "validate_timeout"
          : failReason === "network_error"
            ? "validate_network_error"
            : "validate_unexpected_response";
    await writeAuditAndRisk(reason, `PayFast validate post-back returned ${failReason}`, "high", {
      validate_raw: validate.raw ?? null,
    });
    return {
      decision: "rejected",
      status: 200,
      reason,
      providerReference: lookupRef,
      creditReference: creditRef,
    };
  }

  // 5. Provider reference required.
  if (!lookupRef) {
    await writeAuditAndRisk(
      "missing_provider_reference",
      "PayFast ITN missing m_payment_id",
      "high",
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "missing_provider_reference",
      providerReference: null,
      creditReference: null,
    };
  }

  // 6. Look up purchase by (provider='payfast', provider_reference=m_payment_id).
  const { data: purchase, error: purchaseErr } = await deps.supabase
    .from("token_purchases")
    .select("id, org_id, user_id, status, token_amount, currency, package_id, metadata, provider, provider_reference")
    .eq("provider", "payfast")
    .eq("provider_reference", lookupRef)
    .maybeSingle();

  if (purchaseErr || !purchase) {
    await writeAuditAndRisk(
      "purchase_not_found",
      `No token_purchases row for provider=payfast, ref=${lookupRef}`,
      "high",
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "purchase_not_found",
      providerReference: lookupRef,
      creditReference: creditRef,
    };
  }

  // 7. Defensive provider check (RLS aside).
  if (purchase.provider !== "payfast") {
    await writeAuditAndRisk(
      "purchase_provider_mismatch",
      `Purchase provider is ${purchase.provider} not payfast`,
      "high",
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "purchase_provider_mismatch",
      providerReference: lookupRef,
      creditReference: creditRef,
    };
  }

  // 8. Status mapping.
  const mapped = mapPayfastStatus(fields.payment_status);

  if (mapped === "pending") {
    return {
      decision: "pending_ignored",
      status: 200,
      providerReference: lookupRef,
      creditReference: creditRef,
      mappedStatus: mapped,
    };
  }

  if (mapped === "unknown") {
    await writeAuditAndRisk(
      "unknown_status",
      `PayFast ITN carried unknown payment_status=${fields.payment_status ?? "<none>"}`,
      "medium",
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "unknown_status",
      providerReference: lookupRef,
      creditReference: creditRef,
      mappedStatus: mapped,
    };
  }

  if (mapped === "failed" || mapped === "cancelled") {
    // Mark purchase, do NOT credit. We do not call atomic_paid_credit_purchase.
    const newStatus = mapped === "failed" ? "failed" : "cancelled";
    try {
      await deps.supabase
        .from("token_purchases")
        .update({ status: newStatus, updated_at: now().toISOString() })
        .eq("id", purchase.id)
        .in("status", ["pending"]);
    } catch { /* never throw */ }
    try {
      await deps.supabase.from("audit_logs").insert({
        org_id: purchase.org_id,
        action: mapped === "failed" ? "credits.purchase_failed" : "credits.purchase_cancelled",
        entity_type: "token_purchase",
        entity_id: purchase.id,
        metadata: {
          provider: "payfast",
          provider_reference: lookupRef,
          pf_payment_id: fields.pf_payment_id ?? null,
          payment_status: fields.payment_status,
          mode: deps.mode,
        },
        created_at: now().toISOString(),
      });
    } catch { /* never throw */ }
    return {
      decision: mapped === "failed" ? "failed_recorded" : "cancelled_recorded",
      status: 200,
      providerReference: lookupRef,
      creditReference: creditRef,
      mappedStatus: mapped,
    };
  }

  // 9. COMPLETE path — full validation, then credit.

  const purchaseCredits = Number(purchase.token_amount ?? purchase.credits ?? purchase.metadata?.token_amount);

  // Currency must be ZAR — PayFast does not settle in any other currency.
  // (Existing `token_purchases` rows from Paystack carry `currency='USD'`
  //  and `provider='paystack'`; we will never reach them because of the
  //  `provider='payfast'` filter above. Belt-and-braces still required.)
  const purchaseCurrency = (purchase.currency ?? (purchase.metadata?.currency as string | undefined) ?? "").toUpperCase();
  if (purchaseCurrency && purchaseCurrency !== "ZAR") {
    await writeAuditAndRisk(
      "currency_mismatch",
      `Purchase currency ${purchaseCurrency} is not ZAR`,
      "high",
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "currency_mismatch",
      providerReference: lookupRef,
      creditReference: creditRef,
      mappedStatus: mapped,
    };
  }

  // Amount checks. PayFast sends `amount_gross` as decimal string e.g. "10.00".
  const amountRaw = fields.amount_gross;
  if (amountRaw == null || amountRaw === "") {
    await writeAuditAndRisk("amount_missing", "PayFast ITN missing amount_gross", "high");
    return {
      decision: "rejected",
      status: 200,
      reason: "amount_missing",
      providerReference: lookupRef,
      creditReference: creditRef,
      mappedStatus: mapped,
    };
  }
  const amountNum = Number(amountRaw);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    await writeAuditAndRisk("amount_not_numeric", `PayFast amount_gross "${amountRaw}" is not a positive number`, "high");
    return {
      decision: "rejected",
      status: 200,
      reason: "amount_not_numeric",
      providerReference: lookupRef,
      creditReference: creditRef,
      mappedStatus: mapped,
    };
  }
  // Expected ZAR amount lives in metadata.price_zar (set at checkout
  // init in Phase 2C). Until 2C ships, tests construct the row directly.
  const expectedZar = Number(purchase.metadata?.price_zar);
  if (Number.isFinite(expectedZar) && expectedZar > 0) {
    // Compare in cents to avoid float noise.
    const gotCents = Math.round(amountNum * 100);
    const wantCents = Math.round(expectedZar * 100);
    if (gotCents !== wantCents) {
      await writeAuditAndRisk(
        "amount_mismatch",
        `PayFast amount_gross ${amountNum} ≠ expected ZAR ${expectedZar}`,
        "high",
        { got_zar: amountNum, expected_zar: expectedZar },
      );
      return {
        decision: "rejected",
        status: 200,
        reason: "amount_mismatch",
        providerReference: lookupRef,
        creditReference: creditRef,
        mappedStatus: mapped,
      };
    }
  }

  // Package id check (when ITN carries item_name / custom_str1).
  const itnPackage = fields.custom_str1 ?? null;
  if (itnPackage && purchase.package_id && itnPackage !== purchase.package_id) {
    await writeAuditAndRisk(
      "package_mismatch",
      `PayFast custom_str1=${itnPackage} ≠ purchase.package_id=${purchase.package_id}`,
      "high",
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "package_mismatch",
      providerReference: lookupRef,
      creditReference: creditRef,
      mappedStatus: mapped,
    };
  }

  // Org metadata sanity.
  if (!purchase.org_id) {
    await writeAuditAndRisk("org_metadata_missing", "Purchase row missing org_id", "high");
    return {
      decision: "rejected",
      status: 200,
      reason: "org_metadata_missing",
      providerReference: lookupRef,
      creditReference: creditRef,
      mappedStatus: mapped,
    };
  }

  // 10. Credit allocation via the canonical paid-credit RPC. Idempotent
  // on p_reference_id via the partial UNIQUE index on token_ledger.request_id.
  const creditReference = creditRef ?? lookupRef; // never null here.
  const { data: creditResult, error: creditError } = await deps.supabase.rpc(
    "atomic_paid_credit_purchase",
    {
      p_org_id: purchase.org_id,
      p_amount: purchaseCredits,
      p_reference_id: creditReference,
      p_endpoint: "payment:payfast:itn",
      p_metadata: {
        provider: "payfast",
        provider_reference: lookupRef,
        pf_payment_id: fields.pf_payment_id ?? null,
        package_id: purchase.package_id,
        currency: "ZAR",
        price_zar: Number.isFinite(expectedZar) ? expectedZar : amountNum,
        amount_gross_zar: amountNum,
        mode: deps.mode,
      },
    },
  );

  if (creditError) {
    await writeAuditAndRisk(
      "credit_rpc_failed",
      `atomic_paid_credit_purchase failed: ${(creditError as { message?: string }).message ?? "unknown"}`,
      "high",
    );
    return {
      decision: "rejected",
      status: 200,
      reason: "credit_rpc_failed",
      providerReference: lookupRef,
      creditReference: creditReference,
      mappedStatus: mapped,
    };
  }

  const alreadyCredited = creditResult?.already_credited === true;

  // 11. Mark purchase row completed (idempotent — only flip from pending).
  try {
    await deps.supabase
      .from("token_purchases")
      .update({ status: "completed", updated_at: now().toISOString() })
      .eq("id", purchase.id)
      .in("status", ["pending"]);
  } catch { /* never throw */ }

  const checkoutMeta = (purchase.metadata ?? {}) as Record<string, unknown>;
  const settlementPriceUsd = typeof checkoutMeta.price_usd === "number" ? checkoutMeta.price_usd : (typeof checkoutMeta.amount_usd === "number" ? checkoutMeta.amount_usd : null);
  const settlementAmountUsd = typeof checkoutMeta.amount_usd === "number" ? checkoutMeta.amount_usd : settlementPriceUsd;
  const settlementUsdZarRate = typeof checkoutMeta.usd_zar_rate === "number" ? checkoutMeta.usd_zar_rate : null;
  const settlementFxRateLockedAt = typeof checkoutMeta.fx_rate_locked_at === "string" ? checkoutMeta.fx_rate_locked_at : null;
  const settlementAmountZar = typeof checkoutMeta.amount_zar === "number" ? checkoutMeta.amount_zar : null;
  
  // 12. Audit success.
  try {
    await deps.supabase.from("audit_logs").insert({
      org_id: purchase.org_id,
      action: "credits.purchased",
      entity_type: "token_balance",
      entity_id: purchase.org_id,
      metadata: {
        provider: "payfast",
        provider_reference: lookupRef,
        pf_payment_id: fields.pf_payment_id ?? null,
        credits_added: purchaseCredits,
        new_balance: creditResult?.new_balance ?? null,
        already_credited: alreadyCredited,
        package_id: purchase.package_id,
        status: "completed",
        token_amount: purchaseCredits,
        payment_reference: creditReference,
        reference: creditReference,
        amount_usd: settlementAmountUsd,
        price_usd: settlementPriceUsd,
        usd_zar_rate: settlementUsdZarRate,
        fx_rate: settlementUsdZarRate,
        fx_rate_locked_at: settlementFxRateLockedAt,
        amount_zar: settlementAmountZar,
        price_zar: Number.isFinite(expectedZar) ? expectedZar : amountNum,
        amount_gross_zar: amountNum,
        mode: deps.mode,
      },
      created_at: now().toISOString(),
    });
  } catch { /* never throw */ }

  return {
    decision: alreadyCredited ? "already_credited" : "credited",
    status: 200,
    providerReference: lookupRef,
    creditReference,
    mappedStatus: mapped,
  };
}
