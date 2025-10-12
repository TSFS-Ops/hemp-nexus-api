// Middleware to validate X-API-Key header against bst3_API_KEY environment variable
export const validateApiKey = (req: Request): Response | null => {
  const apiKey = Deno.env.get('bst3_API_KEY');
  const requestApiKey = req.headers.get('X-API-Key');

  if (!requestApiKey || requestApiKey !== apiKey) {
    return new Response(
      JSON.stringify({
        code: 'UNAUTHENTICATED',
        message: 'X-API-Key required'
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  return null; // Validation passed
};
