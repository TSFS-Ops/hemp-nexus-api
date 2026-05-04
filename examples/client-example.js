/**
 * Trade.Izenzo API - Node.js/JavaScript Client Example
 * 
 * This is a lightweight SDK wrapper for the Trade.Izenzo Compliance Matching API.
 * No installation required - just copy this code into your project.
 * 
 * Usage:
 *   const client = new TradeIzenzoClient('your-api-key-here');
 *   const signal = await client.createSignal({ product: 'Paracetamol', quantity: 1000, unit: 'kg' });
 */

class TradeIzenzoClient {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl || 'https://api.trade.izenzo.co.za/functions/v1';
    this.timeout = options.timeout || 30000;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || `API Error: ${response.status}`);
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  // Signal Management
  async createSignal(data) {
    return this.request('/signals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getSignal(signalId) {
    return this.request(`/signals/${signalId}`, {
      method: 'GET',
    });
  }

  async listSignals(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/signals${query ? `?${query}` : ''}`, {
      method: 'GET',
    });
  }

  async selectOption(signalId, optionId) {
    return this.request(`/signals/${signalId}/select`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    });
  }

  // Match Management
  async createMatch(data) {
    return this.request('/match', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMatch(matchId) {
    return this.request(`/match/${matchId}`, {
      method: 'GET',
    });
  }

  async settleMatch(matchId) {
    return this.request(`/match/${matchId}/settle`, {
      method: 'POST',
    });
  }

  async verifyMatchHash(matchId, expectedHash) {
    const match = await this.getMatch(matchId);
    return match.hash === expectedHash;
  }

  // Audit Logs
  async getAuditLogs(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/audit-logs${query ? `?${query}` : ''}`, {
      method: 'GET',
    });
  }

  // Webhooks
  async createWebhook(data) {
    return this.request('/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listWebhooks() {
    return this.request('/webhooks', {
      method: 'GET',
    });
  }

  async deleteWebhook(webhookId) {
    return this.request(`/webhooks/${webhookId}`, {
      method: 'DELETE',
    });
  }

  // Verification
  async verifySAHPRA(licenceNumber) {
    return this.request('/sahpra-verification', {
      method: 'POST',
      body: JSON.stringify({ licenceNumber }),
    });
  }
}

// Example usage
async function example() {
  const client = new TradeIzenzoClient('tiz_sandbox_your_key_here');

  try {
    // Create a signal
    const signal = await client.createSignal({
      product: 'Paracetamol 500mg tablets',
      quantity: 10000,
      unit: 'units',
      location: 'Johannesburg',
      deliveryWindow: {
        start: '2025-01-01',
        end: '2025-01-31',
      },
      budget: 5000,
      currency: 'ZAR',
    });

    console.log('Signal created:', signal.id);

    // Create a match
    const match = await client.createMatch({
      buyerId: 'buyer-123',
      buyerName: 'Pharmacy Chain SA',
      sellerId: 'seller-456',
      sellerName: 'MedSupply Ltd',
      commodity: 'Paracetamol 500mg',
      quantityAmount: 10000,
      quantityUnit: 'units',
      priceAmount: 4500,
      priceCurrency: 'ZAR',
      terms: 'Net 30 days, FOB Johannesburg',
    });

    console.log('Match created:', match.id);
    console.log('Match hash:', match.hash);

    // Settle the match
    const settled = await client.settleMatch(match.id);
    console.log('Match settled at:', settled.settled_at);

    // Verify hash hasn't changed
    const isValid = await client.verifyMatchHash(match.id, match.hash);
    console.log('Hash valid:', isValid);

    // Get audit logs
    const logs = await client.getAuditLogs({
      entity_type: 'match',
      entity_id: match.id,
    });
    console.log('Audit logs:', logs.length);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TradeIzenzoClient };
}

// Run example if executed directly
if (require.main === module) {
  example();
}


const BASE_URL = 'https://api.trade.izenzo.co.za/functions/v1';

// Step 1: Health Check (public endpoint)
async function healthCheck() {
  const response = await fetch(`${BASE_URL}/healthz`);
  const data = await response.json();
  console.log('Health check:', data);
  return data.ok;
}

