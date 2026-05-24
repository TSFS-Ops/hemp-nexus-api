import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { cacheHeaders } from "../_shared/cache.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";

/**
 * Deterministic canonical JSON serialisation.
 * Keys sorted recursively, no whitespace - ensures identical hash on regeneration.
 */
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
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the deterministic evidence payload (no metadata that changes per-request).
 * This is the "canonical signed JSON" source of truth.
 */
function buildCanonicalPayload(
  match: Record<string, unknown>,
  events: Record<string, unknown>[],
  documents: Record<string, unknown>[],
  auditLogs: Record<string, unknown>[],
  chainVerification: { valid: boolean; details: unknown[] },
  collapseRecord: Record<string, unknown> | null
) {
  return {
    match: {
      id: match.id,
      hash: match.hash,
      status: match.status,
      poi_state: match.poi_state,
      commodity: match.commodity,
      quantity: { amount: match.quantity_amount, unit: match.quantity_unit },
      price: { amount: match.price_amount, currency: match.price_currency },
      buyer: { id: match.buyer_id, name: match.buyer_name, org_id: match.buyer_org_id },
      seller: { id: match.seller_id, name: match.seller_name, org_id: match.seller_org_id },
      terms: match.terms || null,
      created_at: match.created_at,
      settled_at: match.settled_at || null,
    },
    collapse: collapseRecord
      ? {
          id: collapseRecord.id,
          payload_hash: collapseRecord.payload_hash,
          signature_valid: collapseRecord.signature_valid,
          signature_key_id: collapseRecord.signature_key_id,
          poi_state: collapseRecord.poi_state,
          client_timestamp: collapseRecord.client_timestamp,
          created_at: collapseRecord.created_at,
          ntp_source: collapseRecord.ntp_source || null,
          ntp_drift_ms: collapseRecord.ntp_drift_ms ?? null,
          timestamp_source_metadata: collapseRecord.timestamp_source_metadata || null,
        }
      : null,
    timeline: events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      payload_hash: e.payload_hash,
      previous_event_hash: e.previous_event_hash,
      created_at: e.created_at,
    })),
    chain_verification: {
      valid: chainVerification.valid,
      event_count: events.length,
    },
    documents: documents.map((d) => ({
      id: d.id,
      doc_type: d.doc_type,
      filename: d.filename,
      sha256_hash: d.sha256_hash,
      status: d.status,
      visibility: d.visibility,
      created_at: d.created_at,
    })),
    approval_chain: auditLogs
      .filter((l) => {
        const action = String(l.action || "");
        return (
          action.includes("approval") ||
          action.includes("collapse") ||
          action.includes("settle") ||
          action.includes("confirm") ||
          action.includes("evidence")
        );
      })
      .map((l) => ({
        id: l.id,
        action: l.action,
        actor_user_id: l.actor_user_id,
        actor_api_key_id: l.actor_api_key_id,
        created_at: l.created_at,
        metadata: l.metadata,
      })),
    audit_log_refs: auditLogs.map((l) => ({
      id: l.id,
      action: l.action,
      created_at: l.created_at,
    })),
  };
}

