import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateMagicBytes } from "../_shared/magic-bytes.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { resolveNotificationsFor } from "../_shared/resolve-notifications.ts";

// Stage 2A CORS hardening (2026-05-01): replaced local wildcard `corsHeaders`
// with the shared `_shared/cors.ts` helper. Stub keeps existing spreads valid.
const corsHeaders = { "Content-Type": "application/json" } as Record<string, string>;

// ── Sanctions screening placeholder ──
// Real sanctions screening requires IDV/SAN provider integration (excluded scope: IDV-001, SAN-001/002).
// When DILISENSE_API_KEY is configured, the dilisense-screen function handles live screening.
// This empty list ensures no false positives from mock data.
const SANCTIONS_HITS: { name: string; type: string; list: string }[] = [];

// ── Default risk weights ──
const DEFAULT_WEIGHTS = {
  kyc_completeness: 0.25,
  sanctions_screening: 0.30,
  pep_exposure: 0.15,
  jurisdiction_risk: 0.15,
  business_age: 0.15,
};

const HIGH_RISK_JURISDICTIONS = ["KP", "IR", "SY", "CU", "MM"];
const MEDIUM_RISK_JURISDICTIONS = ["RU", "BY", "VE", "NI", "ZW"];

function getRiskBand(score: number): string {
  if (score <= 30) return "low";
  if (score <= 60) return "medium";
  if (score <= 80) return "high";
  return "critical";
}

function fuzzyMatch(a: string, b: string): boolean {
  return a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
}

// ── One-way hash for sensitive ID numbers (POPIA/GDPR PII) ──
// Replaces reversible base64 encoding. Uses SHA-256 with an optional
// server-side pepper so hashes cannot be brute-forced from a leaked DB.
async function hashIdNumber(idNumber: string | null | undefined): Promise<string | null> {
  if (!idNumber) return null;
  const pepper = Deno.env.get("ID_NUMBER_PEPPER") ?? "";
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(idNumber + pepper),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  return withCors(req, await _serve(req));
});

