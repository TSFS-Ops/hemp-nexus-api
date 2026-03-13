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