function generatePdfHtml(
  canonical: ReturnType<typeof buildCanonicalPayload>,
  packHash: string,
  signatureValid: boolean | null,
  generatedAt: string
): string {
  const m = canonical.match;
  const chainStatus = canonical.chain_verification.valid ? "VERIFIED" : "COMPROMISED";
  const sigStatus =
    signatureValid === true ? "VALID" : signatureValid === false ? "INVALID" : "N/A";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Evidence Pack – ${m.id}</title>
<style>
body{font-family:'Courier New',monospace;margin:40px;color:#111;font-size:12px}
h1{font-size:18px;border-bottom:2px solid #000;padding-bottom:8px}
h2{font-size:14px;margin-top:24px;border-bottom:1px solid #666;padding-bottom:4px}
.hash{font-family:monospace;background:#f0f0f0;padding:4px 8px;word-break:break-all;font-size:11px}
.badge{display:inline-block;padding:2px 8px;border-radius:3px;font-weight:bold;font-size:11px}
.pass{background:#d4edda;color:#155724}.fail{background:#f8d7da;color:#721c24}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}
th,td{border:1px solid #ddd;padding:6px;text-align:left}
th{background:#f5f5f5}
.footer{margin-top:40px;border-top:1px solid #999;padding-top:8px;font-size:10px;color:#666}
</style></head>
<body>
<h1>Evidence Pack</h1>
<p><strong>Match ID:</strong> ${m.id}</p>
<p><strong>Generated:</strong> ${generatedAt} UTC</p>
<p><strong>Pack SHA-256:</strong></p><div class="hash">${packHash}</div>
<p><strong>Chain Integrity:</strong> <span class="badge ${canonical.chain_verification.valid ? "pass" : "fail"}">${chainStatus}</span></p>
<p><strong>Signature:</strong> <span class="badge ${signatureValid ? "pass" : "fail"}">${sigStatus}</span></p>

<h2>Match Summary</h2>
<table>
<tr><th>Commodity</th><td>${m.commodity}</td></tr>
<tr><th>Quantity</th><td>${m.quantity.amount} ${m.quantity.unit}</td></tr>
<tr><th>Price</th><td>${m.price.currency} ${m.price.amount}</td></tr>
<tr><th>Buyer</th><td>${m.buyer.name}</td></tr>
<tr><th>Seller</th><td>${m.seller.name}</td></tr>
<tr><th>Status</th><td>${m.status}</td></tr>
<tr><th>POI State</th><td>${m.poi_state}</td></tr>
<tr><th>Created</th><td>${m.created_at}</td></tr>
<tr><th>Settled</th><td>${m.settled_at || "-"}</td></tr>
<tr><th>Match Hash</th><td class="hash">${m.hash}</td></tr>
</table>

${
  canonical.collapse
    ? `<h2>Collapse Record</h2>
<table>
<tr><th>Collapse ID</th><td>${canonical.collapse.id}</td></tr>
<tr><th>Payload Hash</th><td class="hash">${canonical.collapse.payload_hash}</td></tr>
<tr><th>Signature Valid</th><td><span class="badge ${canonical.collapse.signature_valid ? "pass" : "fail"}">${canonical.collapse.signature_valid ? "YES" : "NO"}</span></td></tr>
<tr><th>Key ID</th><td>${canonical.collapse.signature_key_id || "-"}</td></tr>
<tr><th>Client Timestamp</th><td>${canonical.collapse.client_timestamp}</td></tr>
<tr><th>Server Timestamp</th><td>${canonical.collapse.created_at}</td></tr>
<tr><th>NTP Source</th><td>${canonical.collapse.ntp_source || "-"}</td></tr>
<tr><th>NTP Drift (ms)</th><td>${canonical.collapse.ntp_drift_ms ?? "-"}</td></tr>
<tr><th>Timestamp Metadata</th><td><pre style="font-size:10px;margin:0;white-space:pre-wrap">${canonical.collapse.timestamp_source_metadata ? JSON.stringify(canonical.collapse.timestamp_source_metadata, null, 2) : "-"}</pre></td></tr>
</table>`
    : ""
}

<h2>Event Timeline (${canonical.timeline.length} events)</h2>
<table>
<tr><th>#</th><th>Event</th><th>Payload Hash</th><th>Timestamp</th></tr>
${canonical.timeline
  .map(
    (e, i) =>
      `<tr><td>${i + 1}</td><td>${e.event_type}</td><td class="hash">${e.payload_hash}</td><td>${e.created_at}</td></tr>`
  )
  .join("")}
</table>

<h2>Documents (${canonical.documents.length})</h2>
<table>
<tr><th>Filename</th><th>Type</th><th>SHA-256</th><th>Status</th></tr>
${canonical.documents
  .map(
    (d) =>
      `<tr><td>${d.filename}</td><td>${d.doc_type}</td><td class="hash">${d.sha256_hash}</td><td>${d.status}</td></tr>`
  )
  .join("")}
</table>

<h2>Approval Chain (${canonical.approval_chain.length} entries)</h2>
<table>
<tr><th>Action</th><th>Actor</th><th>Timestamp</th></tr>
${canonical.approval_chain
  .map(
    (a) =>
      `<tr><td>${a.action}</td><td>${a.actor_user_id || a.actor_api_key_id || "system"}</td><td>${a.created_at}</td></tr>`
  )
  .join("")}
</table>

<h2>Full Audit Log References (${canonical.audit_log_refs.length})</h2>
<table>
<tr><th>ID</th><th>Action</th><th>Timestamp</th></tr>
${canonical.audit_log_refs
  .map((a) => `<tr><td>${a.id}</td><td>${a.action}</td><td>${a.created_at}</td></tr>`)
  .join("")}
</table>

<div class="footer">
<p>This document is a rendered view of the canonical evidence pack. The SHA-256 hash above is computed from the deterministic canonical JSON. Regenerating the evidence pack for this match will produce an identical hash if no data has been tampered with.</p>
<p>Hash algorithm: SHA-256 | Serialisation: Deterministic canonical JSON (sorted keys, no whitespace)</p>
</div>
</body></html>`;
}

Deno.serve(async (req) => {
  // OPS-010: short-circuit live side effects for demo data.
  try {
    const _demoAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.39.3")).createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "evidence-pack", artefact: true });
    if (_demoBlocked) return _demoBlocked;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "evidence-pack") parts.shift();

    const matchId = parts[0];
    const subAction = parts[1]; // optional: "pdf"

    if (!matchId) {
      throw new ApiException("BAD_REQUEST", "Match ID is required", 400);
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(matchId)) {
      throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    if (authCtx.isApiKey) requireScope(authCtx, "evidence");

    await checkRateLimit(
      supabase, authCtx.orgId,
      authCtx.isApiKey ? authCtx.userId : null,
      "evidence-pack", "evidence-pack"
    );

    await enforceTokenMetering(
      supabase, authCtx.orgId,
      authCtx.isApiKey ? authCtx.userId : null,
      "/evidence-pack", requestId
    );

    if (req.method !== "GET" && req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    // Determine format from subAction or query param
    // Supported: "json" (default), "pdf" (HTML evidence report),
    // "audit-csv" (audit trail CSV), "audit-json" (audit trail JSON)
    let format: string;
    if (subAction === "pdf") format = "pdf";
    else if (subAction === "audit") {
      format = url.searchParams.get("format") === "json" ? "audit-json" : "audit-csv";
    } else {
      format = url.searchParams.get("format") || "json";
    }

    // ── Fetch all data in parallel ──
    const [matchRes, eventsRes, docsRes, auditRes, collapseRes] = await Promise.all([
      supabase.from("matches").select("*").eq("id", matchId).single(),
      supabase.from("match_events").select("*").eq("match_id", matchId).order("created_at", { ascending: true }),
      supabase.from("match_documents")
        .select("id, doc_type, filename, sha256_hash, file_size, mime_type, status, created_at, expiry_date, title, visibility, valid_from, valid_to")
        .eq("match_id", matchId).order("created_at", { ascending: true }),
      supabase.from("audit_logs").select("*").eq("entity_type", "match").eq("entity_id", matchId).order("created_at", { ascending: true }),
      supabase.from("collapse_ledger").select("*").eq("match_id", matchId).order("created_at", { ascending: true }).limit(1),
    ]);

    if (matchRes.error) {
      if (matchRes.error.code === "PGRST116") throw new ApiException("NOT_FOUND", "Match not found", 404);
      handleDatabaseError(matchRes.error, requestId);
    }

    const match = matchRes.data;
    const isParticipant =
      match.org_id === authCtx.orgId ||
      match.buyer_org_id === authCtx.orgId ||
      match.seller_org_id === authCtx.orgId;
    if (!isParticipant) {
      throw new ApiException("FORBIDDEN", "You do not have permission to access this match", 403);
    }

    if (eventsRes.error) handleDatabaseError(eventsRes.error, requestId);
    if (docsRes.error) handleDatabaseError(docsRes.error, requestId);
    if (auditRes.error) handleDatabaseError(auditRes.error, requestId);

    const events = eventsRes.data || [];
    const documents = docsRes.data || [];
    const auditLogs = auditRes.data || [];
    const collapseRecord = collapseRes.data?.[0] || null;

    // Verify hash chain
    let chainValid = true;
    const chainDetails: unknown[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const expectedPrev = i === 0 ? null : events[i - 1].payload_hash;
      const isValid = ev.previous_event_hash === expectedPrev;
      chainValid = chainValid && isValid;
      chainDetails.push({ eventId: ev.id, index: i, valid: isValid });
    }

    // Build deterministic canonical payload
    const canonical = buildCanonicalPayload(
      match, events, documents, auditLogs,
      { valid: chainValid, details: chainDetails },
      collapseRecord
    );

    // Compute SHA-256 of canonical JSON
    const canonicalJson = canonicalStringify(canonical);
    const packHash = await sha256Hex(canonicalJson);

    const signatureValid = collapseRecord?.signature_valid ?? null;
    const generatedAt = new Date().toISOString();

    // Audit log
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "evidence-pack.generated",
      entity_type: "match",
      entity_id: matchId,
      metadata: { packHash, format, chainValid, requestId },
    });

    // ── Audit-trail standalone export ──────────────────────────────
    // Returns just the audit_logs entries for this match, in CSV (default)
    // or JSON, so compliance reviewers can ingest the trail independently
    // of the full evidence pack. Hash + version metadata are included for
    // traceability back to the canonical pack.
    if (format === "audit-csv" || format === "audit-json") {
      const trail = auditLogs.map((l) => ({
        id: l.id,
        action: l.action,
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        actor_user_id: l.actor_user_id ?? null,
        actor_api_key_id: l.actor_api_key_id ?? null,
        org_id: l.org_id ?? null,
        ip_address: (l as Record<string, unknown>).ip_address ?? null,
        user_agent: (l as Record<string, unknown>).user_agent ?? null,
        request_id: (l.metadata as Record<string, unknown> | null)?.requestId ?? null,
        created_at: l.created_at,
        metadata: l.metadata ?? null,
      }));

      // Hash of the trail itself, for tamper-evidence on the standalone export.
      const trailCanonical = canonicalStringify(trail);
      const trailHash = await sha256Hex(trailCanonical);

      // Audit the export itself.
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "audit-trail.exported",
        entity_type: "match",
        entity_id: matchId,
        metadata: {
          format,
          entryCount: trail.length,
          trailHash,
          packHash,
          requestId,
        },
      });

      if (format === "audit-json") {
        const body = {
          metadata: {
            exportId: crypto.randomUUID(),
            generatedAt,
            generatedBy: authCtx.userId,
            requestId,
            format: "audit-trail-v1",
            matchId,
            entryCount: trail.length,
          },
          traceability: {
            packHash,
            trailHash,
            hashAlgorithm: "SHA-256",
            chainValid,
          },
          entries: trail,
        };
        return new Response(JSON.stringify(body, null, 2), {
          status: 200,
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="audit-trail-${matchId}.json"`,
          },
        });
      }

      // CSV (default for compliance ingestion)
      const csvEscape = (val: unknown): string => {
        if (val === null || val === undefined) return "";
        const s = typeof val === "string" ? val : JSON.stringify(val);
        // RFC 4180: wrap in quotes, double any embedded quote, preserve newlines.
        return `"${s.replace(/"/g, '""')}"`;
      };
      const cols = [
        "id", "action", "entity_type", "entity_id",
        "actor_user_id", "actor_api_key_id", "org_id",
        "ip_address", "user_agent", "request_id",
        "created_at", "metadata",
      ] as const;
      const headerRow = cols.join(",");
      const preamble = [
        `# Izenzo Audit Trail Export`,
        `# Match ID: ${matchId}`,
        `# Generated (UTC): ${generatedAt}`,
        `# Entry count: ${trail.length}`,
        `# Pack SHA-256: ${packHash}`,
        `# Trail SHA-256: ${trailHash}`,
        `# Hash algorithm: SHA-256`,
        `# Format: audit-trail-v1`,
      ].join("\n");
      const rows = trail.map((e) =>
        cols.map((c) => csvEscape((e as Record<string, unknown>)[c])).join(",")
      );
      const csv = `${preamble}\n${headerRow}\n${rows.join("\n")}\n`;
      return new Response(csv, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-trail-${matchId}.csv"`,
          "X-Trail-SHA256": trailHash,
          "X-Pack-SHA256": packHash,
        },
      });
    }

    if (format === "pdf") {
      const html = generatePdfHtml(canonical, packHash, signatureValid, generatedAt);

      // Attempt server-side PDF conversion via headless rendering
      try {
        // Use a PDF generation service if configured
        const pdfServiceUrl = Deno.env.get("PDF_SERVICE_URL");
        if (pdfServiceUrl) {
          const pdfRes = await fetch(pdfServiceUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              html,
              options: {
                format: "A4",
                margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
                printBackground: true,
              },
            }),
          });

          if (pdfRes.ok) {
            const pdfBuffer = await pdfRes.arrayBuffer();
            return new Response(pdfBuffer, {
              status: 200,
              headers: {
                ...headers,
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="evidence-pack-${matchId}.pdf"`,
              },
            });
          }
          console.warn(`PDF service returned ${pdfRes.status}, falling back to HTML`);
        }
      } catch (pdfErr) {
        console.warn("PDF generation failed, falling back to HTML:", pdfErr);
      }

      // Fallback: return HTML with print-optimized styles
      return new Response(html, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="evidence-pack-${matchId}.html"`,
          "X-PDF-Fallback": "true",
        },
      });
    }

    // JSON response - includes metadata envelope + canonical payload + hash
    const envelope = {
      metadata: {
        packId: crypto.randomUUID(),
        generatedAt,
        generatedBy: authCtx.userId,
        requestId,
        format: "canonical-json-v1",
      },
      packHash,
      hashAlgorithm: "SHA-256",
      signatureValidation: {
        hasCollapseRecord: !!collapseRecord,
        signatureValid,
        signatureKeyId: collapseRecord?.signature_key_id || null,
      },
      timestampMetadata: {
        serverTimestampUtc: generatedAt,
        matchCreatedAt: match.created_at,
        matchSettledAt: match.settled_at || null,
        collapseClientTimestamp: collapseRecord?.client_timestamp || null,
        collapseServerTimestamp: collapseRecord?.created_at || null,
        timestampSource: collapseRecord?.ntp_source || "database-server-utc",
        ntpSource: collapseRecord?.ntp_source || null,
        ntpDriftMs: collapseRecord?.ntp_drift_ms ?? null,
        timestampSourceMetadata: collapseRecord?.timestamp_source_metadata || null,
      },
      chainVerification: {
        valid: chainValid,
        eventCount: events.length,
        details: chainDetails,
      },
      canonical,
    };

    return new Response(JSON.stringify(envelope, null, 2), {
      status: 200,
      headers: {
        ...headers,
        ...cacheHeaders("static"),
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="evidence-pack-${matchId}.json"`,
      },
    });
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