async function _serve(req: Request): Promise<Response> {

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorised" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorised" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    // ── Server-side governance role enforcement ──
    // Due diligence reveals KYB/KYC, sanctions, PEP, and risk-band data — the
    // most sensitive governance-domain payload in the system. Only governance
    // principals may invoke this endpoint. Mirrors the SPA guard exactly so
    // direct API calls cannot bypass the UI gate.
    const GOVERNANCE_ROLES_DD = ["platform_admin", "auditor", "org_admin"];
    const { data: ddRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const ddRoleNames = (ddRoles ?? []).map((r: { role: string }) => r.role);
    if (!ddRoleNames.some((r) => GOVERNANCE_ROLES_DD.includes(r))) {
      return json({ error: "Governance role required (platform_admin, auditor, or org_admin)" }, 403);
    }

    // Get user profile for org_id
    const { data: profile } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const body = req.method === "POST" ? await req.json() : {};
    const url = new URL(req.url);
    const action = body.action || url.searchParams.get("action");

    // ════════════════════════════════════════════
    // ACTION: register_directors
    // ════════════════════════════════════════════
    if (action === "register_directors") {
      const { org_id, directors } = body;
      const targetOrg = org_id || profile.org_id;

      if (!directors || !Array.isArray(directors) || directors.length === 0) {
        return json({ error: "directors array is required" }, 400);
      }

      const rows = await Promise.all(directors.map(async (d: any) => ({
        org_id: targetOrg,
        full_name: d.full_name,
        role: d.role || "director",
        nationality: d.nationality || null,
        id_number_hash: await hashIdNumber(d.id_number), // SHA-256 + pepper (one-way)
        ownership_percentage: d.ownership_percentage || null,
        is_pep: d.is_pep || false,
      })));

      const { data, error } = await admin.from("org_directors").insert(rows).select();
      if (error) return json({ error: error.message }, 500);

      // Audit
      await admin.from("audit_logs").insert({
        org_id: targetOrg,
        actor_user_id: user.id,
        action: "dd.directors_registered",
        entity_type: "org_directors",
        entity_id: targetOrg,
        metadata: { count: directors.length },
      });

      return json({ success: true, directors: data });
    }

    // ════════════════════════════════════════════
    // ACTION: upload_kyc
    // ════════════════════════════════════════════
    if (action === "upload_kyc") {
      const { org_id, doc_type, filename, storage_path, sha256_hash, issuing_country, expiry_date, mime_type, file_size, id_number } = body;
      const targetOrg = org_id || profile.org_id;

      if (!doc_type || !filename || !storage_path || !sha256_hash) {
        return json({ error: "doc_type, filename, storage_path, sha256_hash are required" }, 400);
      }

      // ── Server-side magic-byte validation (mandatory - never skip) ──
      if (storage_path) {
        const bucket = storage_path.startsWith("kyc-documents") ? "kyc-documents" : storage_path.split("/")[0] || "kyc-documents";
        const filePath = storage_path.startsWith(bucket + "/") ? storage_path.slice(bucket.length + 1) : storage_path;
        const { data: fileData, error: dlError } = await admin.storage.from(bucket).download(filePath);
        if (dlError || !fileData) {
          // FAIL-CLOSED: if we cannot read the file, we cannot validate it - reject
          console.error(`[due-diligence] KYC magic-byte validation failed - could not download file: ${dlError?.message}`);
          return json({ error: "File validation failed - could not verify uploaded file integrity" }, 500);
        }
        const headerBytes = new Uint8Array(await fileData.slice(0, 16).arrayBuffer());
        const mbResult = validateMagicBytes(headerBytes, mime_type || "application/octet-stream", file_size || 0);
        if (mbResult.blocked) {
          // Audit the rejection
          await admin.from("audit_logs").insert({
            org_id: targetOrg,
            actor_user_id: user.id,
            action: "dd.kyc_upload_blocked",
            entity_type: "kyc_documents",
            entity_id: null,
            metadata: { filename, doc_type, client_mime: mime_type, detected_mime: mbResult.detectedMime, reason: mbResult.blockReason },
          }).catch(() => {});
          return json({ error: mbResult.blockReason || "File type not allowed" }, 400);
        }
        if (mbResult.detectedMime && !mbResult.clientMimeMatch) {
          console.warn(`[due-diligence] KYC MIME mismatch: client=${mime_type}, detected=${mbResult.detectedMime}`);
          // Audit mismatch (non-blocking)
          await admin.from("audit_logs").insert({
            org_id: targetOrg,
            actor_user_id: user.id,
            action: "dd.kyc_mime_mismatch",
            entity_type: "kyc_documents",
            entity_id: null,
            metadata: { filename, doc_type, client_mime: mime_type, detected_mime: mbResult.detectedMime },
          }).catch(() => {});
        }
      }

      const { data: doc, error } = await admin.from("kyc_documents").insert({
        org_id: targetOrg,
        doc_type,
        filename,
        storage_path,
        sha256_hash,
        issuing_country: issuing_country || null,
        expiry_date: expiry_date || null,
        mime_type: mime_type || null,
        file_size: file_size || null,
        id_number_hash: await hashIdNumber(id_number), // SHA-256 + pepper (one-way)
        uploaded_by: user.id,
        extracted_metadata: { doc_type, issuing_country, expiry_date },
      }).select().single();

      if (error) return json({ error: error.message }, 500);

      // Update KYC status
      const { data: existingStatus } = await admin
        .from("kyc_status")
        .select("*")
        .eq("org_id", targetOrg)
        .maybeSingle();

      const { data: allDocs } = await admin
        .from("kyc_documents")
        .select("doc_type")
        .eq("org_id", targetOrg)
        .eq("status", "uploaded");

      const submittedTypes = [...new Set((allDocs || []).map((d: any) => d.doc_type))];
      const requiredDocs = existingStatus?.required_docs || ["company_registration", "proof_of_address", "director_id", "tax_certificate"];
      const completeness = Math.min(100, (submittedTypes.length / (requiredDocs as string[]).length) * 100);
      const kycComplete = completeness >= 100;

      await admin.from("kyc_status").upsert({
        org_id: targetOrg,
        submitted_docs: submittedTypes,
        completeness_percentage: completeness,
        status: kycComplete ? "complete" : "incomplete",
        required_docs: requiredDocs,
        last_reviewed_at: new Date().toISOString(),
      }, { onConflict: "org_id" });

      await admin.from("audit_logs").insert({
        org_id: targetOrg,
        actor_user_id: user.id,
        action: "dd.kyc_uploaded",
        entity_type: "kyc_documents",
        entity_id: doc.id,
        metadata: { doc_type, filename },
      });

      return json({ success: true, document: doc, kyc_completeness: completeness });
    }

    // ════════════════════════════════════════════
    // ACTION: run_screening
    // ════════════════════════════════════════════
    if (action === "run_screening") {
      const { org_id } = body;
      const targetOrg = org_id || profile.org_id;

      // Get directors for this org
      const { data: directors } = await admin
        .from("org_directors")
        .select("*")
        .eq("org_id", targetOrg);

      const results: any[] = [];

      // Screen each director against sanctions list (empty until live provider configured)
      for (const director of (directors || [])) {
        const matches = SANCTIONS_HITS.filter(s => fuzzyMatch(s.name, director.full_name));
        results.push({
          screening_type: "sanctions",
          org_id: targetOrg,
          status: matches.length > 0 ? "match" : "clear",
          matched_entities: matches.map(m => ({ ...m, matched_against: director.full_name })),
          screened_at: new Date().toISOString(),
          screened_by: user.id,
          next_screening_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
        });

        // PEP check
        results.push({
          screening_type: "pep",
          org_id: targetOrg,
          status: director.is_pep ? "match" : "clear",
          matched_entities: director.is_pep ? [{ name: director.full_name, type: "PEP" }] : [],
          screened_at: new Date().toISOString(),
          screened_by: user.id,
          next_screening_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }

      // If no directors, run org-level screening
      if (!directors || directors.length === 0) {
        const { data: org } = await admin.from("organizations").select("name").eq("id", targetOrg).single();
        const matches = SANCTIONS_HITS.filter(s => fuzzyMatch(s.name, org?.name || ""));
        results.push({
          screening_type: "sanctions",
          org_id: targetOrg,
          status: matches.length > 0 ? "match" : "clear",
          matched_entities: matches,
          screened_at: new Date().toISOString(),
          screened_by: user.id,
          next_screening_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }

      const { data: inserted, error } = await admin.from("screening_results").insert(results).select();
      if (error) return json({ error: error.message }, 500);

      await admin.from("audit_logs").insert({
        org_id: targetOrg,
        actor_user_id: user.id,
        action: "dd.screening_completed",
        entity_type: "screening_results",
        entity_id: targetOrg,
        metadata: { results_count: results.length, has_matches: results.some(r => r.status !== "clear") },
      });

      return json({ success: true, results: inserted });
    }

    // ════════════════════════════════════════════
    // ACTION: compute_score
    // ════════════════════════════════════════════
    if (action === "compute_score") {
      const { org_id, custom_weights } = body;
      const targetOrg = org_id || profile.org_id;
      const weights = { ...DEFAULT_WEIGHTS, ...(custom_weights || {}) };

      // Factor 1: KYC completeness (0 = complete, 100 = no docs)
      const { data: kycStatus } = await admin.from("kyc_status").select("*").eq("org_id", targetOrg).maybeSingle();
      const kycScore = kycStatus ? Math.max(0, 100 - (kycStatus.completeness_percentage || 0)) : 100;

      // Factor 2: Sanctions screening (0 = clear, 100 = matches found)
      const { data: screenings } = await admin
        .from("screening_results")
        .select("*")
        .eq("org_id", targetOrg)
        .eq("screening_type", "sanctions")
        .order("screened_at", { ascending: false })
        .limit(5);
      const hasSanctionsMatch = (screenings || []).some((s: any) => s.status === "match");
      const sanctionsScore = hasSanctionsMatch ? 100 : 0;

      // Factor 3: PEP exposure
      const { data: pepScreenings } = await admin
        .from("screening_results")
        .select("*")
        .eq("org_id", targetOrg)
        .eq("screening_type", "pep")
        .order("screened_at", { ascending: false })
        .limit(5);
      const hasPep = (pepScreenings || []).some((s: any) => s.status === "match");
      const pepScore = hasPep ? 70 : 0;

      // Factor 4: Jurisdiction risk
      const { data: directors } = await admin.from("org_directors").select("nationality").eq("org_id", targetOrg);
      const nationalities = (directors || []).map((d: any) => d.nationality).filter(Boolean);
      const hasHighRisk = nationalities.some((n: string) => HIGH_RISK_JURISDICTIONS.includes(n));
      const hasMediumRisk = nationalities.some((n: string) => MEDIUM_RISK_JURISDICTIONS.includes(n));
      const jurisdictionScore = hasHighRisk ? 90 : hasMediumRisk ? 50 : 10;

      // Factor 5: Business age (based on org creation date)
      const { data: org } = await admin.from("organizations").select("created_at").eq("id", targetOrg).single();
      const ageMonths = org ? (Date.now() - new Date(org.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30) : 0;
      const ageScore = ageMonths < 6 ? 60 : ageMonths < 12 ? 40 : ageMonths < 24 ? 20 : 5;

      const factors = [
        { factor: "kyc_completeness", weight: weights.kyc_completeness, value: kycScore, contribution: kycScore * weights.kyc_completeness, reason: kycScore > 50 ? "Incomplete KYC documentation" : "KYC documentation adequate" },
        { factor: "sanctions_screening", weight: weights.sanctions_screening, value: sanctionsScore, contribution: sanctionsScore * weights.sanctions_screening, reason: hasSanctionsMatch ? "Sanctions match found" : "No sanctions matches" },
        { factor: "pep_exposure", weight: weights.pep_exposure, value: pepScore, contribution: pepScore * weights.pep_exposure, reason: hasPep ? "PEP exposure detected" : "No PEP exposure" },
        { factor: "jurisdiction_risk", weight: weights.jurisdiction_risk, value: jurisdictionScore, contribution: jurisdictionScore * weights.jurisdiction_risk, reason: hasHighRisk ? "High-risk jurisdiction" : hasMediumRisk ? "Medium-risk jurisdiction" : "Low-risk jurisdiction" },
        { factor: "business_age", weight: weights.business_age, value: ageScore, contribution: ageScore * weights.business_age, reason: `Organisation age: ${Math.round(ageMonths)} months` },
      ];

      const totalScore = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0));
      const riskBand = getRiskBand(totalScore);

      const { data: riskScore, error } = await admin.from("dd_risk_scores").insert({
        org_id: targetOrg,
        score: totalScore,
        risk_band: riskBand,
        weights,
        factors,
        computed_by: user.id,
      }).select().single();

      if (error) return json({ error: error.message }, 500);

      await admin.from("audit_logs").insert({
        org_id: targetOrg,
        actor_user_id: user.id,
        action: "dd.risk_score_computed",
        entity_type: "dd_risk_scores",
        entity_id: riskScore.id,
        metadata: { score: totalScore, risk_band: riskBand },
      });

      return json({ success: true, risk_score: riskScore });
    }

    // ════════════════════════════════════════════
    // ACTION: submit_approval
    // ════════════════════════════════════════════
    if (action === "submit_approval") {
      const { target_org_id, risk_score_id } = body;
      if (!target_org_id) return json({ error: "target_org_id is required" }, 400);

      // Get latest risk score
      let scoreId = risk_score_id;
      let riskBand = "low";
      if (!scoreId) {
        const { data: latestScore } = await admin
          .from("dd_risk_scores")
          .select("*")
          .eq("org_id", target_org_id)
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestScore) {
          scoreId = latestScore.id;
          riskBand = latestScore.risk_band;
        }
      } else {
        const { data: score } = await admin.from("dd_risk_scores").select("risk_band").eq("id", scoreId).single();
        riskBand = score?.risk_band || "low";
      }

      // Get thresholds
      const { data: thresholds } = await admin
        .from("approval_thresholds")
        .select("*")
        .eq("org_id", profile.org_id)
        .maybeSingle();
      const highThreshold = thresholds?.high_threshold ?? 70;

      // Determine required roles based on risk band
      let requiredRoles = ["compliance_analyst"];
      if (riskBand === "medium") {
        requiredRoles = ["compliance_analyst", "legal_reviewer"];
      } else if (riskBand === "high" || riskBand === "critical") {
        requiredRoles = ["compliance_analyst", "legal_reviewer", "director"];
      }

      const { data: request, error } = await admin.from("dd_approval_requests").insert({
        target_org_id,
        requesting_org_id: profile.org_id,
        risk_score_id: scoreId,
        required_roles: requiredRoles,
        completed_roles: [],
        status: "pending",
      }).select().single();

      if (error) return json({ error: error.message }, 500);

      await admin.from("audit_logs").insert({
        org_id: profile.org_id,
        actor_user_id: user.id,
        action: "dd.approval_submitted",
        entity_type: "dd_approval_requests",
        entity_id: request.id,
        metadata: { target_org_id, required_roles: requiredRoles, risk_band: riskBand },
      });

      // ── Notify required approvers ──
      const { data: approverUsers } = await admin
        .from("dd_roles")
        .select("user_id, role")
        .eq("org_id", profile.org_id)
        .in("role", requiredRoles);

      if (approverUsers && approverUsers.length > 0) {
        const notifRows = approverUsers.map((u: any) => ({
          user_id: u.user_id,
          org_id: profile.org_id,
          type: "approval_required",
          title: `Approval required: ${u.role}`,
          body: `A ${riskBand}-risk due diligence approval request requires your ${u.role} sign-off.`,
          link: `/due-diligence`,
          read: false,
          // NOT-008: link to the dd_approval_request so a later
          // resolve/reject auto-clears the unread row.
          entity_type: "dd_approval_request",
          entity_id: request.id,
        }));
        await admin.from("notifications").insert(notifRows).catch((err: any) =>
          console.error("[due-diligence] Approval notification insert failed:", err.message)
        );
      }

      // Dispatch external notifications (email/Slack)
      await admin.functions.invoke("notification-dispatch", {
        body: {
          event_type: "dd.approval_submitted",
          subject: `Due diligence approval submitted (${riskBand} risk)`,
          message: `A ${riskBand}-risk approval request has been submitted for organisation ${target_org_id}. Required roles: ${requiredRoles.join(", ")}.`,
          metadata: { org_id: profile.org_id, target_org_id, risk_band: riskBand, required_roles: requiredRoles },
        },
      }).catch((err: any) => console.error("[due-diligence] notification-dispatch failed:", err));

      return json({ success: true, approval_request: request });
    }

    // ════════════════════════════════════════════
    // ACTION: approve_reject
    // ════════════════════════════════════════════
    if (action === "approve_reject") {
      const { approval_request_id, decision, reason } = body;
      if (!approval_request_id || !decision) {
        return json({ error: "approval_request_id and decision (approve/reject) are required" }, 400);
      }

      const { data: request, error: reqErr } = await admin
        .from("dd_approval_requests")
        .select("*")
        .eq("id", approval_request_id)
        .single();

      if (reqErr || !request) return json({ error: "Approval request not found" }, 404);
      if (request.status !== "pending") return json({ error: "Request is no longer pending" }, 422);

      // Determine actor's DD role for the requesting org
      const { data: ddRoles } = await admin
        .from("dd_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("org_id", request.requesting_org_id);

      const actorRoles = (ddRoles || []).map((r: any) => r.role);

      // Check if user is platform admin (fallback)
      const { data: isAdmin } = await admin.rpc("is_admin", { user_id: user.id });

      // Find which required role this actor can fulfil
      const requiredRoles: string[] = request.required_roles || [];
      const completedRoles: string[] = request.completed_roles || [];
      const pendingRoles = requiredRoles.filter((r: string) => !completedRoles.includes(r));

      const matchedRole = pendingRoles.find((r: string) => actorRoles.includes(r));
      if (!matchedRole && !isAdmin) {
        return json({
          error: "You do not have the required role to action this request",
          required_roles: pendingRoles,
          your_roles: actorRoles,
        }, 403);
      }

      const actingRole = matchedRole || "platform_admin";

      // Record the action (append-only)
      await admin.from("dd_approval_actions").insert({
        approval_request_id,
        actor_user_id: user.id,
        actor_role: actingRole,
        action: decision,
        reason: reason || null,
      });

      if (decision === "reject") {
        await admin.from("dd_approval_requests")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .eq("id", approval_request_id);

        await admin.from("audit_logs").insert({
          org_id: request.requesting_org_id,
          actor_user_id: user.id,
          action: "dd.approval_rejected",
          entity_type: "dd_approval_requests",
          entity_id: approval_request_id,
          metadata: { role: actingRole, reason },
        });

        // ── Notify requester of rejection ──
        const { data: requesterProfile } = await admin
          .from("profiles")
          .select("id")
          .eq("org_id", request.requesting_org_id)
          .limit(5);
        if (requesterProfile && requesterProfile.length > 0) {
          const rejectNotifs = requesterProfile.map((p: any) => ({
            user_id: p.id,
            org_id: request.requesting_org_id,
            type: "approval_rejected",
            title: "Approval request rejected",
            body: `Your due diligence approval request was rejected by ${actingRole}. Reason: ${reason || "No reason provided"}.`,
            link: `/due-diligence`,
            read: false,
            entity_type: "dd_approval_request",
            entity_id: approval_request_id,
          }));
          await admin.from("notifications").insert(rejectNotifs).catch((err: any) =>
            console.error("[due-diligence] Rejection notification failed:", err.message)
          );
        }

        // NOT-008: rejection is terminal — clear all unread "approval_required"
        // rows for this request across every approver.
        await resolveNotificationsFor(admin, "dd_approval_request", approval_request_id, {
          source: "due-diligence:rejected",
        });

        await admin.functions.invoke("notification-dispatch", {
          body: {
            event_type: "dd.approval_rejected",
            subject: "Due diligence approval rejected",
            message: `Approval request ${approval_request_id} was rejected by ${actingRole}. Reason: ${reason || "N/A"}.`,
            metadata: { org_id: request.requesting_org_id, approval_request_id, role: actingRole },
          },
        }).catch((err: any) => console.error("[due-diligence] notification-dispatch failed:", err));

        return json({ success: true, status: "rejected" });
      }

      // Approve: add role to completed
      const newCompleted = [...completedRoles, actingRole];
      const allComplete = requiredRoles.every((r: string) => newCompleted.includes(r));

      await admin.from("dd_approval_requests")
        .update({
          completed_roles: newCompleted,
          status: allComplete ? "approved" : "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", approval_request_id);

      // If all approvals complete, set trade approval
      if (allComplete) {
        const { data: riskScore } = await admin
          .from("dd_risk_scores")
          .select("risk_band")
          .eq("id", request.risk_score_id)
          .maybeSingle();

        await admin.from("trade_approvals").upsert({
          org_id: request.target_org_id,
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: user.id,
          approval_request_id,
          risk_band: riskScore?.risk_band || "unknown",
          valid_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: "org_id" });
      }

      await admin.from("audit_logs").insert({
        org_id: request.requesting_org_id,
        actor_user_id: user.id,
        action: allComplete ? "dd.approval_completed" : "dd.approval_partial",
        entity_type: "dd_approval_requests",
        entity_id: approval_request_id,
        metadata: {
          role: actingRole,
          completed_roles: newCompleted,
          all_complete: allComplete,
        },
      });

      // ── Notify on approval progress ──
      if (allComplete) {
        // Notify requester that approval is fully complete
        const { data: reqOrgUsers } = await admin
          .from("profiles")
          .select("id")
          .eq("org_id", request.requesting_org_id)
          .limit(10);
        if (reqOrgUsers && reqOrgUsers.length > 0) {
          const completeNotifs = reqOrgUsers.map((p: any) => ({
            user_id: p.id,
            org_id: request.requesting_org_id,
            type: "approval_completed",
            title: "Trade approval granted",
            body: "All required approvals have been completed. The organisation is now approved to trade.",
            link: `/due-diligence`,
            read: false,
          }));
          await admin.from("notifications").insert(completeNotifs).catch((err: any) =>
            console.error("[due-diligence] Completion notification failed:", err.message)
          );
        }

        await admin.functions.invoke("notification-dispatch", {
          body: {
            event_type: "dd.approval_completed",
            subject: "Trade approval fully granted",
            message: `All required role approvals have been completed for approval request ${approval_request_id}. Organisation ${request.target_org_id} is now approved to trade.`,
            metadata: { org_id: request.requesting_org_id, target_org_id: request.target_org_id, approval_request_id },
          },
        }).catch((err: any) => console.error("[due-diligence] notification-dispatch failed:", err));
      } else {
        // Notify remaining approvers that a partial approval occurred
        const remainingRoles = requiredRoles.filter((r: string) => !newCompleted.includes(r));
        const { data: remainingUsers } = await admin
          .from("dd_roles")
          .select("user_id, role")
          .eq("org_id", request.requesting_org_id)
          .in("role", remainingRoles);

        if (remainingUsers && remainingUsers.length > 0) {
          const partialNotifs = remainingUsers.map((u: any) => ({
            user_id: u.user_id,
            org_id: request.requesting_org_id,
            type: "approval_required",
            title: `Your approval is still required (${u.role})`,
            body: `${actingRole} has approved. Your ${u.role} sign-off is still needed to complete the approval.`,
            link: `/due-diligence`,
            read: false,
          }));
          await admin.from("notifications").insert(partialNotifs).catch((err: any) =>
            console.error("[due-diligence] Partial approval notification failed:", err.message)
          );
        }

        // External dispatch for partial approval (email/Slack)
        await admin.functions.invoke("notification-dispatch", {
          body: {
            event_type: "dd.approval_partial",
            subject: `Partial approval - ${remainingRoles.join(", ")} still required`,
            message: `${actingRole} has approved request ${approval_request_id}. Remaining roles needed: ${remainingRoles.join(", ")}.`,
            metadata: { org_id: request.requesting_org_id, approval_request_id, completed_roles: newCompleted, remaining_roles: remainingRoles },
          },
        }).catch((err: any) => console.error("[due-diligence] notification-dispatch failed:", err));
      }

      return json({
        success: true,
        status: allComplete ? "approved" : "pending",
        completed_roles: newCompleted,
        remaining_roles: requiredRoles.filter((r: string) => !newCompleted.includes(r)),
      });
    }

    // ════════════════════════════════════════════
    // ACTION: get_dossier
    // ════════════════════════════════════════════
    if (action === "get_dossier") {
      const targetOrg = body.org_id || url.searchParams.get("org_id") || profile.org_id;

      const [directors, kycDocs, kycStatus, screenings, riskScores, approvals, tradeStatus] = await Promise.all([
        admin.from("org_directors").select("*").eq("org_id", targetOrg),
        admin.from("kyc_documents").select("id, doc_type, filename, status, issuing_country, expiry_date, created_at").eq("org_id", targetOrg),
        admin.from("kyc_status").select("*").eq("org_id", targetOrg).maybeSingle(),
        admin.from("screening_results").select("*").eq("org_id", targetOrg).order("screened_at", { ascending: false }),
        admin.from("dd_risk_scores").select("*").eq("org_id", targetOrg).order("computed_at", { ascending: false }).limit(5),
        admin.from("dd_approval_requests").select("*, dd_approval_actions(*)").or(`target_org_id.eq.${targetOrg},requesting_org_id.eq.${targetOrg}`).order("created_at", { ascending: false }),
        admin.from("trade_approvals").select("status, approved_at, risk_band, valid_until").eq("org_id", targetOrg).maybeSingle(),
      ]);

      return json({
        org_id: targetOrg,
        directors: directors.data || [],
        kyc_documents: kycDocs.data || [],
        kyc_status: kycStatus.data || { status: "incomplete", completeness_percentage: 0 },
        screening_results: screenings.data || [],
        risk_scores: riskScores.data || [],
        approval_requests: approvals.data || [],
        trade_approval: tradeStatus.data || { status: "not_approved" },
      });
    }

    // ════════════════════════════════════════════
    // ACTION: get_trade_status
    // ════════════════════════════════════════════
    if (action === "get_trade_status") {
      const targetOrg = body.org_id || url.searchParams.get("org_id");
      if (!targetOrg) return json({ error: "org_id is required" }, 400);

      const { data } = await admin
        .from("trade_approvals")
        .select("status, approved_at, risk_band, valid_until")
        .eq("org_id", targetOrg)
        .maybeSingle();

      return json({
        org_id: targetOrg,
        trade_status: data?.status || "not_approved",
        approved_at: data?.approved_at || null,
        risk_band: data?.risk_band || null,
        valid_until: data?.valid_until || null,
      });
    }

    // ════════════════════════════════════════════
    // ACTION: update_thresholds
    // ════════════════════════════════════════════
    if (action === "update_thresholds") {
      const { low_threshold, high_threshold } = body;

      // Must be director to change thresholds
      const { data: ddRoles } = await admin
        .from("dd_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("org_id", profile.org_id);
      const isDirector = (ddRoles || []).some((r: any) => r.role === "director");
      const { data: isPlatformAdmin } = await admin.rpc("is_admin", { user_id: user.id });

      if (!isDirector && !isPlatformAdmin) {
        return json({ error: "Director override required to change thresholds" }, 403);
      }

      const { data, error } = await admin.from("approval_thresholds").upsert({
        org_id: profile.org_id,
        low_threshold: low_threshold ?? 30,
        high_threshold: high_threshold ?? 70,
        updated_by: user.id,
        override_approved_by: user.id,
      }, { onConflict: "org_id" }).select().single();

      if (error) return json({ error: error.message }, 500);

      await admin.from("audit_logs").insert({
        org_id: profile.org_id,
        actor_user_id: user.id,
        action: "dd.thresholds_updated",
        entity_type: "approval_thresholds",
        entity_id: data.id,
        metadata: { low_threshold, high_threshold, override_by: user.id },
      });

      return json({ success: true, thresholds: data });
    }

    // ════════════════════════════════════════════
    // ACTION: assign_dd_role
    // ════════════════════════════════════════════
    if (action === "assign_dd_role") {
      const { target_user_id, role: ddRole, org_id } = body;
      if (!target_user_id || !ddRole) {
        return json({ error: "target_user_id and role are required" }, 400);
      }

      const targetOrgId = org_id || profile.org_id;

      // Must be org_admin or platform_admin
      const { data: isPlatformAdmin } = await admin.rpc("is_admin", { user_id: user.id });
      const { data: isOrgAdmin } = await admin.rpc("is_org_admin", { _user_id: user.id, _org_id: targetOrgId });

      if (!isPlatformAdmin && !isOrgAdmin) {
        return json({ error: "Only org admins or platform admins can assign DD roles" }, 403);
      }

      const { data, error } = await admin.from("dd_roles").insert({
        user_id: target_user_id,
        org_id: targetOrgId,
        role: ddRole,
      }).select().single();

      if (error) {
        if (error.code === "23505") return json({ error: "Role already assigned" }, 409);
        return json({ error: error.message }, 500);
      }

      await admin.from("audit_logs").insert({
        org_id: targetOrgId,
        actor_user_id: user.id,
        action: "dd.role_assigned",
        entity_type: "dd_roles",
        entity_id: data.id,
        metadata: { target_user_id, role: ddRole },
      });

      return json({ success: true, dd_role: data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    console.error("Due diligence error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}
