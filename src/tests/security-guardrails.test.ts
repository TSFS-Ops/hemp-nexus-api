/**
 * Security Guardrails Runtime Tests
 * 
 * These tests run at runtime to verify security guardrails are working.
 * Can be called from an edge function or during app initialization.
 * 
 * Run these as part of a health check to detect security regressions.
 */

import {
  deepRedact,
  redactUser,
  redactOrg,
  redactMatch,
  redactApiKey,
  formatApiKeyForDisplay,
  assertNoSecrets,
  scrubSensitivePatterns,
  generateEvidencePack,
} from '../lib/security';

// Test data
const mockUser = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  email: 'test@example.com',
  phone: '+1-555-123-4567',
  full_name: 'John Doe',
  org_id: '123e4567-e89b-12d3-a456-426614174001',
  password_hash: 'should_never_be_exposed',
  api_key: 'sk_live_abc123def456',
};

const mockApiKey = {
  id: '123e4567-e89b-12d3-a456-426614174002',
  name: 'Production Key',
  key_hash: 'hashed_value_should_never_be_exposed',
  key_history: [{ hash: 'old_hash' }],
  scopes: ['read', 'write'],
  status: 'active',
  created_at: '2024-01-01T00:00:00Z',
};

const mockMatch = {
  id: '123e4567-e89b-12d3-a456-426614174003',
  org_id: '123e4567-e89b-12d3-a456-426614174001',
  commodity: 'Wheat',
  quantity_amount: 1000,
  quantity_unit: 'MT',
  price_amount: 50000,
  price_currency: 'USD',
  buyer_name: 'Buyer Corp',
  buyer_id: 'buyer-123',
  seller_name: 'Seller Ltd',
  seller_id: 'seller-456',
  hash: 'match_hash_abc',
  status: 'matched',
  created_at: '2024-01-01T00:00:00Z',
};

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

/**
 * Run all security guardrail tests
 */
export function runSecurityTests(): { 
  passed: number; 
  failed: number; 
  results: TestResult[];
  allPassed: boolean;
} {
  const results: TestResult[] = [];

  const runTest = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, passed: true });
    } catch (e) {
      results.push({ 
        name, 
        passed: false, 
        error: e instanceof Error ? e.message : String(e) 
      });
    }
  };

  // PII Redaction Tests
  runTest('redactUser removes email for client', () => {
    const result = redactUser(mockUser, 'client');
    if (result.email === mockUser.email) {
      throw new Error('Email not redacted for client');
    }
  });

  runTest('redactUser removes phone for client', () => {
    const result = redactUser(mockUser, 'client');
    if (result.phone === mockUser.phone) {
      throw new Error('Phone not redacted for client');
    }
  });

  runTest('redactUser ALWAYS removes password_hash even for admin', () => {
    const result = redactUser(mockUser, 'admin');
    if (result.password_hash !== '[REDACTED]') {
      throw new Error('Password hash not redacted for admin');
    }
  });

  runTest('admin can see email', () => {
    const result = redactUser(mockUser, 'admin');
    if (result.email !== mockUser.email) {
      throw new Error('Admin should see email');
    }
  });

  runTest('demo mode returns synthetic org', () => {
    const result = redactOrg({ name: 'Real Corp', id: 'real-id' }, 'demo');
    if (result.name !== 'Demo Organization') {
      throw new Error('Demo org name not synthetic');
    }
  });

  // Secret Field Protection Tests
  runTest('API key hash NEVER exposed', () => {
    const result = redactApiKey(mockApiKey);
    if ('key_hash' in result || Object.values(result).includes(mockApiKey.key_hash)) {
      throw new Error('key_hash exposed in redacted API key');
    }
  });

  runTest('API key history NEVER exposed', () => {
    const result = redactApiKey(mockApiKey);
    if ('key_history' in result) {
      throw new Error('key_history exposed in redacted API key');
    }
  });

  runTest('deepRedact removes all secret fields', () => {
    const dataWithSecrets = {
      name: 'safe',
      key_hash: 'secret_hash',
      password: 'secret_pass',
      api_key: 'secret_key',
    };
    const result = deepRedact(dataWithSecrets);
    if (result.key_hash !== '[REDACTED]' || result.password !== '[REDACTED]') {
      throw new Error('Secret fields not redacted');
    }
  });

  runTest('assertNoSecrets throws on secret fields', () => {
    try {
      assertNoSecrets({ name: 'test', key_hash: 'secret' }, 'test');
      throw new Error('Should have thrown');
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('SECURITY VIOLATION')) {
        throw new Error('Did not throw expected security violation');
      }
    }
  });

  runTest('assertNoSecrets passes on clean data', () => {
    assertNoSecrets({ name: 'test', status: 'active' }, 'test');
  });

  // API Key Display Tests
  runTest('formatApiKeyForDisplay shows only prefix and suffix', () => {
    const key = 'sk_live_abc123def456ghi789';
    const display = formatApiKeyForDisplay(key);
    if (!display.includes('…') || display.length >= key.length) {
      throw new Error('API key not properly truncated');
    }
  });

  runTest('formatApiKeyForDisplay handles short keys', () => {
    if (formatApiKeyForDisplay('short') !== '****') {
      throw new Error('Short key not handled');
    }
  });

  runTest('formatApiKeyForDisplay handles null', () => {
    if (formatApiKeyForDisplay(null) !== '****') {
      throw new Error('Null key not handled');
    }
  });

  // Match Redaction Tests
  runTest('demo match is synthetic', () => {
    const result = redactMatch(mockMatch, 'demo');
    if (result.id !== '00000000-0000-0000-0000-000000000000') {
      throw new Error('Demo match not synthetic');
    }
  });

  runTest('client cannot see other org trade secrets', () => {
    const result = redactMatch(mockMatch, 'client', 'different-org-id');
    if (result.price_amount !== '[REDACTED]') {
      throw new Error('Trade secrets visible to other org');
    }
  });

  // Evidence Pack Tests
  runTest('demo evidence is synthetic', () => {
    const evidence = generateEvidencePack(mockMatch, [], [], 'demo');
    if (evidence.match_id !== '00000000-0000-0000-0000-000000000000') {
      throw new Error('Demo evidence not synthetic');
    }
  });

  runTest('evidence pack has correct sensitivity level', () => {
    const clientEvidence = generateEvidencePack(mockMatch, [], [], 'client', mockMatch.org_id);
    const adminEvidence = generateEvidencePack(mockMatch, [], [], 'admin');
    if (clientEvidence.sensitivity_level !== 'client' || adminEvidence.sensitivity_level !== 'admin') {
      throw new Error('Evidence sensitivity level incorrect');
    }
  });

  // Pattern Scrubbing Tests
  runTest('scrubs email addresses', () => {
    const result = scrubSensitivePatterns('Contact john@example.com for info');
    if (result.includes('john@example.com')) {
      throw new Error('Email not scrubbed');
    }
  });

  runTest('scrubs API keys', () => {
    const result = scrubSensitivePatterns('Key: sk_live_abc123def456ghi789');
    if (result.includes('sk_live_abc123def456ghi789')) {
      throw new Error('API key not scrubbed');
    }
  });

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed,
    failed,
    results,
    allPassed: failed === 0,
  };
}

/**
 * Validate a response object doesn't contain sensitive data
 * Call this before returning any API response
 */
export function validateResponseSecurity(response: unknown, context: string = 'response'): void {
  assertNoSecrets(response, context);
}
