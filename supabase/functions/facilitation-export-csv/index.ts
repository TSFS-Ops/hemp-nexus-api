/**
 * facilitation-export-csv — Batch 8 management CSV export.
 *
 * Allowed roles: platform_admin OR compliance_analyst.
 *
 * Operational fields only. Excluded by design:
 *   - internal compliance notes, sanctions/PEP details, DNC details,
 *     private admin notes, raw audit payloads, event logs,
 *     requester-hidden evidence summaries,
 *     UUIDs where a plain label/reference exists.
 *
 * Accepts the same filter shape as list-facilitation-cases. No mutations.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

const FilterSchema = z.object({
  status: z.string().trim().max(64).nullable().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).nullable().optional(),
  overdue_only: z.boolean().nullable().optional(),
  warning_only: z.boolean().nullable().optional(),
  country: z.string().trim().max(64).nullable().optional(),
  sector: z.string().trim().max(64).nullable().optional(),
  value_min: z.number().nonnegative().nullable().optional(),
  value_max: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
  open_or_closed: z.enum(["open", "closed"]).nullable().optional(),
  final_outcome: z.string().trim().max(64).nullable().optional(),
  requesting_org_id: z.string().uuid().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  awaiting_assignment: "Awaiting assignment",
  admin_reviewing: "Admin reviewing",
  more_information_needed: "More information needed",
  compliance_review_required: "Compliance review required",
  blocked_by_compliance: "Blocked by compliance",
  duplicate_review: "Duplicate review",
  ready_for_contact: "Ready for contact",
  contact_attempted: "Contact attempted",
  awaiting_counterparty_response: "Awaiting counterparty response",
  counterparty_responded: "Counterparty responded",
  counterparty_declined: "Counterparty declined",
  ready_for_known_counterparty_poi: "Ready for known-counterparty POI",
  converted_to_known_counterparty_poi: "Converted to known-counterparty POI",
  unable_to_proceed: "Unable to proceed",
  cancelled_by_requester: "Cancelled by requester",
  closed: "Closed",
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try { return new Date(iso).toISOString().slice(0, 19).replace("T", " "); } catch { return ""; }
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
  if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let parsed;
  try { parsed = FilterSchema.safeParse(await req.json().catch(() => ({}))); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);
  const f = parsed.data;

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // ── Role check (platform_admin OR compliance_analyst).
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["platform_admin", "compliance_analyst"])
    .maybeSingle();
  if (!roleRow) return json(req, { error: "Forbidden" }, 403);

  let q = admin.from("facilitation_cases").select("*").order("created_at", { ascending: false }).limit(5000);
  if (f.status) q = q.eq("internal_status", f.status);
  if (f.urgency) q = q.eq("urgency", f.urgency);
  if (f.overdue_only) q = q.eq("is_overdue", true);
  if (f.country) q = q.ilike("counterparty_country", `%${f.country}%`);
  if (f.sector) q = q.ilike("sector", `%${f.sector}%`);
  if (f.currency) q = q.eq("estimated_value_currency", f.currency.toUpperCase());
  if (typeof f.value_min === "number") q = q.gte("estimated_value_amount", f.value_min);
  if (typeof f.value_max === "number") q = q.lte("estimated_value_amount", f.value_max);
  if (f.final_outcome) q = q.eq("final_outcome", f.final_outcome);
  if (f.requesting_org_id) q = q.eq("requesting_org_id", f.requesting_org_id);
  if (f.owner_user_id) q = q.eq("case_owner_id", f.owner_user_id);
  if (f.open_or_closed === "open") q = q.is("closed_at", null);
  if (f.open_or_closed === "closed") q = q.not("closed_at", "is", null);
  if (f.date_from) q = q.gte("created_at", `${f.date_from}T00:00:00Z`);
  if (f.date_to) q = q.lte("created_at", `${f.date_to}T23:59:59Z`);
  if (f.warning_only) q = q.or("is_overdue.eq.true,internal_status.eq.blocked_by_compliance");

  const { data: rows, error } = await q;
  if (error) return json(req, { error: error.message }, 500);
  const cases = (rows ?? []) as Record<string, unknown>[];

  // Resolve org names + user labels (single batched lookup).
  const orgIds = new Set<string>();
  const userIds = new Set<string>();
  for (const c of cases) {
    if (c.requesting_org_id) orgIds.add(c.requesting_org_id as string);
    if (c.linked_organization_id) orgIds.add(c.linked_organization_id as string);
    if (c.requesting_user_id) userIds.add(c.requesting_user_id as string);
    if (c.case_owner_id) userIds.add(c.case_owner_id as string);
  }
  const orgMap = new Map<string, string>();
  const userMap = new Map<string, string>();
  if (orgIds.size > 0) {
    const { data: orgs } = await admin.from("organizations").select("id, name").in("id", [...orgIds]);
    for (const o of (orgs ?? []) as { id: string; name: string }[]) orgMap.set(o.id, o.name);
  }
  if (userIds.size > 0) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, email").in("id", [...userIds]);
    for (const p of (profs ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      userMap.set(p.id, p.full_name || p.email || "—");
    }
  }

  // Contact-attempt counts (batched).
  const contactCounts = new Map<string, number>();
  if (cases.length > 0) {
    const { data: ca } = await admin
      .from("facilitation_case_contact_attempts")
      .select("case_id")
      .in("case_id", cases.map((c) => c.id as string));
    for (const r of (ca ?? []) as { case_id: string }[]) {
      contactCounts.set(r.case_id, (contactCounts.get(r.case_id) ?? 0) + 1);
    }
  }

  // ── Operational columns only.
  const headers = [
    "Case number",
    "Created",
    "Case age (days)",
    "Status",
    "Overdue",
    "Next action due",
    "Case owner",
    "Requester organisation",
    "Requester user",
    "Counterparty name",
    "Country",
    "Sector",
    "Counterparty role",
    "Estimated value",
    "Currency",
    "Urgency",
    "Contact attempts",
    "Final outcome",
    "Linked organisation",
    "POI reference",
    "Closed date",
  ];

  const lines: string[] = [];
  lines.push(headers.join(","));
  const nowMs = Date.now();
  for (const c of cases) {
    const created = c.created_at as string | null;
    const ageDays = created ? Math.floor((nowMs - new Date(created).getTime()) / (24 * 36e5)) : "";
    const status = STATUS_LABELS[(c.internal_status as string) ?? ""] ?? (c.internal_status as string) ?? "";
    const row = [
      c.case_number,
      fmtDate(created),
      ageDays,
      status,
      c.is_overdue ? "Yes" : "No",
      fmtDate(c.next_action_due_at as string | null),
      c.case_owner_id ? userMap.get(c.case_owner_id as string) ?? "" : "",
      c.requesting_org_id ? orgMap.get(c.requesting_org_id as string) ?? "" : "",
      c.requesting_user_id ? userMap.get(c.requesting_user_id as string) ?? "" : "",
      c.counterparty_legal_name ?? c.counterparty_trading_name ?? "",
      c.counterparty_country ?? "",
      c.sector ?? "",
      c.role ?? "",
      c.estimated_value_amount ?? "",
      c.estimated_value_currency ?? "",
      c.urgency ?? "",
      contactCounts.get(c.id as string) ?? 0,
      c.final_outcome ?? "",
      c.linked_organization_id ? orgMap.get(c.linked_organization_id as string) ?? "" : "",
      c.poi_conversion_reference ?? "",
      fmtDate(c.closed_at as string | null),
    ];
    lines.push(row.map(csvEscape).join(","));
  }

  // Audit (best-effort, non-blocking semantics).
  await admin.from("audit_logs").insert({
    action: "facilitation.management.csv_exported",
    user_id: userId,
    metadata: {
      row_count: cases.length,
      filters: f,
    },
  }).then(() => undefined).catch(() => undefined);

  const csv = lines.join("\r\n") + "\r\n";
  const filename = `facilitation-cases-${new Date().toISOString().slice(0, 10)}.csv`;
  return withCors(req, new Response(csv, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  }));
});
