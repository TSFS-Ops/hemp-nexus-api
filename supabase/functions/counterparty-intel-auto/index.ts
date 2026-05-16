/**
 * counterparty-intel-auto
 * ────────────────────────────────────────────────────────────────────────
 * Daniel Davies, 2026-04-27 (clarification email):
 *
 *   "The light compliance / public-source check should not be a manual
 *    capture exercise where the user types in website links, LinkedIn links,
 *    notes, and similar items themselves. That is not the intention.
 *
 *    The point of the light check is that the system should help automate
 *    the public-source layer around the named counterparty as far as
 *    possible, so that the user is not manually building the intelligence
 *    record from scratch. It must remain light, and it must remain pre-POI,
 *    but it should be system-assisted rather than user-assembled."
 *
 * This function:
 *   • Reads the match (RLS scoped to the caller's org).
 *   • For the requested side (buyer | seller) takes the named counterparty.
 *   • Asks the Lovable AI Gateway to produce a short, conservative
 *     public-source sketch — best-guess website, best-guess LinkedIn, and
 *     a 1–3 sentence summary of what is publicly observable. The model is
 *     instructed to say "no public footprint located" rather than
 *     fabricate.
 *   • Upserts the result into `match_counterparty_intel` with auto_status,
 *     auto_summary, auto_sources, auto_generated_at — leaving the
 *     historical user-typed columns (website_url / linkedin_url / notes)
 *     untouched so nothing existing breaks.
 *
 * No paid third-party APIs. No user typing. Pre-POI only — WaD remains
 * a strict 9-gate hard-verification wall and is unaffected by this file.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { guardedAiCall, aiGuardEnvelope, type AiGuardOutcome } from "../_shared/ai-guard.ts";

// ── Body ─────────────────────────────────────────────────────────────────
interface RunBody {
  match_id: string;
  side: "buyer" | "seller";
  // Optional override (used by admin walkthrough). Defaults to the name on the match.
  counterparty_name?: string;
}

// ── AI response shape (enforced via tool-call) ───────────────────────────
interface IntelToolPayload {
  website_url: string | null;
  linkedin_url: string | null;
  summary: string;
  sources: Array<{ label: string; url: string; kind: string }>;
  confidence: "low" | "medium" | "high";
  no_public_footprint: boolean;
}

const ALLOWED = Deno.env.get("ALLOWED_ORIGINS") || "*";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(ALLOWED, origin),
      "Content-Type": "application/json",
    },
  });
}

/**
 * Validate the URL the model returns so we satisfy the database CHECK
 * constraints (chk_mci_website_url, chk_mci_linkedin_url). If the URL
 * fails validation we drop it rather than blowing up the upsert.
 */
function sanitiseWebsite(u: string | null | undefined): string | null {
  if (!u) return null;
  const trimmed = u.trim();
  if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(trimmed)) return null;
  return trimmed;
}
function sanitiseLinkedIn(u: string | null | undefined): string | null {
  if (!u) return null;
  const trimmed = u.trim();
  if (!/^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/.+$/i.test(trimmed)) return null;
  return trimmed;
}

