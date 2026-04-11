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
 * Signs up a test user and auto-confirms their email via the confirm-test-user edge function.
 * Returns the sign-in session data (userId, accessToken, orgId).
 */
export async function signUpTestUser(
  client: ReturnType<typeof createClient>,
  email: string,
  password: string
): Promise<{ userId: string; accessToken: string; orgId: string }> {
  // Step 1: Sign up
  const { data: signupData, error: signupErr } = await client.auth.signUp({ email, password });
  if (signupErr) throw signupErr;
  if (!signupData.user) throw new Error("Signup returned no user");
  const userId = signupData.user.id;

  // Step 2: Confirm email via edge function
  const confirmRes = await fetch(`${SUPABASE_URL}/functions/v1/confirm-test-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!confirmRes.ok) {
    const body = await confirmRes.text();
    throw new Error(`Failed to confirm test user: ${confirmRes.status} ${body}`);
  }

  // Step 3: Sign in (now confirmed)
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
    orgId: profile?.org_id ?? "",
  };
}
