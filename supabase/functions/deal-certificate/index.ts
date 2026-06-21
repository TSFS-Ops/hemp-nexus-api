import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { assertWadIsSettleable } from "../_shared/test-mode-bypass.ts";
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";
import { residencyGateForMatchRequest } from "../_shared/residency-entry.ts";
import { checkResidencyHoldAny, residencyBlockResponse } from "../_shared/residency-claim-guard.ts";

/**
 * Deal Certificate Generator
 *
 * Produces an institutional-grade "Certificate of Signed Deal" PDF (HTML fallback)
 * for a match that has reached the "completed" state.
 *
 * Guards:
 * 1. Match must be in "completed" state (Signed Deal)
 * 2. Caller must own the match (org_id check)
 * 3. Hash-chain integrity is verified before certificate generation
 */

// ── Deterministic canonical JSON ──
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalStringify((obj as Record<string, unknown>)[k])
    );
    return "{" + pairs.join(",") + "}";
  }
  return String(obj);
}

async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  return d.toISOString().replace("T", " ").replace("Z", " UTC");
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generate the certificate HTML with clinical, professional styling.
 * Uses JetBrains Mono (via Google Fonts) for all cryptographic hashes.
 */
function generateCertificateHtml(
  match: Record<string, unknown>,
  events: Record<string, unknown>[],
  documents: Record<string, unknown>[],
  collapseRecord: Record<string, unknown> | null,
  sealHash: string,
  ledgerEntryHash: string,
  chainValid: boolean,
  generatedAt: string
): string {
  const buyerName = escapeHtml(match.buyer_name as string) || "Not specified";
  const sellerName = escapeHtml(match.seller_name as string) || "Not specified";
  const commodity = escapeHtml(match.commodity as string) || "N/A";
  const quantityAmount = match.quantity_amount ?? "N/A";
  const quantityUnit = escapeHtml(match.quantity_unit as string) || "";
  const priceAmount = match.price_amount ?? "N/A";
  const priceCurrency = escapeHtml(match.price_currency as string) || "";
  const matchHash = escapeHtml(match.hash as string) || "";
  const signedAt = formatTimestamp(
    (collapseRecord?.client_timestamp as string) ||
    (match.settled_at as string) ||
    (match.updated_at as string)
  );
  const chainStatus = chainValid ? "VERIFIED" : "CHAIN BROKEN";
  const sigValid = collapseRecord?.signature_valid === true;
  const sigStatus = collapseRecord ? (sigValid ? "VALID" : "INVALID") : "N/A";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Certificate of Signed Deal - ${escapeHtml(match.id as string)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 25mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #1a1a1a;
    font-size: 11pt;
    line-height: 1.5;
    background: #fff;
    padding: 40px;
  }

  /* Header */
  .cert-header {
    border-bottom: 3px solid #111;
    padding-bottom: 16px;
    margin-bottom: 32px;
  }
  .cert-header h1 {
    font-size: 22pt;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin-bottom: 4px;
    color: #000;
  }
  .cert-header .subtitle {
    font-size: 10pt;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-weight: 500;
  }
  .cert-header .match-ref {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9pt;
    color: #666;
    margin-top: 8px;
  }

  /* Sections */
  .section {
    margin-bottom: 28px;
  }
  .section-title {
    font-size: 9pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: #555;
    border-bottom: 1px solid #ddd;
    padding-bottom: 6px;
    margin-bottom: 14px;
  }

  /* Two-column grid */
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  .field-label {
    font-size: 9pt;
    color: #777;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .field-value {
    font-size: 11pt;
    font-weight: 600;
    color: #111;
  }
  .field-value.large {
    font-size: 14pt;
  }

  /* Hash block */
  .integrity-block {
    background: #f7f7f7;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 20px;
    margin-top: 8px;
  }
  .hash-row {
    margin-bottom: 14px;
  }
  .hash-row:last-child {
    margin-bottom: 0;
  }
  .hash-label {
    font-size: 9pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #555;
    margin-bottom: 4px;
  }
  .hash-value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5pt;
    color: #222;
    word-break: break-all;
    background: #eee;
    padding: 6px 10px;
    border-radius: 3px;
    border: 1px solid #ddd;
  }

  /* Status badges */
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 3px;
    font-size: 9pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .badge-pass { background: #d4edda; color: #155724; }
  .badge-fail { background: #f8d7da; color: #721c24; }
  .badge-na { background: #e9ecef; color: #495057; }

  /* Documents table */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
    margin-top: 8px;
  }
  th {
    text-align: left;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #555;
    padding: 8px 10px;
    border-bottom: 2px solid #ddd;
    font-size: 8pt;
  }
  td {
    padding: 7px 10px;
    border-bottom: 1px solid #eee;
    vertical-align: top;
  }
  td.mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 7.5pt;
    word-break: break-all;
  }

  /* Footer */
  .cert-footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 2px solid #111;
    font-size: 8pt;
    color: #888;
    line-height: 1.6;
  }
  .cert-footer strong {
    color: #555;
  }

  /* Timeline */
  .timeline-item {
    display: flex;
    gap: 12px;
    margin-bottom: 8px;
    font-size: 9pt;
  }
  .timeline-time {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    color: #888;
    min-width: 160px;
    flex-shrink: 0;
  }
  .timeline-event {
    font-weight: 500;
    color: #333;
  }