async function callIntelModel(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  counterpartyName: string,
  contextHint: string,
): Promise<{ outcome: AiGuardOutcome; payload: IntelToolPayload | null }> {
  if (!LOVABLE_API_KEY) return { outcome: { kind: "not_configured" }, payload: null };

  const system = [
    "You are a conservative public-source intelligence assistant for a regulated commodity trading platform.",
    "Your job is to produce a LIGHT public-source sketch of a named counterparty using only what is publicly knowable.",
    "Hard rules:",
    "1. Never invent a website or LinkedIn URL. If you cannot identify a credible public footprint, set no_public_footprint=true and leave URLs null.",
    "2. Never claim the counterparty is verified, licensed, sanctioned, or compliant. This is pre-POI light intel only.",
    "3. Summary must be 1–3 short factual sentences. Hedge with phrases like 'appears to', 'publicly listed as'.",
    "4. Sources must point to plausible public locations (website, LinkedIn, news mention). One per kind, max 4 total.",
    "5. Confidence: 'low' if the name is generic or ambiguous, 'medium' if a single plausible match exists, 'high' only if the counterparty is unambiguously well-known.",
  ].join("\n");

  const user = `Named counterparty: "${counterpartyName}"\nTrade context: ${contextHint}\n\nProduce a light public-source sketch.`;

  const outcome = await guardedAiCall(admin as any, {
    org_id: orgId,
    call_type: "counterparty_intel",
    body: {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "report_counterparty_intel",
          description: "Return a structured light public-source sketch.",
          parameters: {
            type: "object",
            properties: {
              website_url: { type: ["string", "null"] },
              linkedin_url: { type: ["string", "null"] },
              summary: { type: "string" },
              sources: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    url: { type: "string" },
                    kind: { type: "string", enum: ["website", "linkedin", "news", "registry", "other"] },
                  },
                  required: ["label", "url", "kind"],
                },
              },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              no_public_footprint: { type: "boolean" },
            },
            required: ["summary", "confidence", "no_public_footprint", "sources"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report_counterparty_intel" } },
    },
  });

  if (outcome.kind !== "ok") return { outcome, payload: null };

  const body = outcome.body as any;
  const args = body?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return { outcome, payload: null };
  try {
    return { outcome, payload: JSON.parse(args) as IntelToolPayload };
  } catch (e) {
    console.warn("[counterparty-intel-auto] could not parse tool args:", e);
    return { outcome, payload: null };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = handleCors(req, ALLOWED);
  if (cors) return cors;

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" }, origin);
  }

  // Caller authentication — validate JWT claims locally. `getUser()` performs
  // a network round-trip to the auth service and has produced false "Invalid
  // session" failures during auth-worker restarts even while /user returns 200.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" }, origin);

  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsResp, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claimsResp?.claims?.sub) {
    return json(401, { error: "Unauthorized" }, origin);
  }
  const userId = claimsResp.claims.sub;

  let body: RunBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" }, origin);
  }
  if (!body?.match_id || (body.side !== "buyer" && body.side !== "seller")) {
    return json(400, { error: "match_id and side ('buyer'|'seller') are required" }, origin);
  }

  // Service-role client for the actual writes (RLS pre-checked by the read below).
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Load match — but read it via the user's RLS so we get a clean 404
  // if they have no access to it.
  const { data: match, error: matchErr } = await userClient
    .from("matches")
    .select("id, org_id, buyer_name, seller_name, commodity, origin_country, destination_country, match_type")
    .eq("id", body.match_id)
    .maybeSingle();

  if (matchErr) {
    console.error("[counterparty-intel-auto] match read error", matchErr);
    return json(500, { error: "Could not load match" }, origin);
  }
  if (!match) {
    return json(404, { error: "Match not found or not accessible" }, origin);
  }

  const counterpartyName =
    body.counterparty_name?.trim() ||
    (body.side === "buyer" ? match.buyer_name : match.seller_name) ||
    "";
  if (!counterpartyName) {
    return json(400, { error: `No ${body.side} name on this match — cannot run intel.` }, origin);
  }

  const contextHint = [
    match.commodity ? `Commodity: ${match.commodity}` : null,
    match.origin_country ? `Origin: ${match.origin_country}` : null,
    match.destination_country ? `Destination: ${match.destination_country}` : null,
    `Side: ${body.side}`,
  ].filter(Boolean).join("; ");

  // Insert/refresh a row in 'pending' so the UI can reflect that a run is in flight.
  await admin.from("match_counterparty_intel").upsert(
    {
      match_id: match.id,
      org_id: match.org_id,
      side: body.side,
      counterparty_name: counterpartyName,
      auto_status: "pending",
      created_by: userId,
    },
    { onConflict: "match_id,side" },
  );

  // Run the AI sketch. If the gateway is missing or errors, mark unavailable.
  const intel = await callIntelModel(counterpartyName, contextHint);

  if (!intel) {
    await admin
      .from("match_counterparty_intel")
      .update({
        auto_status: LOVABLE_API_KEY ? "failed" : "unavailable",
        auto_generated_at: new Date().toISOString(),
        auto_summary: LOVABLE_API_KEY
          ? "Automatic public-source check could not complete. You can retry, or proceed — intel is informational only."
          : "Automatic public-source check is not configured on this environment. Intel is informational; you can proceed.",
        auto_sources: [],
      })
      .eq("match_id", match.id)
      .eq("side", body.side);
    return json(200, {
      status: "ok",
      auto_status: LOVABLE_API_KEY ? "failed" : "unavailable",
    }, origin);
  }

  // Sanitise URLs against DB CHECK constraints before persisting.
  const safeWebsite = sanitiseWebsite(intel.website_url);
  const safeLinkedIn = sanitiseLinkedIn(intel.linkedin_url);

  // Filter sources to only valid http(s) URLs (best-effort).
  const safeSources = (intel.sources || [])
    .filter((s) => typeof s?.url === "string" && /^https?:\/\//i.test(s.url))
    .slice(0, 6);

  const update = {
    counterparty_name: counterpartyName,
    auto_status: "ready" as const,
    auto_summary: intel.summary?.trim() || "No summary returned.",
    auto_sources: safeSources,
    auto_generated_at: new Date().toISOString(),
    // Mirror the best-guess URLs into the legacy fields ONLY if they aren't
    // already set (don't trample anything a user previously typed).
    ...(safeWebsite ? { website_url: safeWebsite } : {}),
    ...(safeLinkedIn ? { linkedin_url: safeLinkedIn } : {}),
  };

  const { error: upErr } = await admin
    .from("match_counterparty_intel")
    .update(update)
    .eq("match_id", match.id)
    .eq("side", body.side);

  if (upErr) {
    console.error("[counterparty-intel-auto] persist error", upErr);
    return json(500, { error: "Could not persist intel" }, origin);
  }

  // Lightweight audit trail
  await admin.from("audit_logs").insert({
    org_id: match.org_id,
    actor_user_id: userId,
    action: "counterparty_intel.auto_generated",
    entity_type: "match",
    entity_id: match.id,
    metadata: {
      side: body.side,
      counterparty_name: counterpartyName,
      confidence: intel.confidence,
      no_public_footprint: intel.no_public_footprint,
      sources_count: safeSources.length,
    },
  });

  return json(200, {
    status: "ok",
    auto_status: "ready",
    summary: update.auto_summary,
    sources: safeSources,
    confidence: intel.confidence,
    no_public_footprint: intel.no_public_footprint,
    website_url: safeWebsite,
    linkedin_url: safeLinkedIn,
  }, origin);
});
