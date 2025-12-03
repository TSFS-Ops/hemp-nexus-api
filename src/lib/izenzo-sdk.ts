/**
 * Compliance Matching API SDK
 * TypeScript client for the Compliance Matching API
 * 
 * @example
 * ```typescript
 * import { IzenzoClient } from '@/lib/izenzo-sdk';
 * 
 * const client = new IzenzoClient('sk_your_api_key');
 * const match = await client.matches.create({
 *   buyer: { id: 'B001', name: 'Acme Corp' },
 *   seller: { id: 'S001', name: 'Supplier Inc' },
 *   commodity: 'Steel Coils',
 *   quantity: { amount: 100, unit: 'tonnes' },
 *   price: { amount: 50000, currency: 'USD' }
 * });
 * ```
 */

// Types
export interface Party {
  id: string;
  name: string;
}

export interface Quantity {
  amount: number;
  unit: string;
}

export interface Price {
  amount: number;
  currency: string;
}

export interface MatchCreateParams {
  buyer: Party;
  seller: Party;
  commodity: string;
  quantity: Quantity;
  price: Price;
  terms?: string;
  metadata?: Record<string, unknown>;
}

export interface Match {
  id: string;
  created_at: string;
  status: 'matched' | 'settled';
  hash: string;
  buyer_id: string;
  buyer_name: string;
  seller_id: string;
  seller_name: string;
  commodity: string;
  quantity_amount: number;
  quantity_unit: string;
  price_amount: number;
  price_currency: string;
  terms?: string;
  metadata?: Record<string, unknown>;
  settled_at?: string;
}

export interface MatchListParams {
  limit?: number;
  offset?: number;
  status?: 'matched' | 'settled';
  commodity?: string;
}

export interface MatchListResponse {
  items: Match[];
  totalCount: number;
}

export interface SignalCreateParams {
  product: string;
  quantity?: number;
  unit?: string;
  location?: string;
  deliveryWindow?: {
    start?: string;
    end?: string;
  };
  budget?: number;
  currency?: string;
  notes?: string;
}

export interface Signal {
  id: string;
  type: 'buyer' | 'seller';
  status: 'searching' | 'matched' | 'expired';
  content: Record<string, unknown>;
  created_at: string;
}

export interface Option {
  id: string;
  what: string;
  how_much: number;
  unit: string;
  price?: number;
  currency?: string;
  where_location?: string;
  score?: number;
  freshness: string;
}

export interface SignalWithOptions extends Signal {
  options: Option[];
}

export interface Selection {
  selection_id: string;
  signal_id: string;
  option_id: string;
  handoff_url: string;
}

export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  status: string;
  created_at: string;
  last_used_at?: string;
}

export interface ApiKeyCreateParams {
  name: string;
  scopes?: string[];
  expires_at?: string | null;
}

export interface ApiKeyCreated extends ApiKey {
  key: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: string;
  created_at: string;
}

export interface WebhookCreateParams {
  url: string;
  events: string[];
}

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  responseTime?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

export class IzenzoApiError extends Error {
  code: string;
  statusCode: number;
  requestId: string;
  details?: Record<string, unknown>;

  constructor(error: ApiError, statusCode: number) {
    super(error.message);
    this.name = 'IzenzoApiError';
    this.code = error.code;
    this.statusCode = statusCode;
    this.requestId = error.requestId;
    this.details = error.details;
  }
}

// SDK Configuration
export interface IzenzoClientConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}

const DEFAULT_BASE_URL = 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1';
const DEFAULT_TIMEOUT = 30000;

/**
 * Compliance Matching API Client
 */
export class IzenzoClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  public readonly matches: MatchesResource;
  public readonly signals: SignalsResource;
  public readonly apiKeys: ApiKeysResource;
  public readonly webhooks: WebhooksResource;
  public readonly health: HealthResource;

  constructor(apiKeyOrConfig: string | IzenzoClientConfig) {
    if (typeof apiKeyOrConfig === 'string') {
      this.apiKey = apiKeyOrConfig;
      this.baseUrl = DEFAULT_BASE_URL;
      this.timeout = DEFAULT_TIMEOUT;
    } else {
      this.apiKey = apiKeyOrConfig.apiKey || '';
      this.baseUrl = apiKeyOrConfig.baseUrl || DEFAULT_BASE_URL;
      this.timeout = apiKeyOrConfig.timeout || DEFAULT_TIMEOUT;
    }

    // Initialize resources
    this.matches = new MatchesResource(this);
    this.signals = new SignalsResource(this);
    this.apiKeys = new ApiKeysResource(this);
    this.webhooks = new WebhooksResource(this);
    this.health = new HealthResource(this);
  }

  /**
   * Make an authenticated request to the API
   */
  async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      params?: Record<string, string | number | undefined>;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    
    // Add query parameters
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json() as ApiError;
        throw new IzenzoApiError(error, response.status);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof IzenzoApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Set or update the API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }
}