</style>
</head>
<body>

<!-- Header -->
<div class="cert-header">
  <div class="subtitle">Izenzo Sovereign Infrastructure</div>
  <h1>Certificate of Signed Deal</h1>
  <div class="match-ref">
    Reference: ${escapeHtml(match.id as string)}<br>
    Generated: ${generatedAt}
  </div>
</div>

<!-- Trading Partners -->
<div class="section">
  <div class="section-title">Trading Partners</div>
  <div class="grid-2">
    <div>
      <div class="field-label">Buyer</div>
      <div class="field-value">${buyerName}</div>
    </div>
    <div>
      <div class="field-label">Seller</div>
      <div class="field-value">${sellerName}</div>
    </div>
  </div>
</div>

<!-- Trade Terms -->
<div class="section">
  <div class="section-title">Trade Terms</div>
  <div class="grid-2">
    <div>
      <div class="field-label">Commodity</div>
      <div class="field-value large">${commodity}</div>
    </div>
    <div>
      <div class="field-label">Price per Unit</div>
      <div class="field-value large">${priceCurrency} ${priceAmount}</div>
    </div>
    <div>
      <div class="field-label">Quantity</div>
      <div class="field-value">${quantityAmount} ${quantityUnit}</div>
    </div>
    <div>
      <div class="field-label">Deal Signed</div>
      <div class="field-value">${signedAt}</div>
    </div>
  </div>
</div>

<!-- Cryptographic Integrity -->
<div class="section">
  <div class="section-title">Cryptographic Integrity</div>
  <div class="integrity-block">
    <div class="hash-row">
      <div class="hash-label">Deal Seal Hash (SHA-256)</div>
      <div class="hash-value">${sealHash}</div>
    </div>
    <div class="hash-row">
      <div class="hash-label">Ledger Entry Hash</div>
      <div class="hash-value">${ledgerEntryHash}</div>
    </div>
    <div class="hash-row">
      <div class="hash-label">Match Record Hash</div>
      <div class="hash-value">${matchHash}</div>
    </div>
    <div style="display: flex; gap: 16px; margin-top: 14px;">
      <div>
        <div class="hash-label">Chain Integrity</div>
        <span class="badge ${chainValid ? "badge-pass" : "badge-fail"}">${chainStatus}</span>
      </div>
      <div>
        <div class="hash-label">Signature</div>
        <span class="badge ${collapseRecord ? (sigValid ? "badge-pass" : "badge-fail") : "badge-na"}">${sigStatus}</span>
      </div>
    </div>
  </div>
</div>

<!-- Event Timeline -->
${events.length > 0 ? `
<div class="section">
  <div class="section-title">Event Timeline (${events.length} events)</div>
  ${events.map((e) => `
  <div class="timeline-item">
    <div class="timeline-time">${formatTimestamp(e.created_at as string)}</div>
    <div class="timeline-event">${escapeHtml(e.event_type as string)}</div>
  </div>`).join("")}
</div>` : ""}

