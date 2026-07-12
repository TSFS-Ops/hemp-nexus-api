/**
 * Institutional Funder Evidence Workspace — Batch 4
 * funder-pack-generate
 *
 * POST body: { release_id: string }
 * Auth: caller must be a platform admin (enforced by the SECURITY DEFINER
 * RPC fw_admin_pack_generation_context_v1 which will raise if not).
 *
 * Flow:
 *   1. Resolve caller identity via user-scoped Supabase client.
 *   2. Fetch release + org context (validates admin, active, consent).
 *   3. Build a V1 PDF using pdf-lib (server-side).
 *   4. Compute SHA-256 of the PDF bytes.
 *   5. Upload the PDF to the private funder-evidence-packs bucket
 *      using the service role.
 *   6. Call fw_admin_seal_pack_v1 to record the sealed pack version
 *      (writes audit + usage events atomically).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { PDFDocument, StandardFonts, rgb, degrees } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "funder-evidence-packs";
const WATERMARK_TEMPLATE =
  "IZENZO · {org_name} · {deal_reference} · {timestamp} · pack {pack_id}";

interface ReleaseRow {
  id: string;
  funder_organisation_id: string;
  deal_reference: string;
  evidence_pack_id: string | null;
  evidence_pack_version: string | null;
  release_status: string;
  released_at: string | null;
  release_reason: string | null;
  expires_at: string | null;
  can_view_evidence_summary: boolean;
  can_view_evidence_room: boolean;
  can_download_compiled_pack: boolean;
  can_view_raw_documents: boolean;
  can_download_raw_documents: boolean;
  can_view_unmasked_sensitive_details: boolean;
  buyer_consent_status: string;
  seller_consent_status: string;
  admin_override_reason: string | null;
}

interface OrgRow {
  id: string;
  name: string;
  jurisdiction: string | null;
  contact_email: string | null;
}

interface Ctx {
  release: ReleaseRow;
  organisation: OrgRow;
  next_version: number;
}

const SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: "Buyer summary",
    body: ["Not connected in this version."],
  },
  {
    title: "Seller summary",
    body: ["Not connected in this version."],
  },
  {
    title: "Verification summary",
    body: ["Not connected in this version."],
  },
  {
    title: "IDV / KYB summary",
    body: ["Not connected in this version."],
  },
  {
    title: "WaD status",
    body: ["Not connected in this version."],
  },
  {
    title: "Bank-confidence section",
    body: ["Not connected in this version."],
  },
  {
    title: "Evidence register",
    body: [
      "Raw documents are excluded from this V1 pack by default.",
      "Evidence items linkage will be wired in a later build batch.",
    ],
  },
  {
    title: "Missing evidence",
    body: ["Not connected in this version."],
  },
  {
    title: "Risk / exception summary",
    body: ["Not connected in this version."],
  },
  {
    title: "Finality snapshot",
    body: ["Not connected in this version."],
  },
];

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function renderWatermark(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  const paragraphs = text.split(/\n/);
  for (const p of paragraphs) {
    const words = p.split(/\s+/);
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > maxChars) {
        if (line) out.push(line);
        line = w;
      } else {
        line = line ? line + " " + w : w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

async function buildPdf(
  ctx: Ctx,
  packId: string,
  generatedByEmail: string,
  generatedAt: Date,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const wmVars = {
    org_name: ctx.organisation.name,
    deal_reference: ctx.release.deal_reference,
    timestamp: generatedAt.toISOString(),
    pack_id: packId,
  };
  const wmText = renderWatermark(WATERMARK_TEMPLATE, wmVars);

  const pageWidth = 595; // A4 portrait pt
  const pageHeight = 842;
  const margin = 48;
  const bottomFooter = 24;

  const drawWatermark = (page: ReturnType<typeof pdf.addPage>) => {
    // diagonal grey watermark
    page.drawText("IZENZO · CONFIDENTIAL", {
      x: 90,
      y: pageHeight / 2,
      size: 40,
      font: helvBold,
      color: rgb(0.85, 0.85, 0.9),
      rotate: degrees(30),
      opacity: 0.35,
    });
    // footer
    page.drawText(wmText, {
      x: margin,
      y: bottomFooter,
      size: 7,
      font: helv,
      color: rgb(0.35, 0.35, 0.4),
    });
  };

  // — Cover page —
  const cover = pdf.addPage([pageWidth, pageHeight]);
  drawWatermark(cover);
  cover.drawText("IZENZO", {
    x: margin, y: pageHeight - margin, size: 22, font: helvBold, color: rgb(0.02, 0.35, 0.28),
  });
  cover.drawText("Funder evidence pack", {
    x: margin, y: pageHeight - margin - 30, size: 16, font: helvBold, color: rgb(0.06, 0.09, 0.16),
  });

  const coverRows: Array<[string, string]> = [
    ["Pack ID", packId],
    ["Version", `v${ctx.next_version}`],
    ["Generated at", generatedAt.toISOString()],
    ["Generated by", generatedByEmail],
    ["Prepared for (funder organisation)", ctx.organisation.name],
    ["Deal reference", ctx.release.deal_reference],
    ["Release ID", ctx.release.id],
    ["Evidence pack ID", ctx.release.evidence_pack_id ?? "—"],
    ["Evidence pack version", ctx.release.evidence_pack_version ?? "—"],
    ["Release expiry", ctx.release.expires_at ?? "—"],
  ];
  let y = pageHeight - margin - 80;
  for (const [k, v] of coverRows) {
    cover.drawText(k, { x: margin, y, size: 10, font: helvBold, color: rgb(0.25, 0.28, 0.36) });
    cover.drawText(String(v), { x: margin + 200, y, size: 10, font: helv, color: rgb(0.06, 0.09, 0.16) });
    y -= 16;
  }

  y -= 12;
  cover.drawText("Permission summary", { x: margin, y, size: 12, font: helvBold });
  y -= 18;
  const perms: Array<[string, boolean]> = [
    ["View evidence summary", ctx.release.can_view_evidence_summary],
    ["View evidence room", ctx.release.can_view_evidence_room],
    ["Download compiled pack", ctx.release.can_download_compiled_pack],
    ["View raw documents", ctx.release.can_view_raw_documents],
    ["Download raw documents", ctx.release.can_download_raw_documents],
    ["View unmasked sensitive details", ctx.release.can_view_unmasked_sensitive_details],
  ];
  for (const [k, v] of perms) {
    cover.drawText(k, { x: margin, y, size: 10, font: helv });
    cover.drawText(v ? "YES" : "no", {
      x: margin + 240, y, size: 10, font: helvBold,
      color: v ? rgb(0.02, 0.35, 0.28) : rgb(0.4, 0.4, 0.45),
    });
    y -= 14;
  }

  // — Content pages —
  const contentPages = SECTIONS.map((s) => s);
  // Audit summary is dynamic:
  contentPages.push({
    title: "Audit summary",
    body: [
      `Release ID: ${ctx.release.id}`,
      `Deal reference: ${ctx.release.deal_reference}`,
      `Release status: ${ctx.release.release_status}`,
      `Released at: ${ctx.release.released_at ?? "—"}`,
      `Release reason: ${ctx.release.release_reason ?? "—"}`,
      `Buyer consent: ${ctx.release.buyer_consent_status}`,
      `Seller consent: ${ctx.release.seller_consent_status}`,
      ctx.release.admin_override_reason
        ? "An admin override was used to authorise this release. The override reason is retained in the audit trail."
        : "No admin override was recorded.",
      `Pack generated by: ${generatedByEmail} at ${generatedAt.toISOString()}`,
    ],
  });
  contentPages.push({
    title: "Disclaimer",
    body: [
      "This funder evidence pack reflects the system records held by Izenzo at the time of generation. Information may change subsequent to sealing; if evidence changes, a new pack version will be generated.",
      "This pack is released only to the named funder organisation for the stated deal reference. Onward disclosure requires explicit permission from Izenzo and the underlying counterparties.",
      "Raw underlying documents are not included in this pack unless expressly enabled on the release. Provider raw responses and internal admin notes are excluded.",
    ],
  });
  contentPages.push({
    title: "Hash / seal details",
    body: [
      `Pack ID: ${packId}`,
      `Version: v${ctx.next_version}`,
      `Sealed at: ${generatedAt.toISOString()}`,
      // file_sha256 is computed after the PDF is finalised; recorded in
      // funder_pack_versions and reproducible from the uploaded bytes.
      "SHA-256 of the PDF bytes is recorded in the pack version record and can be independently reproduced from the sealed file.",
      `Storage bucket: ${BUCKET}`,
    ],
  });

  for (const s of contentPages) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    drawWatermark(page);
    page.drawText(s.title, {
      x: margin, y: pageHeight - margin, size: 16, font: helvBold, color: rgb(0.06, 0.09, 0.16),
    });
    page.drawLine({
      start: { x: margin, y: pageHeight - margin - 6 },
      end: { x: pageWidth - margin, y: pageHeight - margin - 6 },
      thickness: 0.5,
      color: rgb(0.8, 0.82, 0.88),
    });
    let py = pageHeight - margin - 30;
    for (const paragraph of s.body) {
      const lines = wrap(paragraph, 92);
      for (const line of lines) {
        if (py < bottomFooter + 24) break;
        page.drawText(line, { x: margin, y: py, size: 10, font: helv, color: rgb(0.1, 0.12, 0.18) });
        py -= 14;
      }
      py -= 4;
    }
  }

  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const releaseId = String(body?.release_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(releaseId)) {
      return json({ error: "invalid_release_id" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User-scoped client: RLS + SECURITY DEFINER admin check runs as caller.
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: userInfo, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userInfo?.user) return json({ error: "unauthorized" }, 401);
    const generatedByEmail = userInfo.user.email ?? userInfo.user.id;

    // Context call — enforces platform_admin, active release, consent.
    const { data: ctxData, error: ctxErr } = await userClient.rpc(
      "fw_admin_pack_generation_context_v1",
      { p_release_id: releaseId },
    );
    if (ctxErr) return json({ error: "context_denied", detail: ctxErr.message }, 403);
    const ctx = ctxData as Ctx;

    // Pre-mint a pack id so it appears in the cover + storage path.
    const packId = crypto.randomUUID();
    const generatedAt = new Date();

    const pdfBytes = await buildPdf(ctx, packId, generatedByEmail, generatedAt);
    const fileSha256 = await sha256Hex(pdfBytes);

    const storagePath = `${ctx.organisation.id}/${ctx.release.id}/${packId}-v${ctx.next_version}.pdf`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (upErr) return json({ error: "upload_failed", detail: upErr.message }, 500);

    const wmVars = {
      org_name: ctx.organisation.name,
      deal_reference: ctx.release.deal_reference,
      timestamp: generatedAt.toISOString(),
      pack_id: packId,
    };

    const { data: sealed, error: sealErr } = await userClient.rpc(
      "fw_admin_seal_pack_v1",
      {
        p_release_id: releaseId,
        p_storage_bucket: BUCKET,
        p_storage_path: storagePath,
        p_file_sha256: fileSha256,
        p_manifest_sha256: null,
        p_watermark_template: renderWatermark(WATERMARK_TEMPLATE, wmVars),
      },
    );
    if (sealErr) {
      // Best-effort cleanup on seal failure so we don't leave orphan PDFs.
      await admin.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
      return json({ error: "seal_failed", detail: sealErr.message }, 500);
    }

    return json({
      ok: true,
      pack_version_id: sealed,
      pack_id: packId,
      version: ctx.next_version,
      file_sha256: fileSha256,
      storage_bucket: BUCKET,
      storage_path: storagePath,
    }, 200);
  } catch (e) {
    return json({ error: "unhandled", detail: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
