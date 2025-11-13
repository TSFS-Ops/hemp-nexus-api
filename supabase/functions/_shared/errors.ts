// Standard error response format for Trade.Izenzo API
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  requestId: string;
}

export class ApiException extends Error {
  public code: string;
  public statusCode: number;
  public details?: Record<string, any>;

  constructor(
    code: string,
    message: string,
    statusCode: number = 400,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApiException';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Convert database errors to ApiException (prevents info leakage)
export const handleDatabaseError = (error: any, requestId: string): never => {
  console.error(`[${requestId}] Database error:`, error);
  
  // Don't expose database implementation details
  throw new ApiException(
    'DATABASE_ERROR',
    'A database error occurred',
    500
  );
};

export const errorResponse = (
  error: ApiException | Error,
  requestId: string,
  headers: Record<string, string> = {}
): Response => {
  console.error(`[${requestId}] Error:`, error);

  if (error instanceof ApiException) {
    const body: ApiError = {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId,
    };
    return new Response(JSON.stringify(body), {
      status: error.statusCode,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  // Generic error (don't leak stack traces)
  const body: ApiError = {
    code: 'INTERNAL_ERROR',
    message: 'An internal error occurred',
    requestId,
  };
  return new Response(JSON.stringify(body), {
    status: 500,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
};
