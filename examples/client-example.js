/**
 * SignalRank API Client Example
 * 
 * This example demonstrates the complete flow:
 * 1. Create an API key
 * 2. Register data sources
 * 3. Grant consents
 * 4. Create a signal
 * 5. Get matched options
 * 6. Select an option
 */

const BASE_URL = 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1';

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
