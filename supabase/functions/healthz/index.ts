import { corsHeaders, handleCors } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS') || '*';
  
  // Handle CORS preflight
  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(allowedOrigins),
  };

  return new Response(
    JSON.stringify({ ok: true, timestamp: new Date().toISOString() }),
    { status: 200, headers }
  );
});
