// CORS configuration for SignalRank API
export const corsHeaders = (allowedOrigins: string) => {
  const origins = allowedOrigins || '*';
  return {
    'Access-Control-Allow-Origin': origins,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, idempotency-key, x-request-id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
};

export const handleCors = (req: Request, allowedOrigins: string) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders(allowedOrigins) 
    });
  }
  return null;
};
