/**
 * Admin Users Edge Function (consolidated)
 *
 * Handles two actions:
 *   GET  → list all users (enriched with profiles, roles, orgs)
 *   POST { action: "lookup_profiles", user_ids: [...] } → batch profile lookup
 *
 * Both paths require platform_admin role.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { assertIdempotencyKey } from '../_shared/idempotency.ts';
import { handleCorsPreflight, withCors } from '../_shared/cors.ts';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  }));
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Auth ─────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorisation');
    if (!authHeader) {
      return jsonResponse({ error: 'Unauthorised' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !caller) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    const { data: isAdmin } = await supabaseAdmin.rpc('is_admin', { user_id: caller.id });
    if (!isAdmin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    // ── Route by method ──────────────────────────────────────────────────

    // POST: lookup_profiles action OR default list
    if (req.method === 'POST') {
      try { assertIdempotencyKey(req); } catch (e: any) { return jsonResponse({ error: e.message, code: e.code }, e.statusCode || 400); }
      let body: Record<string, unknown> = {};
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          const text = await req.text();
          if (text.trim()) {
            body = JSON.parse(text);
          }
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400);
        }
      }

      if (body.action === 'lookup_profiles') {
        return await handleLookupProfiles(supabaseAdmin, caller.id, body);
      }
      // fallthrough: treat as list users (backward compat)
    }

    // GET (or POST without action): list all users
    return await handleListUsers(supabaseAdmin);
  } catch (error) {
    // Log full error server-side for debugging, but never leak details to caller
    console.error('Error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

// ── List Users ────────────────────────────────────────────────────────────

async function handleListUsers(supabaseAdmin: any) {
  // GoTrue paginated fetch - loop until we get a partial page
  const allUsers: any[] = [];
  const perPage = 1000;
  const maxPages = 10; // safety cap: 10,000 users max
  for (let page = 1; page <= maxPages; page++) {
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (usersError) throw usersError;
    allUsers.push(...users);
    if (users.length < perPage) break; // last page
  }

  // Paginated profiles fetch to avoid 1000-row default cap
  const allProfiles: any[] = [];
  const profilePageSize = 1000;
  let profileOffset = 0;
  while (true) {
    const { data: batch } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, org_id, status, created_at, deletion_requested_at, deletion_reason, deletion_category, organizations(name)')
      .range(profileOffset, profileOffset + profilePageSize - 1);
    if (!batch || batch.length === 0) break;
    allProfiles.push(...batch);
    if (batch.length < profilePageSize) break;
    profileOffset += profilePageSize;
  }
  const profiles = allProfiles;

  const { data: roles } = await supabaseAdmin
    .from('user_roles')
    .select('user_id, role');

  const enrichedUsers = allUsers.map((authUser: any) => {
    const profile = profiles?.find((p: any) => p.id === authUser.id);
    const userRoles = roles?.filter((r: any) => r.user_id === authUser.id) || [];

    let orgName = 'Unknown';
    if (profile?.organisations) {
      const org = profile.organisations;
      if (Array.isArray(org) && org.length > 0) {
        orgName = org[0].name;
      } else if (typeof org === 'object' && 'name' in org) {
        orgName = (org as { name: string }).name;
      }
    }

    return {
      id: authUser.id,
      email: authUser.email,
      full_name: profile?.full_name || null,
      org_id: profile?.org_id || null,
      organisation_name: orgName,
      status: profile?.status || 'unknown',
      created_at: authUser.created_at,
      last_sign_in_at: authUser.last_sign_in_at,
      email_confirmed_at: authUser.email_confirmed_at,
      roles: userRoles.map((r: any) => r.role),
      deletion_requested_at: profile?.deletion_requested_at || null,
      deletion_reason: profile?.deletion_reason || null,
      deletion_category: profile?.deletion_category || null,
    };
  });

  return wrap(jsonResponse({ users: enrichedUsers }));
}

// ── Lookup Profiles ───────────────────────────────────────────────────────

async function handleLookupProfiles(
  supabaseAdmin: any,
  adminUserId: string,
  body: Record<string, unknown>,
) {
  const userIds = body.user_ids;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return jsonResponse({ error: 'user_ids must be a non-empty array' }, 400);
  }
  if (userIds.length > 100) {
    return jsonResponse({ error: 'Maximum 100 user_ids per request' }, 400);
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidIds = userIds.filter((id: string) => !uuidRegex.test(id));
  if (invalidIds.length > 0) {
    return jsonResponse({ error: 'Invalid UUID format in user_ids' }, 400);
  }

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, org_id')
    .in('id', userIds);

  if (profilesError) {
    console.error('Error fetching profiles:', profilesError);
    return jsonResponse({ error: 'Failed to fetch profiles' }, 500);
  }

  const orgIds = [...new Set(profiles?.map((p: any) => p.org_id) ?? [])];
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .in('id', orgIds);

  const orgMap = new Map((orgs ?? []).map((o: any) => [o.id, o.name]));

  const results = (profiles ?? []).map((p: any) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    org_id: p.org_id,
    org_name: orgMap.get(p.org_id) ?? null,
  }));

  // Audit log
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUserId,
    action: 'lookup_profiles',
    target_type: 'profiles',
    details: { user_ids_count: userIds.length },
  });

  return jsonResponse({ profiles: results });
}
