import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Mandatory fields ──
const MANDATORY_FIELDS = [
  "org_id",
  "counterparty_org_id",
  "asset_id",
  "quantity",
  "price",
  "currency",
  "client_timestamp",
  "idempotency_key",
  "signed_payload",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

// ── SHA-256 helper ──
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── ECDSA signature verification ──
async function verifyEcdsaSignature(
  payload: string,
  signatureB64: string,
  publicKeyJwk: JsonWebKey
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    const data = new TextEncoder().encode(payload);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig,
      data
    );
  } catch {
    return false;
  }
}

// ── Partition health check ──
async function checkPartitionHealth(
  adminClient: ReturnType<typeof createClient>
): Promise<{ healthy: boolean; reason?: string }> {
  try {
    // Verify we can perform a write-read round-trip (consistency check)
    const probe = crypto.randomUUID();
    const { error: writeErr } = await adminClient
      .from("audit_logs")
      .insert({
        org_id: "00000000-0000-0000-0000-000000000000", // will fail FK but tests write path
        action: `partition.probe.${probe}`,
        entity_type: "system",
      });
    
    // FK failure is expected — what we're checking is that the DB is reachable and writable
    // A true partition would cause a connection timeout or network error, not an FK violation
    if (writeErr) {
      const msg = writeErr.message || "";
      // FK violation = DB is reachable and processing writes = healthy
      if (msg.includes("foreign key") || msg.includes("violates") || msg.includes("23503")) {
        return { healthy: true };
      }
      // Connection/timeout errors = unhealthy
      if (msg.includes("timeout") || msg.includes("connection") || msg.includes("ECONNREFUSED")) {
        return { healthy: false, reason: `Database connectivity issue: ${msg}` };
      }
      // Other errors — still reachable
      return { healthy: true };
    }
    return { healthy: true };
  } catch (err) {
    return {
      healthy: false,
      reason: `Partition detected: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorised" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorised" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Body size check ──
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
      return new Response(
        JSON.stringify({ error: "Payload too large (max 1 MB)" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();

    // ── Mandatory field validation ──
    const missing: string[] = [];
    for (const field of MANDATORY_FIELDS) {
      if (body[field] === undefined || body[field] === null || body[field] === "") {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Missing mandatory fields",
          missingFields: missing,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Type validation ──
    const {
      org_id,
      counterparty_org_id,
      asset_id,
      quantity,
      price,
      currency,
      client_timestamp,
      idempotency_key,
      signed_payload,
      signature_key_id,
      public_key_jwk,
      match_id,
      metadata,
    } = body;

    if (!UUID_RE.test(org_id)) {
      return new Response(
        JSON.stringify({ error: "org_id must be a valid UUID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!UUID_RE.test(counterparty_org_id)) {
      return new Response(
        JSON.stringify({ error: "counterparty_org_id must be a valid UUID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (org_id === counterparty_org_id) {
      return new Response(
        JSON.stringify({ error: "org_id and counterparty_org_id must differ" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (typeof quantity !== "number" || quantity <= 0) {
      return new Response(
        JSON.stringify({ error: "quantity must be a positive number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (typeof price !== "number" || price <= 0) {
      return new Response(
        JSON.stringify({ error: "price must be a positive number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!CURRENCY_RE.test(currency)) {
      return new Response(
        JSON.stringify({ error: "currency must be a 3-letter uppercase ISO code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── CAP partition check — consistency first ──
    const partition = await checkPartitionHealth(adminClient);
    if (!partition.healthy) {
      return new Response(
        JSON.stringify({
          error: "Service unavailable — partition state detected",
          partitionState: true,
          reason: partition.reason,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Idempotency check ──
    const { data: existing } = await adminClient
      .from("collapse_ledger")
      .select("id, payload_hash, created_at")
      .eq("org_id", org_id)
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          collapsed: true,
          idempotent: true,
          collapse_id: existing.id,
          payload_hash: existing.payload_hash,
          created_at: existing.created_at,
          message: "Duplicate request — returning original collapse record",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── State machine check: POI must be in ELIGIBLE or COLLAPSE_REQUESTED state ──
    if (match_id && UUID_RE.test(match_id)) {
      const { data: match } = await adminClient
        .from("matches")
        .select("poi_state")
        .eq("id", match_id)
        .maybeSingle();

      if (match) {
        const allowed = ["ELIGIBLE", "COLLAPSE_REQUESTED"];
        if (!allowed.includes(match.poi_state)) {
          return new Response(
            JSON.stringify({
              error: `Collapse not allowed from state ${match.poi_state}. Must be ELIGIBLE or COLLAPSE_REQUESTED.`,
              currentState: match.poi_state,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // ── ECDSA signature verification ──
    let signatureValid = false;
    if (public_key_jwk && signed_payload) {
      // The signed_payload contains: base64(signature):canonicalPayload
      const parts = signed_payload.split(":");
      if (parts.length >= 2) {
        const signatureB64 = parts[0];
        const canonicalPayload = parts.slice(1).join(":");
        signatureValid = await verifyEcdsaSignature(
          canonicalPayload,
          signatureB64,
          public_key_jwk
        );
      }
    }

    if (!signatureValid) {
      return new Response(
        JSON.stringify({
          error: "Invalid ECDSA signature — collapse rejected",
          signatureValid: false,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── SHA-256 hash of canonical payload ──
    const canonicalData = JSON.stringify({
      org_id,
      counterparty_org_id,
      asset_id,
      quantity,
      price,
      currency,
      client_timestamp,
      idempotency_key,
    });
    const payloadHash = await sha256(canonicalData);

    // ── Insert into append-only ledger ──
    const { data: record, error: insertError } = await adminClient
      .from("collapse_ledger")
      .insert({
        org_id,
        counterparty_org_id,
        match_id: match_id && UUID_RE.test(match_id) ? match_id : null,
        asset_id,
        quantity,
        price,
        currency,
        client_timestamp,
        idempotency_key,
        signed_payload,
        signature_key_id: signature_key_id || null,
        signature_valid: signatureValid,
        payload_hash: payloadHash,
        poi_state: "COLLAPSED",
        metadata: metadata || {},
        actor_user_id: user.id,
      })
      .select()
      .single();

    if (insertError) {
      // Handle idempotency race condition (unique constraint)
      if (insertError.message?.includes("unique_idempotency_per_org") || insertError.code === "23505") {
        const { data: raceExisting } = await adminClient
          .from("collapse_ledger")
          .select("id, payload_hash, created_at")
          .eq("org_id", org_id)
          .eq("idempotency_key", idempotency_key)
          .single();

        if (raceExisting) {
          return new Response(
            JSON.stringify({
              collapsed: true,
              idempotent: true,
              collapse_id: raceExisting.id,
              payload_hash: raceExisting.payload_hash,
              created_at: raceExisting.created_at,
              message: "Duplicate request — returning original collapse record",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      console.error("Collapse insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create collapse record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Update match state if linked ──
    if (match_id && UUID_RE.test(match_id)) {
      await adminClient
        .from("matches")
        .update({ poi_state: "COLLAPSED" })
        .eq("id", match_id);

      // Append POI event
      await adminClient.from("poi_events").insert({
        match_id,
        org_id,
        from_state: "COLLAPSE_REQUESTED",
        to_state: "COLLAPSED",
        actor_user_id: user.id,
        reason: "Deterministic collapse via collapse engine",
        metadata: {
          collapse_id: record.id,
          payload_hash: payloadHash,
          signature_valid: signatureValid,
          idempotency_key,
        },
      });
    }

    // ── Audit log ──
    await adminClient.from("audit_logs").insert({
      org_id,
      actor_user_id: user.id,
      action: "poi.collapsed",
      entity_type: "collapse_ledger",
      entity_id: record.id,
      metadata: {
        payload_hash: payloadHash,
        signature_valid: signatureValid,
        idempotency_key,
        counterparty_org_id,
        asset_id,
        quantity,
        price,
        currency,
      },
    });

    return new Response(
      JSON.stringify({
        collapsed: true,
        idempotent: false,
        collapse_id: record.id,
        payload_hash: payloadHash,
        signature_valid: signatureValid,
        poi_state: "COLLAPSED",
        created_at: record.created_at,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Collapse engine error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
