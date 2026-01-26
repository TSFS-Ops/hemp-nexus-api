/**
 * Admin Lookup Profiles Edge Function
 * 
 * Provides admin-only access to profile data (including email addresses).
 * This is the ONLY authorized way to look up user emails from the frontend.
 * 
 * Security: Verifies caller is admin before returning any PII.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProfileLookupRequest {
  user_ids: string[];
}

interface ProfileResult {
  id: string;
  email: string;
  full_name: string | null;
  org_id: string;
  org_name: string | null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', code: 'MISSING_AUTH' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's auth context
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate JWT and get user
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token', code: 'INVALID_TOKEN' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claims.claims.sub as string;

    // Check if caller is admin using the is_admin function
    const { data: isAdmin, error: adminError } = await userClient.rpc('is_admin', {
      user_id: userId,
    });

    if (adminError || !isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let body: ProfileLookupRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid request body', code: 'INVALID_BODY' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { user_ids } = body;

    // Validate user_ids
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'user_ids must be a non-empty array', code: 'INVALID_USER_IDS' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit to prevent abuse
    if (user_ids.length > 100) {
      return new Response(
        JSON.stringify({ error: 'Maximum 100 user_ids per request', code: 'TOO_MANY_IDS' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = user_ids.filter(id => !uuidRegex.test(id));
    if (invalidIds.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid UUID format in user_ids', code: 'INVALID_UUID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role to fetch profiles (bypasses RLS for admin lookup)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch profiles with org names
    const { data: profiles, error: profilesError } = await serviceClient
      .from('profiles')
      .select('id, email, full_name, org_id')
      .in('id', user_ids);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch profiles', code: 'FETCH_ERROR' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch org names for enrichment
    const orgIds = [...new Set(profiles?.map(p => p.org_id) ?? [])];
    const { data: orgs } = await serviceClient
      .from('organizations')
      .select('id, name')
      .in('id', orgIds);

    const orgMap = new Map(orgs?.map(o => [o.id, o.name]) ?? []);

    // Build result with org names
    const results: ProfileResult[] = (profiles ?? []).map(p => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      org_id: p.org_id,
      org_name: orgMap.get(p.org_id) ?? null,
    }));

    // Log this admin access for audit trail
    await serviceClient.from('admin_audit_logs').insert({
      admin_user_id: userId,
      action: 'lookup_profiles',
      target_type: 'profiles',
      details: { user_ids_count: user_ids.length },
    });

    return new Response(
      JSON.stringify({ profiles: results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Admin lookup profiles error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
