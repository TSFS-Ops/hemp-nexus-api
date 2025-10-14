import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { validateApiKey } from '../_shared/api-key-middleware.ts';
import { updateSahpraCache, verifySahpra } from '../_shared/sahpra.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders('*') });
  }
  
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const url = new URL(req.url);
    const path = url.pathname.split('/').filter(Boolean);
    
    // GET /sahpra-verification/refresh - Refresh CSV cache (internal only)
    if (req.method === 'GET' && path[path.length - 1] === 'refresh') {
      await updateSahpraCache(supabase);
      
      return new Response(
        JSON.stringify({ success: true, message: 'Cache refreshed' }),
        { headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
      );
    }
    
    // POST /v1/verify/sahpra - Verify company (protected by BST3_API_KEY)
    if (req.method === 'POST' && path.includes('v1') && path.includes('verify') && path.includes('sahpra')) {
      // Validate API key
      const authError = validateApiKey(req);
      if (authError) {
        return authError;
      }
      
      const { companyName, licenceNo } = await req.json();
      
      if (!companyName) {
        return new Response(
          JSON.stringify({ 
            code: 'INVALID_REQUEST',
            error: 'companyName is required' 
          }),
          { status: 400, headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
        );
      }
      
      const result = await verifySahpra(supabase, companyName, licenceNo);
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ 
        code: 'NOT_FOUND',
        error: 'Endpoint not found' 
      }),
      { status: 404, headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[SAHPRA] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        code: 'INTERNAL_ERROR',
        error: message 
      }),
      { status: 500, headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
    );
  }
});
