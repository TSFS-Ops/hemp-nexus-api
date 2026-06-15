/**
 * UI-004 - Single source of truth for credit/balance query invalidation.
 *
 * Multiple components display the user's (or admin view of) credit balance
 * under different React Query keys. Invalidating only `["token-balance"]`
 * leaves stale values on Billing, the confirmation dialogs, the progression
 * card, the compiler, and the admin token panel. This helper invalidates
 * every known balance prefix in one call so callers never have to remember
 * the full list (and so adding a new surface only requires updating this
 * file).
 *
 * Keep this list aligned with every `useQuery({ queryKey: [...] })` that
 * reads a credit/token balance. Search the codebase for "token-balance"
 * before adding a new prefix.
 */

import type { QueryClient } from "@tanstack/react-query";

/** Every query-key prefix that represents a credit / token balance read. */
export const CREDIT_BALANCE_QUERY_KEYS: ReadonlyArray<readonly [string]> = [
  ["token-balance"],
  ["token-balance-confirm"],
  ["token-balance-confirm-single"],
  ["token-balance-progression"],
  ["token-balance-compiler"],
  ["admin-token-balances"],
] as const;

/**
 * Invalidate every credit-balance query the app knows about.
 * Safe to call from any mutation success path; React Query coalesces
 * duplicate invalidations within the same tick.
 */
export function invalidateAllCreditBalanceQueries(queryClient: QueryClient): void {
  for (const queryKey of CREDIT_BALANCE_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}
