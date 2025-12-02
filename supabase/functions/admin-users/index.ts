import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify caller is admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if caller is admin
    const { data: isAdmin } = await supabaseAdmin.rpc('is_admin', { user_id: caller.id });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all users from auth.users
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (usersError) {
      throw usersError;
    }

    // Get profiles with organizations
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, org_id, status, created_at, organizations(name)');

    const { data: roles } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role');

    // Combine data
    const enrichedUsers = users.map(authUser => {
      const profile = profiles?.find(p => p.id === authUser.id);
      const userRoles = roles?.filter(r => r.user_id === authUser.id) || [];
      
      // Handle organizations which could be an object or array
      let orgName = 'Unknown';
      if (profile?.organizations) {
        const org = profile.organizations;
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
        organization_name: orgName,
        status: profile?.status || 'unknown',
        created_at: authUser.created_at,
        last_sign_in_at: authUser.last_sign_in_at,
        email_confirmed_at: authUser.email_confirmed_at,
        roles: userRoles.map(r => r.role),
      };
    });

    return new Response(JSON.stringify({ users: enrichedUsers }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
