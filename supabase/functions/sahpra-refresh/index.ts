import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  try {
    console.log('[SAHPRA-REFRESH] Starting daily SAHPRA cache refresh');
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Call the sahpra-verification refresh endpoint
    const refreshUrl = `${SUPABASE_URL}/functions/v1/sahpra-verification/refresh`;
    const response = await fetch(refreshUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Refresh failed: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('[SAHPRA-REFRESH] Cache refreshed successfully:', result);
    
    return new Response(
      JSON.stringify({ success: true, timestamp: new Date().toISOString() }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[SAHPRA-REFRESH] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
