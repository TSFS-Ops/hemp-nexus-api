import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { updateSahpraCache, verifySahpra } from '../_shared/sahpra.ts';
import { authenticateRequest, requireScope } from '../_shared/auth.ts';
import { sahpraVerifySchema, validateInput } from '../_shared/validation.ts';

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
    
    // POST /v1/verify/sahpra - Verify company
    if (req.method === 'POST' && path.includes('v1') && path.includes('verify') && path.includes('sahpra')) {
      // Authenticate request
      const authCtx = await authenticateRequest(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      requireScope(authCtx, 'sahpra');
      
      const rawBody = await req.json();
      
      let validatedData;
      try {
        validatedData = validateInput(sahpraVerifySchema, rawBody);
      } catch (error) {
        return new Response(
          JSON.stringify({ 
            code: 'INVALID_REQUEST',
            error: error instanceof Error ? error.message : 'Invalid input'
          }),
          { status: 400, headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
        );
      }
      
      const { companyName, licenceNo } = validatedData;
      
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
