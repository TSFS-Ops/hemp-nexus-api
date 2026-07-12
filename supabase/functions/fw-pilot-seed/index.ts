// Institutional Funder Evidence Workspace — controlled-pilot seed function.
// Platform-admin only. Creates six fake pilot users (with email pre-confirmed
// and a temporary password), assigns them the correct roles inside the two
// pre-seeded funder organisations, and returns the credentials so a
// non-technical tester can log in immediately without SQL or UUIDs.
//
// This function is IDEMPOTENT: re-running it does not create duplicate users;
// it rotates the temporary password on the existing test accounts and
// re-asserts the correct role/org linkage. It NEVER touches real users
// (only the fixed .test emails listed below).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PILOT_FUNDER_ORG_ID = "11111111-1111-1111-1111-111111111111";
const ISOLATION_FUNDER_ORG_ID = "22222222-2222-2222-2222-222222222222";

type FunderRole = "funder_org_admin" | "funder_reviewer" | "funder_approver" | "funder_viewer";

interface UserSpec {
  email: string;
  displayName: string;
  kind: "platform_admin" | "funder";
  funderOrgId?: string;
  funderRole?: FunderRole;
  orgLabel: string;
}

const SPECS: UserSpec[] = [
  { email: "izenzo-admin+pilot@izenzo.test", displayName: "Izenzo Platform Admin (Pilot)", kind: "platform_admin", orgLabel: "Izenzo (platform)" },
  { email: "pilot-funder-admin@pilotfunderbank.test", displayName: "Pilot Funder Bank — Funder Admin", kind: "funder", funderOrgId: PILOT_FUNDER_ORG_ID, funderRole: "funder_org_admin", orgLabel: "Pilot Funder Bank" },
  { email: "pilot-funder-reviewer@pilotfunderbank.test", displayName: "Pilot Funder Bank — Reviewer", kind: "funder", funderOrgId: PILOT_FUNDER_ORG_ID, funderRole: "funder_reviewer", orgLabel: "Pilot Funder Bank" },
  { email: "pilot-funder-approver@pilotfunderbank.test", displayName: "Pilot Funder Bank — Approver", kind: "funder", funderOrgId: PILOT_FUNDER_ORG_ID, funderRole: "funder_approver", orgLabel: "Pilot Funder Bank" },
  { email: "pilot-funder-viewer@pilotfunderbank.test", displayName: "Pilot Funder Bank — Viewer", kind: "funder", funderOrgId: PILOT_FUNDER_ORG_ID, funderRole: "funder_viewer", orgLabel: "Pilot Funder Bank" },
  { email: "isolation-viewer@isolationtestfund.test", displayName: "Isolation Test Fund — Viewer", kind: "funder", funderOrgId: ISOLATION_FUNDER_ORG_ID, funderRole: "funder_viewer", orgLabel: "Isolation Test Fund" },
];

function generatePassword(): string {
  // 16 chars, mixed alphanum + a couple of symbols, avoid ambiguous chars.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `Pilot!${out}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "missing_bearer" }, 401);
  }

  // Verify caller is a platform admin.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) return json({ error: "not_authenticated" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "platform_admin")
    .maybeSingle();
  if (!roleRow) return json({ error: "not_platform_admin" }, 403);

  // Enumerate existing auth users once (page 1 large enough for a pilot).
  const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) return json({ error: "list_users_failed", detail: listErr.message }, 500);
  const byEmail = new Map<string, string>();
  for (const u of usersPage.users) {
    if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
  }

  const results: Array<{
    email: string;
    displayName: string;
    role: string;
    organisation: string;
    password: string;
    created: boolean;
  }> = [];

  for (const spec of SPECS) {
    const password = generatePassword();
    let authId = byEmail.get(spec.email.toLowerCase()) ?? null;
    let created = false;

    if (!authId) {
      const { data: cu, error: cuErr } = await admin.auth.admin.createUser({
        email: spec.email,
        password,
        email_confirm: true,
        user_metadata: { display_name: spec.displayName, pilot_seed: true },
      });
      if (cuErr || !cu.user) {
        return json({ error: "create_user_failed", email: spec.email, detail: cuErr?.message }, 500);
      }
      authId = cu.user.id;
      created = true;
    } else {
      const { error: upErr } = await admin.auth.admin.updateUserById(authId, {
        password,
        email_confirm: true,
        user_metadata: { display_name: spec.displayName, pilot_seed: true },
      });
      if (upErr) return json({ error: "update_user_failed", email: spec.email, detail: upErr.message }, 500);
    }

    if (spec.kind === "platform_admin") {
      await admin.from("user_roles").upsert(
        { user_id: authId, role: "platform_admin" },
        { onConflict: "user_id,role" },
      );
    }

    if (spec.kind === "funder" && spec.funderOrgId && spec.funderRole) {
      await admin.from("p5_batch3_funder_users").upsert(
        {
          funder_organisation_id: spec.funderOrgId,
          email: spec.email,
          auth_user_id: authId,
          role: spec.funderRole,
          status: "active",
          accepted_at: new Date().toISOString(),
          display_name: spec.displayName,
        },
        { onConflict: "funder_organisation_id,email" },
      );
    }

    results.push({
      email: spec.email,
      displayName: spec.displayName,
      role: spec.kind === "platform_admin" ? "Platform Admin" : (spec.funderRole ?? ""),
      organisation: spec.orgLabel,
      password,
      created,
    });
  }

  return json({
    ok: true,
    seeded_at: new Date().toISOString(),
    users: results,
    note: "Temporary passwords rotated. Copy them now — re-running rotates them again.",
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
