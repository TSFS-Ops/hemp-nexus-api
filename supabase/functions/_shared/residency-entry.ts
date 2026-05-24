/**
 * DATA-009 Phase 2 — entry helper for chokepoint edge functions.
 *
 * One-line gate: clones the incoming Request, peeks { match_id } or
 * { match_request: { match_id } } or { wad_id }, resolves the buyer +
 * seller orgs via `matches`, and returns a stable 409 ResidencyBlock
 * response when EITHER side has an open residency_review onboarding
 * hold. Pure policy gate — never mutates region/storage/backup state.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  checkResidencyHoldAny,
  residencyBlockResponse,
} from "./residency-claim-guard.ts";

const DEFAULT_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
} as const;

async function peekBodyJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const clone = req.clone();
    const txt = await clone.text();
    if (!txt) return null;
    return JSON.parse(txt) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractMatchId(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const candidates = [
    (body as { match_id?: unknown }).match_id,
    ((body as { match_request?: { match_id?: unknown } }).match_request ?? {})
      .match_id,
    (body as { matchId?: unknown }).matchId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/**
 * Returns a `Response` (409) if residency hold blocks this call.
 * Returns `null` to let the caller proceed.
 */
export async function residencyGateForMatchRequest(
  admin: SupabaseClient,
  req: Request,
  cors: Record<string, string> = DEFAULT_CORS,
): Promise<Response | null> {
  const body = await peekBodyJson(req);
  const matchId = extractMatchId(body);
  if (!matchId) return null;
  try {
    const { data: match } = await admin
      .from("matches")
      .select("buyer_org_id, seller_org_id, org_id")
      .eq("id", matchId)
      .maybeSingle();
    if (!match) return null;
    const block = await checkResidencyHoldAny(admin, [
      match.buyer_org_id ?? null,
      match.seller_org_id ?? null,
      match.org_id ?? null,
    ]);
    if (block) return residencyBlockResponse(block, cors);
    return null;
  } catch (e) {
    console.error("[residency-entry] lookup failed:", e);
    return null;
  }
}
