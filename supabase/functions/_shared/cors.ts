// CORS configuration for Trade.Izenzo API
export const corsHeaders = (allowedOrigins: string, origin: string | null = null) => {
  const allowedList = allowedOrigins.split(',').map(o => o.trim()).filter(Boolean);
  
  // If no origins configured or wildcard, use wildcard (for development only)
  if (allowedList.length === 0 || allowedList.includes('*')) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, idempotency-key, x-request-id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Idempotent-Replay, X-Match-Duplicate',
  };
  }
  
  // Validate origin against whitelist
  const allowedOrigin = origin && allowedList.includes(origin) ? origin : allowedList[0];
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, idempotency-key, x-request-id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Idempotent-Replay, X-Match-Duplicate',
  };
};

export const handleCors = (req: Request, allowedOrigins: string) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('origin');
    return new Response(null, { 
      status: 204,
      headers: corsHeaders(allowedOrigins, origin) 
    });
  }
  return null;
};