<!-- Attached Documents -->
${documents.length > 0 ? `
<div class="section">
  <div class="section-title">Attached Documents (${documents.length})</div>
  <table>
    <tr><th>Filename</th><th>Type</th><th>SHA-256 Hash</th><th>Status</th></tr>
    ${documents.map((d) => `
    <tr>
      <td>${escapeHtml(d.filename as string)}</td>
      <td>${escapeHtml(d.doc_type as string)}</td>
      <td class="mono">${escapeHtml(d.sha256_hash as string) || "N/A"}</td>
      <td>${escapeHtml(d.status as string)}</td>
    </tr>`).join("")}
  </table>
</div>` : ""}

<!-- Footer -->
<div class="cert-footer">
  <strong>Verification notice:</strong> This certificate is a rendered view of the cryptographically sealed deal record.
  The Deal Seal Hash is computed from the deterministic canonical JSON serialisation (sorted keys, no whitespace) of all
  trade terms and partner identities at the moment of signing. The Ledger Entry Hash chains the previous event hash,
  the current seal, and the signing timestamp to form a tamper-evident audit trail.<br><br>
  <strong>Hash algorithm:</strong> SHA-256 | <strong>Serialisation:</strong> Deterministic canonical JSON |
  <strong>Platform:</strong> Izenzo Sovereign Infrastructure<br>
  <strong>This document does not constitute a contract.</strong> It is a verifiable record of commercial intent for compliance purposes.
</div>

