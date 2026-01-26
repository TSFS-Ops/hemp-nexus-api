/**
 * Security Constants - Centralized definitions for sensitive fields and patterns
 * These lists are used by redaction, logging, and validation utilities
 */

// Fields that contain PII and must be redacted for non-admin users
export const PII_FIELDS = [
  'email',
  'email_address',
  'phone',
  'phone_number',
  'mobile',
  'contact_email',
  'contact_phone',
  'full_name',
  'legal_name',
  'first_name',
  'last_name',
  'address',
  'street_address',
  'postal_address',
  'billing_address',
  'shipping_address',
  'id_number',
  'passport_number',
  'tax_number',
  'vat_number',
  'social_security',
  'date_of_birth',
  'dob',
] as const;

// Fields that contain secrets and must NEVER be exposed
export const SECRET_FIELDS = [
  'key_hash',
  'key_history',
  'secret_hash',
  'password',
  'password_hash',
  'api_key',
  'api_secret',
  'secret_key',
  'private_key',
  'access_token',
  'refresh_token',
  'bearer_token',
  'webhook_secret',
  'encryption_key',
  'pepper',
  'salt',
] as const;

// Fields that contain trade secrets / commercial information
export const TRADE_SECRET_FIELDS = [
  'price_amount',
  'price_currency',
  'commercial_terms',
  'pricing_terms',
  'margin',
  'cost',
  'markup',
  'discount',
  'commission',
  'internal_notes',
  'internal_reasoning',
  'negotiation_history',
  'bid_amount',
  'ask_amount',
] as const;

// Fields that can be used for enumeration attacks
export const ENUMERATION_FIELDS = [
  'user_id',
  'org_id',
  'internal_id',
  'sequence_number',
  'row_number',
] as const;

// Regex patterns for detecting sensitive data in strings
export const SENSITIVE_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b(?:\+?[0-9]{1,4}[-.\s]?)?(?:\(?[0-9]{2,4}\)?[-.\s]?)?[0-9]{3,4}[-.\s]?[0-9]{3,4}\b/g,
  apiKey: /\b(sk_|pk_|api_|key_)[a-zA-Z0-9]{16,64}\b/g,
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  bearerToken: /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi,
  authHeader: /authorization:\s*[^\n\r]+/gi,
} as const;

// Headers that must be scrubbed from logs
export const SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'x-access-token',
] as const;

// Fields that must NEVER be queried directly from frontend
// All lookups for these fields must go through Edge Functions with server-side auth checks
export const BACKEND_ONLY_FIELDS = [
  'profiles.email',
  'profiles.full_name',
  'profiles.phone',
  'api_keys.key_hash',
  'api_keys.key_history',
  'webhook_endpoints.secret_hash',
] as const;

// Tables that contain PII and require Edge Function access for cross-user lookups
export const PII_TABLES = [
  'profiles',
  'data_source_registrations',
] as const;

// Viewer roles for evidence packs
export type ViewerRole = 'demo' | 'client' | 'admin' | 'auditor';

// Evidence sensitivity levels
export type SensitivityLevel = 'public' | 'client' | 'admin';
