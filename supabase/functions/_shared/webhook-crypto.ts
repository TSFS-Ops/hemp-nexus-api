/**
 * Webhook secret encryption utilities using AES-256-GCM
 * 
 * This module provides secure storage and retrieval of webhook secrets.
 * Secrets are encrypted before storage and decrypted when needed for HMAC signing.
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96 bits for GCM

/**
 * Get the encryption key from environment
 */
function getEncryptionKey(): string {
  const key = Deno.env.get("WEBHOOK_ENCRYPTION_KEY");
  if (!key) {
    throw new Error("WEBHOOK_ENCRYPTION_KEY not configured");
  }
  return key;
}

/**
 * Import the encryption key for use with Web Crypto API
 */
async function importKey(keyBase64: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
  
  return await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: ALGORITHM },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a webhook secret for secure storage
 * Returns: base64 string in format "iv:ciphertext"
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await importKey(getEncryptionKey());
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext)
  );
  
  // Combine IV and ciphertext, encode as base64
  const ivBase64 = btoa(String.fromCharCode(...iv));
  const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  
  return `${ivBase64}:${ciphertextBase64}`;
}

/**
 * Decrypt a stored webhook secret
 * Expects: base64 string in format "iv:ciphertext"
 */
export async function decryptSecret(encrypted: string): Promise<string> {
  const key = await importKey(getEncryptionKey());
  
  const [ivBase64, ciphertextBase64] = encrypted.split(":");
  if (!ivBase64 || !ciphertextBase64) {
    throw new Error("Invalid encrypted secret format");
  }
  
  const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
  
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );
  
  return new TextDecoder().decode(plaintext);
}

/**
 * Check if a stored value is encrypted (new format) or hashed (legacy)
 * Encrypted format: "base64:base64"
 * Hash format: 64 hex characters
 */
export function isEncryptedFormat(value: string): boolean {
  // Encrypted format contains a colon separator
  if (value.includes(":")) {
    const parts = value.split(":");
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
  }
  return false;
}
