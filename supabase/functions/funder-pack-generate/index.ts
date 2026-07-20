/**
 * Institutional Funder Evidence Workspace — Batch 4 (pipeline) + Batch 7 (content)
 * funder-pack-generate
 *
 * POST body: { release_id: string }
 * Auth: caller must be a platform admin (enforced by the SECURITY DEFINER
 * RPC fw_admin_pack_generation_context_v1 which will raise if not).
 *
 * Flow:
 *   1. Resolve caller identity via user-scoped Supabase client.
 *   2. Fetch release + org context (validates admin, active, consent).
 *   3. Fetch the canonical, funder-safe pack-content projection
 *      (fw_admin_funder_pack_content_v1 — Batch 7). Best-effort: if this
 *      call fails for any reason, generation still proceeds and every
 *      content section falls back to an explicit "unavailable" status —
 *      this function never fabricates data and never blocks generation
 *      on a projection failure (existing releases must keep working).
 *   4. Build a V1 PDF using pdf-lib (server-side), with each of the nine
 *      previously-placeholder sections populated from real, safe data
 *      when available.
 *   5. Compute SHA-256 of the PDF bytes.
 *   6. Upload the PDF to the private funder-evidence-packs bucket
 *      using the service role.
 *   7. Call fw_admin_seal_pack_v1 to record the sealed pack version
 *      (writes audit + usage events atomically).
 *
 * Batch 7 source-mapping matrix, confidence decisions and unresolved
 * sections (bank-confidence, finality snapshot): see
 * docs/funder-workspace-batch7-pack-content-report.md
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

// ── Batch 7 pack-content projection shape (from fw_admin_funder_pack_content_v1) ──
interface PartySummary {
    available: boolean;
    role?: string;
    legal_name?: string | null;
    registration_number?: string | null;
    jurisdictions?: string[];
    status?: string;
    reason?: string;
}
interface VerificationItem {
    party: string;
    category: string;
    state: string;
    decided_at?: string | null;
    expires_at?: string | null;
}
interface WadStatus {
    available: boolean;
    exists?: boolean;
    status?: string;
    sealed?: boolean;
    reference?: string;
    sealed_at?: string | null;
    has_seal_hash?: boolean;
    recorded_at?: string;
    reason?: string;
}
interface AvailabilityStatus {
    available: boolean;
    status?: string;
    reason?: string;
}
interface EvidenceItem {
    category: string | null;
    label: string | null;
    status: string | null;
    has_hash: boolean;
    recorded_at: string | null;
}
interface RiskExceptionItem {
    exception_type: string;
    severity: string;
    status: string;
    external_safe_summary: string;
    created_at: string;
    resolved_at: string | null;
}
interface PackContent {
    deal_reference_resolved: boolean;
    buyer_summary: PartySummary;
    seller_summary: PartySummary;
    verification_summary: VerificationItem[];
    idv_kyb_summary: VerificationItem[];
    wad_status: WadStatus;
    bank_confidence: AvailabilityStatus;
    evidence_register: EvidenceItem[];
    missing_evidence: AvailabilityStatus;
    risk_exception_summary: RiskExceptionItem[];
    risk_exception_scope: string;
    finality_snapshot: AvailabilityStatus;
}

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

// ── Batch 7 — section builders. Each falls back to an honest, explicit
// unavailable/unresolved status. None ever fabricates or infers a
// positive result from absence of data. ──

function buildPartySummaryLines(summary: PartySummary | undefined): string[] {
    if (!summary || summary.available !== true) {
          return [summary?.reason ?? "No linked record was available at the time of generation."];
    }
    const jurisdictions =
          Array.isArray(summary.jurisdictions) && summary.jurisdictions.length > 0
        ? summary.jurisdictions.join(", ")
            : "—";
    return [
          `Legal name: ${summary.legal_name ?? "—"}`,
          `Registration number: ${summary.registration_number ?? "—"}`,
          `Jurisdiction(s): ${jurisdictions}`,
        ];
}

function buildVerificationLines(items: VerificationItem[] | undefined): string[] {
    if (!items || items.length === 0) {
          return ["No linked record was available at the time of generation."];
    }
    return items.map((i) =>
          `${i.party === "buyer" ? "Buyer" : "Seller"} — ${i.category}: ${i.state}${
                  i.decided_at ? ` (decided ${i.decided_at})` : ""
          }`
                       );
}

function buildIdvKybLines(items: VerificationItem[] | undefined): string[] {
    if (!items || items.length === 0) {
          return ["No linked record was available at the time of generation."];
    }
    return items.map((i) =>
          `${i.party === "buyer" ? "Buyer" : "Seller"} identity verification: ${i.state}${
                  i.decided_at ? ` (decided ${i.decided_at})` : ""
          }`
                       );
}

function buildWadStatusLines(w: WadStatus | undefined): string[] {
    if (!w || w.available !== true) {
          return [w?.reason ?? "No linked record was available at the time of generation."];
    }
    if (!w.exists) {
          return ["No Without-a-Doubt (WaD) record has been created for this deal."];
    }
    return [
          `WaD status: ${w.status}`,
          `Sealed: ${w.sealed ? "Yes" : "No"}${w.sealed_at ? ` (at ${w.sealed_at})` : ""}`,
          `Seal hash present: ${w.has_seal_hash ? "Yes" : "No"}`,
          `WaD reference: ${w.reference ?? "—"}`,
        ];
}

function buildBankConfidenceLines(b: AvailabilityStatus | undefined): string[] {
    return [b?.reason ?? "Not applicable."];
}

function buildEvidenceRegisterLines(items: EvidenceItem[] | undefined): string[] {
    const base = ["Raw documents are excluded from this V1 pack by default."];
    if (!items || items.length === 0) {
          return [
                  ...base,
                  "No evidence items are linked to this deal, or the deal reference could not be resolved to a canonical record.",
                ];
    }
    const rows = items.map((d) =>
          `${d.category ?? "Document"} — ${d.label ?? "—"} — ${d.status ?? "—"}${
                  d.has_hash ? " — hash on file" : ""
          } (${d.recorded_at ?? "—"})`
                             );
    return [...base, ...rows];
}

function buildMissingEvidenceLines(m: AvailabilityStatus | undefined): string[] {
    return [m?.reason ?? "Not connected in this version."];
}

function buildRiskExceptionLines(
    items: RiskExceptionItem[] | undefined,
    scope: string | undefined,
  ): string[] {
    const scopeLine =
          scope === "organisation"
        ? "Scope: organisation-level exceptions for the buyer/seller organisations (not filtered to this specific deal)."
            : "Scope: unresolved.";
    if (!items || items.length === 0) {
          return [scopeLine, "No exceptions recorded."];
    }
    const rows = items.map((e) =>
          `${e.exception_type} — severity ${e.severity} — ${e.status}: ${e.external_safe_summary}`
                             );
    return [scopeLine, ...rows];
}

function buildFinalityLines(f: AvailabilityStatus | undefined): string[] {
    return [f?.reason ?? "Not connected in this version."];
}

function buildSections(content: PackContent | null): Array<{ title: string; body: string[] }> {
    const c = content ?? ({} as Partial<PackContent>);
    return [
      { title: "Buyer summary", body: buildPartySummaryLines(c.buyer_summary) },
      { title: "Seller summary", body: buildPartySummaryLines(c.seller_summary) },
      { title: "Verification summary", body: buildVerificationLines(c.verification_summary) },
      { title: "IDV / KYB summary", body: buildIdvKybLines(c.idv_kyb_summary) },
      { title: "WaD status", body: buildWadStatusLines(c.wad_status) },
      { title: "Bank-confidence section", body: buildBankConfidenceLines(c.bank_confidence) },
      { title: "Evidence register", body: buildEvidenceRegisterLines(c.evidence_register) },
      { title: "Missing evidence", body: buildMissingEvidenceLines(c.missing_evidence) },
      {
              title: "Risk / exception summary",
              body: buildRiskExceptionLines(c.risk_exception_summary, c.risk_exception_scope),
      },
      { title: "Finality snapshot", body: buildFinalityLines(c.finality_snapshot) },
        ];
}

async function buildPdf(
    ctx: Ctx,
    packId: string,
    generatedByEmail: string,
    generatedAt: Date,
    content: PackContent | null,
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
  const contentPages = buildSections(content);
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
                  "This document does not constitute a funding approval. Any section marked as unavailable, pending, or not applicable reflects the absence of a connected record at generation time, not a negative finding.",
                  "The cryptographic hash below verifies the integrity of this generated file only — it does not attest to the truth of every underlying declaration it describes.",
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

      // Pass the JWT explicitly — without an active session the SDK does not
      // attach the global Authorization header to /auth/v1/user, which surfaces
      // as a spurious `unauthorized` from an otherwise-valid caller.
      const bearer = authHeader.replace(/^Bearer\s+/i, "");
      const { data: userInfo, error: userErr } = await userClient.auth.getUser(bearer);
                   if (userErr || !userInfo?.user) return json({ error: "unauthorized" }, 401);
                   const generatedByEmail = userInfo.user.email ?? userInfo.user.id;

      // Context call — enforces platform_admin, active release, consent.
      const { data: ctxData, error: ctxErr } = await userClient.rpc(
              "fw_admin_pack_generation_context_v1",
        { p_release_id: releaseId },
            );
                   if (ctxErr) return json({ error: "context_denied", detail: ctxErr.message }, 403);
                   const ctx = ctxData as Ctx;

      // Batch 7 — canonical pack-content projection. Best-effort: a failure
      // here must never block generation (existing releases must keep
      // working); every section already has an honest fallback status.
      let content: PackContent | null = null;
                   try {
                           const { data: contentData, error: contentErr } = await userClient.rpc(
                                     "fw_admin_funder_pack_content_v1",
                             { p_release_id: releaseId },
                                   );
                           if (!contentErr) content = contentData as PackContent;
                   } catch (_e) {
                           content = null;
                   }

      // Batch 8 — canonical linkage gate. If the projection reports the
      // release has no canonical or resolvable legacy link, block generation
      // so we never silently seal a mostly-empty misleading pack.
      const linkageMode = (content as unknown as { linkage_mode?: string } | null)?.linkage_mode;
      if (linkageMode === "unresolved" || linkageMode === "invalid") {
              return json({
                      error: "linkage_required",
                      detail:
                              "This release has no canonical deal linked. Link a canonical deal before generating a sealed pack.",
                      linkage_mode: linkageMode,
              }, 409);
      }

      // Pre-mint a pack id so it appears in the cover + storage path.
      const packId = crypto.randomUUID();
                   const generatedAt = new Date();


      const pdfBytes = await buildPdf(ctx, packId, generatedByEmail, generatedAt, content);
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
              // Batch 7 — surfaces whether the deal reference resolved to a
              // canonical record, so the admin UI can warn on unresolved packs
              // without hard-blocking generation (see Batch 7 report).
              deal_reference_resolved: content?.deal_reference_resolved ?? false,
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