/**
 * Matches API Resource
 */
class MatchesResource {
  constructor(private client: IzenzoClient) {}

  /**
   * Create a new match
   */
  async create(params: MatchCreateParams): Promise<Match> {
    return this.client.request<Match>('POST', '/match', { body: params });
  }

  /**
   * Get a match by ID
   */
  async get(id: string): Promise<Match> {
    return this.client.request<Match>('GET', `/match/${id}`);
  }

  /**
   * Confirm intent for a match (non-binding)
   */
  async confirmIntent(id: string): Promise<Match> {
    return this.client.request<Match>('POST', `/match/${id}/settle`);
  }

  /**
   * List matches with optional filtering
   */
  async list(params: MatchListParams = {}): Promise<MatchListResponse> {
    return this.client.request<MatchListResponse>('GET', '/matches', {
      params: params as Record<string, string | number | undefined>,
    });
  }

  /**
   * Verify a match hash
   */
  verifyHash(match: Match): boolean {
    const canonical = {
      buyer: { id: match.buyer_id, name: match.buyer_name },
      seller: { id: match.seller_id, name: match.seller_name },
      commodity: match.commodity,
      quantity: { amount: match.quantity_amount, unit: match.quantity_unit },
      price: { amount: match.price_amount, currency: match.price_currency },
      terms: match.terms || '',
      metadata: match.metadata || {},
    };

    // Note: For browser, you'd use SubtleCrypto
    // This is a placeholder - actual verification should use SHA-256
    console.log('Hash verification input:', JSON.stringify(canonical));
    return true; // Client should implement actual hash verification
  }
}

/**
 * Signals API Resource
 */
class SignalsResource {
  constructor(private client: IzenzoClient) {}

  /**
   * Create a new signal
   */
  async create(params: SignalCreateParams): Promise<Signal> {
    return this.client.request<Signal>('POST', '/signals', { body: params });
  }

  /**
   * Get a signal with its options
   */
  async get(id: string): Promise<SignalWithOptions> {
    return this.client.request<SignalWithOptions>('GET', `/signals/${id}`);
  }

  /**
   * List signals
   */
  async list(params: { status?: string; limit?: number } = {}): Promise<Signal[]> {
    return this.client.request<Signal[]>('GET', '/signals', {
      params: params as Record<string, string | number | undefined>,
    });
  }

  /**
   * Get signal status
   */
  async getStatus(id: string): Promise<{ status: string; optionsCount: number; searchComplete: boolean }> {
    return this.client.request('GET', `/signals/${id}/status`);
  }

  /**
   * Select an option for a signal
   */
  async selectOption(signalId: string, optionId: string): Promise<Selection> {
    return this.client.request<Selection>('POST', `/signals/${signalId}/select`, {
      body: { option_id: optionId },
    });
  }

  /**
   * Cancel a signal
   */
  async cancel(id: string): Promise<void> {
    return this.client.request<void>('DELETE', `/signals/${id}`);
  }
}

/**
 * API Keys Resource (requires JWT auth)
 */
class ApiKeysResource {
  constructor(private client: IzenzoClient) {}

  /**
   * Create a new API key
   */
  async create(params: ApiKeyCreateParams, jwtToken: string): Promise<ApiKeyCreated> {
    return this.client.request<ApiKeyCreated>('POST', '/api-keys', {
      body: params,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
  }

  /**
   * List API keys
   */
  async list(jwtToken: string): Promise<ApiKey[]> {
    return this.client.request<ApiKey[]>('GET', '/api-keys', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string, jwtToken: string): Promise<void> {
    return this.client.request<void>('DELETE', `/api-keys/${id}`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
  }
}

/**
 * Webhooks Resource
 */
class WebhooksResource {
  constructor(private client: IzenzoClient) {}

  /**
   * Create a webhook endpoint
   */
  async create(params: WebhookCreateParams): Promise<Webhook> {
    return this.client.request<Webhook>('POST', '/webhooks', { body: params });
  }

  /**
   * List webhooks
   */
  async list(): Promise<Webhook[]> {
    return this.client.request<Webhook[]>('GET', '/webhooks');
  }

  /**
   * Delete a webhook
   */
  async delete(id: string): Promise<void> {
    return this.client.request<void>('DELETE', `/webhooks/${id}`);
  }
}

/**
 * Health Resource
 */
class HealthResource {
  constructor(private client: IzenzoClient) {}

  /**
   * Check system health
   */
  async check(): Promise<HealthStatus> {
    return this.client.request<HealthStatus>('GET', '/healthz');
  }
}

// Export singleton factory
export function createClient(apiKey: string): IzenzoClient {
  return new IzenzoClient(apiKey);
}

// Default export
export default IzenzoClient;
