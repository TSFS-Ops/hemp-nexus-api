// waiver-packet — Generates (or fetches) a downloadable POI evidence waiver
// packet PDF and returns a short-lived signed URL.
//
// Access policy:
//   - Match participants (members of buyer_org_id or seller_org_id, or the
//     match.org_id) can download.
//   - Platform admins / auditors / org_admins can download.
// Storage: bucket "evidence-waiver-packets", path `${match_id}/${waiver_id}.pdf`.
// The PDF is generated on first request, then re-served via signed URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const BUCKET = "evidence-waiver-packets";
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

interface WaiverEntry {
  id: string;
  created_at: string;
  org_id: string;
  entity_id: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
}

function safe(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function buildPdf(opts: {
  waiver: WaiverEntry;
  match: Record<string, unknown>;
  auditTimeline: Array<Record<string, unknown>>;
  generatedAt: string;
}): Uint8Array {
  const { waiver, match, auditTimeline, generatedAt } = opts;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  let y = margin;

  const ensureSpace = (lines: number, lineHeight = 14) => {
    if (y + lines * lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeLine = (text: string, opts?: { bold?: boolean; size?: number }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10);
    const wrapped = doc.splitTextToSize(text, pageWidth - margin * 2);
    ensureSpace(wrapped.length);
    doc.text(wrapped, margin, y);
    y += wrapped.length * (opts?.size ? opts.size + 4 : 14);
  };

  const writeKV = (key: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    const keyWidth = 140;
    const wrapped = doc.splitTextToSize(value || "—", pageWidth - margin * 2 - keyWidth);
    ensureSpace(wrapped.length);
    doc.text(`${key}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(wrapped, margin + keyWidth, y);
    y += wrapped.length * 13;
  };

  const sectionRule = () => {
    ensureSpace(2);
    doc.setDrawColor(180);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
  };

  // ── Header ──
  writeLine("POI Evidence Waiver Packet", { bold: true, size: 16 });
  writeLine("Compliance evidence record · Izenzo Trade Platform", { size: 9 });
  y += 4;
  writeKV("Generated at", generatedAt);
  writeKV("Document", `evidence-waiver-packet/${waiver.id}`);
  sectionRule();

  // ── Waiver acknowledgement ──
  writeLine("1. Waiver Acknowledgement", { bold: true, size: 12 });
  y += 2;
  const md = waiver.metadata || {};
  writeKV("Waiver ID", waiver.id);
  writeKV("Match ID", waiver.entity_id ?? "—");
  writeKV("Organisation ID", waiver.org_id);
  writeKV("Acknowledged by (user)", waiver.actor_user_id ?? "—");
  writeKV("Acknowledged at", waiver.created_at);
  writeKV("Documents attached", safe((md as Record<string, unknown>)["document_count"] ?? 0));
  writeKV("Notes attached", safe((md as Record<string, unknown>)["notes_count"] ?? 0));
  writeKV(
    "Match state at waiver",
    safe((md as Record<string, unknown>)["match_state"] ?? "—"),
  );
  y += 6;
  writeLine("Waiver reason (verbatim):", { bold: true });
  writeLine(safe((md as Record<string, unknown>)["waiver_reason"]) || "—");
  sectionRule();

  // ── Match snapshot ──
  writeLine("2. Match Snapshot", { bold: true, size: 12 });
  y += 2;
  writeKV("Match ID", safe(match.id));
  writeKV("Match type", safe(match.match_type));
  writeKV("State", safe(match.state));
  writeKV("POI state", safe(match.poi_state));
  writeKV("Created at", safe(match.created_at));
  writeKV("Commodity", safe(match.commodity));
  writeKV(
    "Quantity",
    `${safe(match.quantity_amount)} ${safe(match.quantity_unit)}`.trim(),
  );
  writeKV(
    "Price",
    `${safe(match.price_amount)} ${safe(match.price_currency)}`.trim(),
  );
  writeKV("Declared value (USD)", safe(match.declared_value_usd));
  writeKV("Origin country", safe(match.origin_country));
  writeKV("Destination country", safe(match.destination_country));
  writeKV("Buyer org", safe(match.buyer_org_id));
  writeKV("Buyer name", safe(match.buyer_name));
  writeKV("Seller org", safe(match.seller_org_id));
  writeKV("Seller name", safe(match.seller_name));
  writeKV("Owning org", safe(match.org_id));
  writeKV("Created by", safe(match.created_by));
  writeKV("Trade request ID", safe(match.trade_request_id));
  writeKV("Event chain hash", safe(match.event_chain_hash));
  sectionRule();

  // ── Audit timeline ──
  writeLine("3. Match Audit Timeline", { bold: true, size: 12 });
  writeLine(
    `${auditTimeline.length} audit log entr${auditTimeline.length === 1 ? "y" : "ies"} for this match, in chronological order.`,
    { size: 9 },
  );
  y += 4;

  if (auditTimeline.length === 0) {
    writeLine("No additional audit entries recorded for this match.", { size: 9 });
  } else {
    auditTimeline.forEach((entry, idx) => {
      ensureSpace(6);
      writeLine(
        `${idx + 1}. ${safe(entry.action)} — ${safe(entry.created_at)}`,
        { bold: true, size: 10 },
      );
      writeKV("Actor user", safe(entry.actor_user_id));
      writeKV("Actor API key", safe(entry.actor_api_key_id));
      writeKV("Entity type", safe(entry.entity_type));
      const meta = entry.metadata;
      if (meta && typeof meta === "object" && Object.keys(meta as object).length > 0) {
        writeLine("Metadata:", { bold: true, size: 9 });
        const json = JSON.stringify(meta, null, 2);
        const lines = doc.splitTextToSize(json, pageWidth - margin * 2 - 12);
        ensureSpace(lines.length, 11);
        doc.setFont("courier", "normal");
        doc.setFontSize(8);
        doc.text(lines, margin + 12, y);
        y += lines.length * 11;
      }
      y += 4;
    });
  }

  // ── Footer ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Izenzo · POI Evidence Waiver Packet · Page ${i} of ${pageCount}`,
      margin,
      pageHeight - 24,
    );
  }

  return doc.output("arraybuffer") as unknown as Uint8Array;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResp = handleCors(req, allowedOrigins);
    if (corsResp) return corsResp;

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Authenticate caller via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const waiverId = typeof body.waiver_id === "string" ? body.waiver_id : null;
    if (!waiverId) {
      return new Response(JSON.stringify({ error: "waiver_id required" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Load waiver entry
    const { data: waiver, error: waiverErr } = await admin
      .from("audit_logs")
      .select("id, created_at, org_id, entity_id, actor_user_id, metadata, action")
      .eq("id", waiverId)
      .eq("action", "poi.evidence_waiver_acknowledged")
      .maybeSingle();

    if (waiverErr) throw waiverErr;
    if (!waiver) {
      return new Response(JSON.stringify({ error: "Waiver not found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const matchId = waiver.entity_id;
    if (!matchId) {
      return new Response(JSON.stringify({ error: "Waiver has no match reference" }), {
        status: 422,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Load match
    const { data: match, error: matchErr } = await admin
      .from("matches")
      .select("*")
      .eq("id", matchId)
      .maybeSingle();
    if (matchErr) throw matchErr;
    if (!match) {
      return new Response(JSON.stringify({ error: "Match not found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Authorisation: caller must be a participant of the match OR hold an
    // admin/auditor role.
    const ADMIN_ROLES = ["platform_admin", "auditor", "org_admin"];
    const { data: rolesRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleNames = (rolesRows || []).map((r: { role: string }) => r.role);
    const isAdmin = roleNames.some((r) => ADMIN_ROLES.includes(r));

    let isParticipant = false;
    if (!isAdmin) {
      const orgIds = [match.org_id, match.buyer_org_id, match.seller_org_id].filter(
        (v): v is string => !!v,
      );
      if (orgIds.length > 0) {
        const { data: memberships } = await admin
          .from("org_members")
          .select("org_id")
          .eq("user_id", userId)
          .in("org_id", orgIds);
        isParticipant = (memberships?.length ?? 0) > 0;
      }
    }

    if (!isAdmin && !isParticipant) {
      return new Response(
        JSON.stringify({ error: "Forbidden: not a match participant" }),
        {
          status: 403,
          headers: { ...headers, "Content-Type": "application/json" },
        },
      );
    }

    const objectPath = `${matchId}/${waiver.id}.pdf`;

    // If already generated, just sign and return
    const { data: existing } = await admin.storage.from(BUCKET).list(matchId, {
      search: `${waiver.id}.pdf`,
      limit: 1,
    });

    if (!existing || existing.length === 0) {
      // Build the packet
      const { data: timeline } = await admin
        .from("audit_logs")
        .select("id, created_at, action, actor_user_id, actor_api_key_id, entity_type, metadata")
        .eq("entity_id", matchId)
        .order("created_at", { ascending: true })
        .limit(500);

      const pdfBytes = buildPdf({
        waiver: waiver as WaiverEntry,
        match: match as Record<string, unknown>,
        auditTimeline: (timeline as Array<Record<string, unknown>>) || [],
        generatedAt: new Date().toISOString(),
      });

      const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(objectPath, new Blob([pdfBytes], { type: "application/pdf" }), {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw upErr;
    }

    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (signErr) throw signErr;

    // Audit the access
    await admin.from("audit_logs").insert({
      org_id: match.org_id,
      actor_user_id: userId,
      action: "poi.evidence_waiver_packet_downloaded",
      entity_type: "match",
      entity_id: matchId,
      metadata: {
        waiver_id: waiver.id,
        is_admin_access: isAdmin,
        request_id: requestId,
      },
    });

    return new Response(
      JSON.stringify({
        url: signed.signedUrl,
        expires_in: SIGNED_URL_TTL_SECONDS,
        path: objectPath,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[${requestId}] waiver-packet error:`, err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
    );
  }
});