// Step 2: Create API Key (requires JWT token from authentication)
async function createApiKey(jwtToken) {
  const response = await fetch(`${BASE_URL}/api-keys`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'My API Key',
      scopes: ['signals:write', 'signals:read', 'data-sources:write', 'consents:write']
    })
  });
  
  const data = await response.json();
  console.log('API Key created:', data);
  // IMPORTANT: Save this key! It's only shown once
  return data.key; // starts with sk_
}

// Step 3: Register a Data Source
async function registerDataSource(apiKey) {
  const response = await fetch(`${BASE_URL}/data-sources`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Hemp Marketplace',
      type: 'marketplace',
      config: {
        api_url: 'https://example-marketplace.com/api',
        // Add other config as needed
      }
    })
  });
  
  const data = await response.json();
  console.log('Data source registered:', data);
  return data.id;
}

// Step 4: Grant Consent to Query the Data Source
async function grantConsent(apiKey, dataSourceId) {
  const response = await fetch(`${BASE_URL}/consents`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data_source_id: dataSourceId,
      scope: {
        read_inventory: true,
        read_offers: true
      },
      expires_at: '2026-12-31T23:59:59Z' // Optional
    })
  });
  
  const data = await response.json();
  console.log('Consent granted:', data);
  return data.id;
}

// Step 5: Create a Buyer Signal
async function createBuyerSignal(apiKey) {
  const response = await fetch(`${BASE_URL}/signals`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'buyer',
      content: {
        what: 'Hemp fibre',
        how_much: 10000,
        unit: 'kg',
        where: 'Rotterdam',
        when: '2025-11-01',
        price_budget: 12000,
        quality_requirements: {
          grade: 'industrial',
          thc_content: '<0.3%'
        }
      },
      expires_at: '2025-11-15T00:00:00Z' // Optional
    })
  });
  
  const data = await response.json();
  console.log('Signal created:', data);
  return data.id;
}

// Step 6: Get Matched Options for the Signal
async function getMatchedOptions(apiKey, signalId) {
  const response = await fetch(`${BASE_URL}/signals/${signalId}`, {
    headers: {
      'X-API-Key': apiKey,
    }
  });
  
  const data = await response.json();
  console.log('Matched options:', data);
  return data;
}

// Step 7: Select an Option
async function selectOption(apiKey, signalId, optionId) {
  const response = await fetch(`${BASE_URL}/signals/${signalId}/select`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      option_id: optionId
    })
  });
  
  const data = await response.json();
  console.log('Option selected:', data);
  // data contains: selection_id, handoff_token, handoff_url
  return data;
}

// Complete Flow Example
async function completeFlow() {
  try {
    // 1. Health check
    await healthCheck();
    
    // 2. You need to authenticate first to get a JWT token
    // (This requires implementing authentication in your app)
    const jwtToken = 'YOUR_JWT_TOKEN_HERE';
    
    // 3. Create API key (only do this once)
    const apiKey = await createApiKey(jwtToken);
    
    // 4. Register data sources (only do this once per source)
    const dataSourceId = await registerDataSource(apiKey);
    
    // 5. Grant consent (only do this once per source)
    await grantConsent(apiKey, dataSourceId);
    
    // 6. Create a signal (do this whenever you need to find matches)
    const signalId = await createBuyerSignal(apiKey);
    
    // 7. Wait a moment for the search to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 8. Get matched options
    const result = await getMatchedOptions(apiKey, signalId);
    
    // 9. Select the best option (if any options returned)
    if (result.options && result.options.length > 0) {
      const bestOption = result.options[0]; // Assuming sorted by score
      const handoff = await selectOption(apiKey, signalId, bestOption.id);
      
      console.log('\n=== Handoff Details ===');
      console.log('Token:', handoff.handoff_token);
      console.log('URL:', handoff.handoff_url);
      console.log('Use this URL to complete the transaction in the source system');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
// completeFlow();

// Export for use in other modules
export {
  healthCheck,
  createApiKey,
  registerDataSource,
  grantConsent,
  createBuyerSignal,
  getMatchedOptions,
  selectOption,
  completeFlow
};
