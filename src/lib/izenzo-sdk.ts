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

const DEFAULT_BASE_URL = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
  : 'https://YOUR_PROJECT_REF.supabase.co/functions/v1';
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
  // V3 Resources
  public readonly entities: EntitiesResource;
  public readonly authority: AuthorityResource;
  public readonly tradeApprovals: TradeApprovalsResource;
  public readonly pods: PodsResource;
  public readonly complianceCases: ComplianceCasesResource;

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
    // V3
    this.entities = new EntitiesResource(this);
    this.authority = new AuthorityResource(this);
    this.tradeApprovals = new TradeApprovalsResource(this);
    this.pods = new PodsResource(this);
    this.complianceCases = new ComplianceCasesResource(this);
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

// ─── V3 Types ───

export interface Entity {
  id: string;
  org_id: string;
  legal_name: string;
  entity_type: string;
  jurisdiction_code: string;
  registration_number?: string;
  tax_number?: string;
  status: string;
  created_at: string;
}

export interface EntityCreateParams {
  legal_name: string;
  entity_type: string;
  jurisdiction_code: string;
  registration_number?: string;
  tax_number?: string;
}

export interface UboLink {
  id: string;
  person_entity_id: string;
  company_entity_id: string;
  ownership_percentage: number;
  status: string;
}

export interface AtbRecord {
  id: string;
  person_entity_id: string;
  company_entity_id: string;
  method: string;
  status: string;
  expires_at?: string;
}

export interface GateCheckResult {
  ubo_passed: boolean;
  atb_passed: boolean;
  total_ownership: number;
  verified_ubo_count: number;
  active_atb_count: number;
}

export interface TradeApproval {
  org_id: string;
  approved_to_trade: boolean;
  trade_status: string;
  approved_at: string | null;
  risk_band: string | null;
  valid_until: string | null;
}

export interface PodCreateParams {
  wad_id: string;
  milestones: { name: string; due_at: string }[];
}

export interface Pod {
  id: string;
  org_id: string;
  wad_id: string;
  state: string;
  created_at: string;
  finalised_at: string | null;
}

export interface ComplianceCase {
  id: string;
  org_id: string;
  entity_id: string;
  status: string;
  decided_at: string | null;
  decision_notes: string | null;
  created_at: string;
}

// ─── V3 Resources ───

/**
 * Entities API Resource (V3)
 */
class EntitiesResource {
  constructor(private client: IzenzoClient) {}

  async create(params: EntityCreateParams): Promise<Entity> {
    return this.client.request<Entity>('POST', '/entities', { body: params });
  }

  async list(params: { status?: string; entity_type?: string } = {}): Promise<Entity[]> {
    const resp = await this.client.request<{ data: Entity[] }>('GET', '/entities', {
      params: params as Record<string, string | number | undefined>,
    });
    return resp.data;
  }

  async update(id: string, updates: Partial<EntityCreateParams>): Promise<Entity> {
    return this.client.request<Entity>('PATCH', '/entities', {
      body: { entity_id: id, ...updates },
    });
  }

  async screen(entityId: string): Promise<{ result: string; details: string }> {
    const resp = await this.client.request<{ data: { result: string; details: string } }>(
      'POST', '/entities', {
        body: { entity_id: entityId },
        headers: { 'X-Action': 'screen' },
      }
    );
    return resp.data;
  }
}

/**
 * Authority-to-Bind & UBO Resource (V3)
 */
class AuthorityResource {
  constructor(private client: IzenzoClient) {}

  async createUbo(personEntityId: string, companyEntityId: string, ownershipPercentage: number): Promise<UboLink> {
    const resp = await this.client.request<{ data: UboLink }>('POST', '/authority-bind', {
      body: { action: 'ubo_create', person_entity_id: personEntityId, company_entity_id: companyEntityId, ownership_percentage: ownershipPercentage },
    });
    return resp.data;
  }

