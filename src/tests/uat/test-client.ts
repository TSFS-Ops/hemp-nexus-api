/**
 * Test-specific Supabase client for UAT journeys.
 * 
 * Uses in-memory storage instead of localStorage (unavailable in Node/vitest).
 * MUST NOT be used in production code.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// In-memory auth storage for test environment
const memoryStorage: Record<string, string> = {};
const inMemoryStorage = {
  getItem: (key: string) => memoryStorage[key] ?? null,
  setItem: (key: string, value: string) => { memoryStorage[key] = value; },
  removeItem: (key: string) => { delete memoryStorage[key]; },
};

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: inMemoryStorage,
    persistSession: true,
    autoRefreshToken: false,
  },
});

export const BASE_URL = SUPABASE_URL;

/**
 * Provisions a confirmed test user server-side (bypasses GoTrue email rate limit),
 * signs them in, and returns the session + org_id.
 *
 * Uses the `provision-test-user` edge function which calls
 * `auth.admin.createUser({ email_confirm: true })` - no confirmation email is
 * ever sent, so the per-hour signup quota is not consumed.
 *
 * Idempotent: if the email already exists, the password is reset and reused.
 */
export async function signUpTestUser(
  client: any,
  email: string,
  password: string
): Promise<{ userId: string; accessToken: string; orgId: string }> {
  // Step 1: Provision (or reuse) a confirmed user via service-role edge function
  const provisionRes = await fetch(`${SUPABASE_URL}/functions/v1/provision-test-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "apikey": SUPABASE_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!provisionRes.ok) {
    const body = await provisionRes.text();
    throw new Error(`Failed to provision test user: ${provisionRes.status} ${body}`);
  }
  const { user_id: userId } = await provisionRes.json();
  if (!userId) throw new Error("provision-test-user returned no user_id");

  // Step 2: Sign in (already confirmed)
  const { data: signInData, error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  if (!signInData.session) throw new Error("Sign-in returned no session");
  const accessToken = signInData.session.access_token;

  // Step 4: Get org_id
  const { data: profile } = await client
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .single();

  return {
    userId,
    accessToken,
    orgId: (profile as any)?.org_id ?? "",
  };
}
