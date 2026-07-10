/**
 * Batch V-UI-Fix-4 -- Person-IDV VerifyNow edge function.
 *
 * Wires /desk/idv/start's live South Africa / Nigeria full-IDV routes to
 * the real VerifyNow adapter, WITHOUT touching `idv-verify` (which
 * remains the older entity/KYB verifier and must not be changed).
 *
 * - authenticates the caller (Supabase JWT);
 * - confirms the target p5scr_subjects row belongs to the caller
 *   (person_external_ref = auth.uid);
 * - routes strictly by (document_country, document_type) via the shared
 *   Batch V route table (resolveIdvRoute);
 * - calls the VerifyNow adapter ONLY for a resolved live route -- never
 *   for provider_not_available / unsupported combinations;
 * - never imports or calls any third-party identity or company-registry
 *   verification provider (this function is VerifyNow-only for person IDV);
 * - records the safe outcome into p5scr_idv_records via the existing
 *   p5scr_record_idv RPC (no raw insert into p5scr_idv_records);
 * - returns only safe status/result fields to the UI -- the raw
 *   provider payload is persisted admin-only and never returned to the
 *   caller.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as buildCorsHeaders, handleCors } from "../_shared/cors.ts";
import { resolveIdvRoute } from "../_shared/idv-route-table.ts";
import { verifyNowIdv } from "../_shared/verifynow/adapter.ts";

Deno.serve(async (req) => {
    const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "";
    const origin = req.headers.get("origin");
    const cors = buildCorsHeaders(allowedOrigins, origin);
    const pre = handleCors(req, allowedOrigins);
    if (pre) return pre;
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, req);

             try {
                   const authHeader = req.headers.get("authorization") || "";
                   const token = authHeader.replace(/^Bearer\s+/i, "");
                   if (!token) return json({ error: "UNAUTHORIZED" }, 401, req);

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
                   const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
                   const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
                   if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "MISCONFIGURED" }, 500, req);

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
                   const authed = createClient(supabaseUrl, anonKey, {
                           global: { headers: { Authorization: `Bearer ${token}` } },
                           auth: { persistSession: false },
                   });
                   const { data: userRes, error: userErr } = await authed.auth.getUser();
                   if (userErr || !userRes?.user) return json({ error: "UNAUTHORIZED" }, 401, req);
                   const userId = userRes.user.id;

      const body = await req.json().catch(() => null) as Record<string, unknown> | null;
                   if (!body) return json({ error: "BAD_REQUEST" }, 400, req);

      const subjectId = typeof body.subject_id === "string" ? body.subject_id : null;
                   const documentCountry = typeof body.document_country === "string" ? body.document_country : "";
                   const documentType = typeof body.document_type === "string" ? body.document_type : "";
                   const detailsText = typeof body.details_text === "string" ? body.details_text.slice(0, 1024) : "";
                   const clientPayload =
                           body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
                       ? (body.payload as Record<string, unknown>)
                             : null;

      if (!subjectId) return json({ error: "subject_id required" }, 400, req);
                   if (!documentCountry || !documentType) {
                           return json({ error: "document_country and document_type required" }, 400, req);
                   }

      // Ownership check -- subject must belong to the calling user. Never
      // trust a client-supplied subject_id without this check.
      const { data: subj, error: subjErr } = await admin
                     .from("p5scr_subjects")
                     .select("id, person_external_ref")
                     .eq("id", subjectId)
                     .maybeSingle();
                   if (subjErr) return json({ error: "SUBJECT_LOOKUP_FAILED" }, 500, req);
                   if (!subj || subj.person_external_ref !== userId) {
                           return json({ error: "FORBIDDEN" }, 403, req);
                   }

      // Route strictly by (document_country, document_type). This function
      // NEVER calls VerifyNow for a route that does not resolve to "route".
      const routeInput = { document_country: documentCountry, document_type: documentType };
                   const routeRes = resolveIdvRoute(routeInput);
                   if (routeRes.kind !== "route") {
                           // Defence in depth only -- /desk/idv/start should never call this
                     // function for a provider_not_available combination. No VerifyNow
                     // call is made; caller is told to use the manual-review path.
                     return json({
                               ok: false,
                               error: "PROVIDER_NOT_AVAILABLE",
                               message: "This document combination is not eligible for automated verification. Please use manual review.",
                     }, 200, req);
                   }

      // Build the payload sent to VerifyNow. Prefer a structured payload if
      // the caller supplies one matching the route's required_fields;
      // otherwise fall back to the free-text details field captured today.
      // This never weakens the safety mapping below -- any provider
      // rejection for missing/invalid fields resolves to a safe "manual
      // review required" outcome, never a false pass.
      const payload: Record<string, string> = {};
                   if (clientPayload) {
                           for (const f of routeRes.entry.required_fields) {
                                     const v = clientPayload[f];
                                     if (typeof v === "string") payload[f] = v;
                           }
                   }
                   if (Object.keys(payload).length === 0 && detailsText) {
                           payload.details_text = detailsText;
                   }

      const idempotencyKey = crypto.randomUUID();
                   const outcome = await verifyNowIdv({
                           route: routeInput,
                           payload,
                           idempotencyKey,
                   });

      // Persist the safe result via the existing RPC -- never a raw insert
      // into p5scr_idv_records.
      const resolved = outcome.resolved;
                   const state = resolved?.internal_status ?? "provider_error";
                   const { error: rpcErr } = await admin.rpc("p5scr_record_idv", {
                           p_subject_id: subjectId,
                           p_state: state,
                           p_provider_ref: outcome.provider_reference ?? null,
                           p_provider_live_now: false,
                           p_raw_provider_payload_admin_only: {
                                     route: routeInput,
                                     raw_outcome: outcome.raw_outcome,
                                     error_code: outcome.error_code ?? null,
                           },
                   });
                   if (rpcErr) {
                           console.error("[idv-person-verify] p5scr_record_idv failed", rpcErr.message);
                           return json({ error: "RECORD_FAILED", detail: rpcErr.message }, 500, req);
                   }

      // Best-effort audit; never fail the caller if the audit table is absent.
      try {
              await admin.from("audit_logs").insert({
                        actor_user_id: userId,
                        action: "idv.person_verify_completed",
                        entity_type: "p5scr_subject",
                        entity_id: subjectId,
                        metadata: {
                                    document_country: documentCountry,
                                    document_type: documentType,
                                    provider: outcome.provider,
                                    internal_status: state,
                                    unlocks_controlled_actions: resolved?.unlocks_controlled_actions ?? false,
                        },
              });
      } catch { /* audit best-effort */ }

      // Only safe fields are ever returned to the UI -- no raw provider
      // payload, no ID numbers, no biometric data.
      return json({
              ok: true,
              subject_id: subjectId,
              internal_status: state,
              unlocks_controlled_actions: resolved?.unlocks_controlled_actions ?? false,
      }, 200, req);
             } catch (e) {
                   console.error("[idv-person-verify] internal error", e);
                   return json({ error: "INTERNAL", message: e instanceof Error ? e.message : "unknown" }, 500, req);
             }
});

function json(payload: unknown, status: number, req: Request): Response {
    const origin = req.headers.get("origin");
    const cors = buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", origin);
    return new Response(JSON.stringify(payload), {
          status,
          headers: { ...cors, "Content-Type": "application/json" },
    });
}
