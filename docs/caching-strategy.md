# Caching Strategy — Compliance Matching Platform

## Architecture

No external cache layer (Redis) is available in Lovable Cloud. Caching is implemented at two levels:

### 1. Client-side (React Query)
All data-fetching uses `@tanstack/react-query` with tuned `staleTime`:
- **Token balance**: 5s stale (frequent reads, infrequent writes)
- **Matches list**: 30s stale with `placeholderData` for instant page transitions
- **Evidence chain**: 5min stale (immutable after settlement)
- **Console overview stats**: 60s stale

### 2. Edge-level HTTP Cache Headers
Applied via `_shared/cache.ts` utility:

| Strategy | Header | Use Case |
|----------|--------|----------|
| `static` | `public, max-age=3600, stale-while-revalidate=86400` | Evidence packs (immutable after generation) |
| `short` | `public, max-age=30, stale-while-revalidate=60` | Health checks, public metadata |
| `private-short` | `private, max-age=10, stale-while-revalidate=30` | Audit logs, user-specific lists |
| `no-cache` | `no-store, no-cache, must-revalidate` | Mutations, real-time data |

### 3. In-memory Edge Cache
`cached()` function in `_shared/cache.ts` provides per-isolate memoization:
- 500 entry cap with LRU eviction
- TTL-based expiration
- Useful for repeated identical queries within the same isolate under high concurrency

## Invalidation Rules
- **On mutation**: React Query invalidates affected keys immediately
- **On settlement**: Evidence pack cache is naturally immutable
- **On token purchase**: `token-balance` and `credit-balance-billing` keys are invalidated
- **Edge cache**: TTL-based only (no cross-isolate invalidation possible)

## What Breaks at 10,000 Concurrent Users

1. **Database connection pool** — Supabase has a connection limit. The `count: "exact"` queries are the most expensive. Mitigation: `head: true` for count-only queries.
2. **Edge function cold starts** — First request per isolate is slower. Mitigation: `/healthz` endpoint for warm-up.
3. **Token balance hot row** — `atomic_token_burn` uses `UPDATE...WHERE` which serializes under high write contention for the same org. Acceptable: each org's balance is independent.