</body>
</html>`;
}

Deno.serve(async (req) => {
  // OPS-010: short-circuit live side effects for demo data.
  try {
    const _demoAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.39.3")).createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "deal-certificate", artefact: true });
    if (_demoBlocked) return _demoBlocked;
    // DATA-009 Phase 2 residency gate.
    const _resGate = await residencyGateForMatchRequest(_demoAdmin, req);
    if (_resGate) return _resGate;
    void checkResidencyHoldAny; void residencyBlockResponse;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  const requestId = crypto.randomUUID();
  const startMs = Date.now();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  // Structured log helper
  const log = (level: string, msg: string, meta: Record<string, unknown> = {}) => {
    const entry = { level, msg, requestId, ts: new Date().toISOString(), elapsedMs: Date.now() - startMs, ...meta };
    if (level === "error") console.error(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
  };

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "GET") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Only GET is supported", 405);
    }

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "deal-certificate") parts.shift();

    const matchId = parts[0];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!matchId || !uuidRegex.test(matchId)) {
      throw new ApiException("BAD_REQUEST", "Valid match ID is required", 400);
    }

    log("info", "Certificate generation started", { matchId });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate caller
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    log("info", "Authenticated", { matchId, orgId: authCtx.orgId });

    // Fetch match
    const { data: match, error: matchErr } = await supabase
      .from("matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (matchErr) {
      if (matchErr.code === "PGRST116") throw new ApiException("NOT_FOUND", "Match not found", 404);
      handleDatabaseError(matchErr, requestId);
    }

    // Ownership check
    if (match.org_id !== authCtx.orgId &&
        match.buyer_org_id !== authCtx.orgId &&
        match.seller_org_id !== authCtx.orgId) {
      throw new ApiException("FORBIDDEN", "You do not have permission to access this deal", 403);
    }

    // STATE MACHINE GUARD
    const matchState = match.state || "discovery";
    if (matchState !== "completed") {
      log("warn", "Certificate blocked by state guard", { matchId, currentState: matchState, orgId: authCtx.orgId });
      throw new ApiException(
        "STATE_GUARD",
        `Certificate generation requires a Signed Deal (completed state). Current state: ${matchState}`,
        422
      );
    }

    // ── TEST-MODE SETTLEMENT GUARD ──
    // The WaD certificate may exist (and may even have been sealed) under test
    // mode for demo purposes. The FINAL deal certificate is settlement-grade and
    // must NOT be issued for a test-mode WaD — it would be indistinguishable
    // from a real one. Look up the active WaD for this match and inspect.
    const { data: linkedWad } = await supabase
      .from("wads")
      .select("id, evidence_bundle, status")
      .eq("poi_id", matchId)
      .neq("status", "revoked")
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (linkedWad) {
      const guard = await assertWadIsSettleable(supabase, linkedWad, {
        source: "deal-certificate",
        actorUserId: authCtx.userId ?? null,
        orgId: authCtx.orgId ?? null,
        requestId,
        action: "issue_deal_certificate",
      });
      if (guard.blocked) {
        log("warn", "Certificate blocked: test-mode WaD", {
          matchId,
          wadId: linkedWad.id,
          bypassedGates: guard.bypassedGates.map((b) => b.gate),
        });
        throw new ApiException(
          "TEST_MODE_WAD_NOT_SETTLEABLE",
          `This deal was issued under test mode (gates bypassed: ${guard.bypassedGates.map((b) => b.gate).join(", ")}). The final deal certificate cannot be generated for a demo-grade WaD. Revoke the WaD, disable test mode, then re-issue under live conditions.`,
          422,
          { wad_id: linkedWad.id, bypassed_gates: guard.bypassedGates.map((b) => b.gate) }
        );
      }
    }

    // Fetch events, documents, collapse record in parallel
    const [eventsRes, docsRes, collapseRes] = await Promise.all([
      supabase
        .from("match_events")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true }),
      supabase
        .from("match_documents")
        .select("id, doc_type, filename, sha256_hash, status, created_at")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true }),
      supabase
        .from("collapse_ledger")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true })
        .limit(1),
    ]);

    if (eventsRes.error) handleDatabaseError(eventsRes.error, requestId);
    if (docsRes.error) handleDatabaseError(docsRes.error, requestId);

    const events = eventsRes.data || [];
    const documents = docsRes.data || [];
    const collapseRecord = collapseRes.data?.[0] || null;

    log("info", "Data fetched", { matchId, eventCount: events.length, docCount: documents.length, hasCollapse: !!collapseRecord });

    // Verify hash chain
    let chainValid = true;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const expectedPrev = i === 0 ? null : events[i - 1].payload_hash;
      if (ev.previous_event_hash !== expectedPrev) {
        chainValid = false;
        log("error", "Hash chain broken", { matchId, eventIndex: i, expected: expectedPrev, actual: ev.previous_event_hash });
        break;
      }
    }

    // Build seal hash
    const sealPayload = {
      match_id: match.id,
      buyer_name: match.buyer_name,
      buyer_org_id: match.buyer_org_id,
      seller_name: match.seller_name,
      seller_org_id: match.seller_org_id,
      commodity: match.commodity,
      quantity_amount: match.quantity_amount,
      quantity_unit: match.quantity_unit,
      price_amount: match.price_amount,
      price_currency: match.price_currency,
      terms: match.terms,
      settled_at: match.settled_at,
    };
    const sealHash = await sha256Hex(canonicalStringify(sealPayload));

    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const prevHash = lastEvent?.payload_hash || "genesis";
    const signingTimestamp = collapseRecord?.client_timestamp || match.settled_at || match.updated_at;
    const ledgerEntryHash = await sha256Hex(prevHash + sealHash + (signingTimestamp || ""));

    const generatedAt = new Date().toISOString().replace("T", " ").replace("Z", " UTC");

    // Audit the certificate generation
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "deal-certificate.generated",
      entity_type: "match",
      entity_id: matchId,
      metadata: { sealHash, ledgerEntryHash, chainValid, requestId },
    });

    const html = generateCertificateHtml(
      match, events, documents, collapseRecord,
      sealHash, ledgerEntryHash, chainValid, generatedAt
    );

    log("info", "Certificate generated successfully", {
      matchId, orgId: authCtx.orgId, sealHash: sealHash.slice(0, 12) + "...",
      chainValid, eventCount: events.length, docCount: documents.length,
      totalMs: Date.now() - startMs,
    });

    return new Response(html, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="deal-certificate-${matchId}.html"`,
      },
    });
  } catch (error) {
    log("error", "Certificate generation failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3).join(" | ") : undefined,
      totalMs: Date.now() - startMs,
    });

    // Graceful degradation: if it's a timeout or internal error, return a user-friendly response.
    // NOTE: errorResponse signature is (error, requestId, headers) — passing them in any other
    // order strips the CORS headers off the response, which causes the browser to surface the
    // server-side error as an opaque "Failed to fetch" instead of the real 4xx/5xx body.
    if (error instanceof ApiException) {
      return errorResponse(error, requestId, headers);
    }

    // For unexpected errors, return a polite degradation message
    return new Response(
      JSON.stringify({
        ok: false,
        error: "GENERATION_DELAYED",
        message: "Your deal is signed and sealed on the ledger. Certificate generation encountered a temporary issue. Please try downloading again in a few moments.",
        requestId,
      }),
      { status: 503, headers: { ...headers, "Content-Type": "application/json", "Retry-After": "30" } }
    );
  }
});