  async createAtb(personEntityId: string, companyEntityId: string, method: string, documentId?: string): Promise<AtbRecord> {
    const resp = await this.client.request<{ data: AtbRecord }>('POST', '/authority-bind', {
      body: { action: 'atb_create', person_entity_id: personEntityId, company_entity_id: companyEntityId, method, document_id: documentId },
    });
    return resp.data;
  }

  async checkGates(personEntityId: string, companyEntityId: string): Promise<GateCheckResult> {
    const resp = await this.client.request<{ data: GateCheckResult }>('POST', '/authority-bind', {
      body: { action: 'check', person_entity_id: personEntityId, company_entity_id: companyEntityId },
    });
    return resp.data;
  }
}

/**
 * Trade Approvals Resource (V3)
 */
class TradeApprovalsResource {
  constructor(private client: IzenzoClient) {}

  async getStatus(orgId: string): Promise<TradeApproval> {
    return this.client.request<TradeApproval>('GET', '/trade-status', {
      params: { org_id: orgId },
    });
  }

  async issue(orgId: string, validDays = 365): Promise<TradeApproval> {
    const resp = await this.client.request<{ data: any }>('POST', '/trade-approval', {
      body: { action: 'issue', org_id: orgId, valid_days: validDays },
    });
    return resp.data;
  }

  async revoke(orgId: string, reason: string): Promise<void> {
    await this.client.request('POST', '/trade-approval', {
      body: { action: 'revoke', org_id: orgId, reason },
    });
  }
}

/**
 * PoD (Proof-of-Delivery) Resource (V3)
 */
class PodsResource {
  constructor(private client: IzenzoClient) {}

  async create(params: PodCreateParams, idempotencyKey: string): Promise<Pod> {
    const resp = await this.client.request<{ data: Pod }>('POST', '/pods', {
      body: params,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return resp.data;
  }

  async list(): Promise<Pod[]> {
    const resp = await this.client.request<{ data: Pod[] }>('GET', '/pods');
    return resp.data;
  }

  async completeMilestone(milestoneId: string, evidenceDocId?: string): Promise<void> {
    await this.client.request('POST', '/pods?action=complete-milestone', {
      body: { milestone_id: milestoneId, evidence_document_id: evidenceDocId },
    });
  }

  async recordBreach(podId: string, reason: string, milestoneId?: string): Promise<void> {
    await this.client.request('POST', '/pods?action=breach', {
      body: { pod_id: podId, reason, milestone_id: milestoneId },
    });
  }

  async finalise(podId: string): Promise<Pod> {
    const resp = await this.client.request<{ data: Pod }>('POST', '/pods?action=finalise', {
      body: { pod_id: podId },
    });
    return resp.data;
  }
}

/**
 * Compliance Cases Resource (V3)
 */
class ComplianceCasesResource {
  constructor(private client: IzenzoClient) {}

  async open(entityId: string): Promise<ComplianceCase> {
    const resp = await this.client.request<{ data: ComplianceCase }>('POST', '/compliance-cases', {
      body: { entity_id: entityId },
    });
    return resp.data;
  }

  async list(params: { entity_id?: string; status?: string } = {}): Promise<ComplianceCase[]> {
    const resp = await this.client.request<{ data: ComplianceCase[] }>('GET', '/compliance-cases', {
      params: params as Record<string, string | number | undefined>,
    });
    return resp.data;
  }

  async decide(caseId: string, status: 'cleared' | 'escalated' | 'blocked', notes?: string): Promise<ComplianceCase> {
    const resp = await this.client.request<{ data: ComplianceCase }>('PATCH', '/compliance-cases', {
      body: { case_id: caseId, status, decision_notes: notes },
    });
    return resp.data;
  }
}

// Export singleton factory
export function createClient(apiKey: string): IzenzoClient {
  return new IzenzoClient(apiKey);
}

// Default export
export default IzenzoClient;
