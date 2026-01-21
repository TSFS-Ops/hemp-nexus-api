/**
 * Security Module - Centralized security utilities
 * 
 * This module provides all security-related functions for:
 * - PII and secret redaction
 * - Safe logging
 * - Role-based evidence generation
 * - API key handling
 * 
 * USAGE:
 * import { redactUser, safeLogger, generateEvidencePack } from '@/lib/security';
 */

// Re-export constants
export * from './constants';

// Re-export redaction utilities
export {
  deepRedact,
  scrubSensitivePatterns,
  redactUser,
  redactOrg,
  redactMatch,
  redactEvidencePack,
  redactApiKey,
  formatApiKeyForDisplay,
  assertNoSecrets,
} from './redaction';

// Re-export safe logger
export { safeLogger, createSafeLogger } from './safe-logger';

// Re-export evidence generator
export {
  generateEvidencePack,
  canAccessEvidence,
  type EvidencePack,
} from './evidence-generator';
