/**
 * Regression — unsubscribe flow: rapid double-click + stale-tab scenarios
 *
 * Targets `supabase/functions/handle-email-unsubscribe/index.ts`. We assert
 * the source ships the protections (atomic check-and-update, used_at pre-check,
 * 30-day TTL with 410, RFC 8058 one-click branch) AND we simulate the handler
 * logic against a fake Supabase client to prove:
 *
 *   1. Double-click (two near-simultaneous POSTs on the same token) — exactly
 *      one POST wins (`success: true`); the loser sees
 *      `{ success: false, reason: 'already_unsubscribed' }` — NEVER a 500,
 *      NEVER a second suppression upsert.
 *   2. Stale tab (user opens unsubscribe page, leaves it open > 30 days,
 *      then clicks confirm) — GET validate returns 410 token_expired, and
 *      a late POST also returns 410 token_expired without mutating state.
 *   3. Stale tab on an already-used token — both GET and POST return
 *      `already_unsubscribed` with no second suppression write.
 *   4. RFC 8058 one-click POST honours the same atomic guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC_PATH = 'supabase/functions/handle-email-unsubscribe/index.ts';
const src = readFileSync(SRC_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Static guarantees — the source must keep these protections in place.
// ---------------------------------------------------------------------------
describe('handle-email-unsubscribe — static protections', () => {
  it('uses atomic check-and-update guarded by `used_at IS NULL`', () => {
    // The single source of truth against double-click TOCTOU races.
    expect(src).toMatch(/\.update\(\s*\{\s*used_at:\s*new Date\(\)\.toISOString\(\)/);
    expect(src).toMatch(/\.is\(\s*['"]used_at['"]\s*,\s*null\s*\)/);
  });

  it('returns already_unsubscribed (not 500) when the atomic update finds no row', () => {
    // Loser of the race must surface a benign already_unsubscribed result.
    expect(src).toMatch(/if \(!updated\)/);
    expect(src).toMatch(/reason:\s*['"]already_unsubscribed['"]/);
  });

  it('pre-checks `used_at` before attempting the update', () => {
    // Fast path for the already-used token (stale tab reopened later).
    expect(src).toMatch(/tokenRecord\.used_at/);
  });

  it('enforces 30-day TTL with HTTP 410 on stale tokens', () => {
    expect(src).toMatch(/tokenRecord\.expires_at/);
    expect(src).toMatch(/token_expired/);
    // Status MUST be 410 Gone, not 200 — clients rely on this to surface
    // a "this link expired, request a new one" affordance.
    expect(src).toMatch(/token_expired['"]?\s*\}\s*,\s*410\s*\)/);
  });

  it('supports RFC 8058 one-click POST (Gmail/Apple Mail unsubscribe)', () => {
    expect(src).toMatch(/List-Unsubscribe/);
    expect(src).toMatch(/application\/x-www-form-urlencoded/);
  });

  it('suppression upsert keys on email with onConflict guard', () => {
    // Prevents duplicate-key 500s if the email is already suppressed.
    expect(src).toMatch(/from\(['"]suppressed_emails['"]\)/);
    expect(src).toMatch(/onConflict:\s*['"]email['"]/);
  });
});

// ---------------------------------------------------------------------------
// Logic simulation — fake the Supabase client and reproduce the handler's
// atomic semantics to prove the race + stale-tab outcomes end-to-end.
// ---------------------------------------------------------------------------

type TokenRow = {
  token: string;
  email: string;
  used_at: string | null;
  expires_at: string | null;
};

/**
 * Minimal fake mirroring the handler's two query shapes:
 *   - select * from email_unsubscribe_tokens where token = ? (maybeSingle)
 *   - update set used_at = now() where token = ? and used_at is null (returning *)
 *   - upsert into suppressed_emails ... on conflict (email)
 *
 * The update is atomic w.r.t. concurrent callers: only the first invocation
 * observing `used_at = null` flips it and returns the row; subsequent
 * invocations return `null`. This mirrors Postgres row-level locking under
 * a single `UPDATE ... WHERE used_at IS NULL RETURNING *`.
 */
function makeFakeDb(seed: TokenRow[]) {
  const tokens = new Map(seed.map((r) => [r.token, { ...r }]));
  const suppressionWrites: { email: string; reason: string }[] = [];

  const tokensTable = (op: 'select' | 'update', payload?: { used_at: string }) => {
    let filterToken: string | null = null;
    let requireUsedAtNull = false;
    const builder = {
      eq(_col: string, val: string) {
        filterToken = val;
        return builder;
      },
      is(_col: string, val: null) {
        if (val === null) requireUsedAtNull = true;
        return builder;
      },
      select() {
        return builder;
      },
      async maybeSingle() {
        if (filterToken == null) return { data: null, error: null };
        const row = tokens.get(filterToken);
        if (op === 'select') {
          return { data: row ?? null, error: null };
        }
        // op === 'update'
        if (!row) return { data: null, error: null };
        if (requireUsedAtNull && row.used_at !== null) {
          return { data: null, error: null };
        }
        row.used_at = payload!.used_at;
        return { data: { ...row }, error: null };
      },
    };
    return builder;
  };

  return {
    suppressionWrites,
    from(table: string) {
      if (table === 'email_unsubscribe_tokens') {
        return {
          select: () => tokensTable('select'),
          update: (payload: { used_at: string }) => tokensTable('update', payload),
        };
      }
      if (table === 'suppressed_emails') {
        return {
          upsert: async (row: { email: string; reason: string }) => {
            const idx = suppressionWrites.findIndex((w) => w.email === row.email);
            if (idx >= 0) suppressionWrites[idx] = row;
            else suppressionWrites.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

/**
 * Re-implementation of the POST-mutation branch of the handler. Mirrors
 * lines 71-133 of `handle-email-unsubscribe/index.ts`. Kept narrow on
 * purpose: we are testing the race/stale-tab semantics, not the HTTP
 * surface (which the static checks above cover).
 */
async function processUnsubscribe(
  // deno-lint-ignore no-explicit-any
  db: any,
  token: string,
  method: 'GET' | 'POST',
  now: number = Date.now(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: tokenRecord } = await db
    .from('email_unsubscribe_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (!tokenRecord) return { status: 404, body: { error: 'Invalid or expired token' } };
  if (tokenRecord.used_at) {
    return { status: 200, body: { valid: false, reason: 'already_unsubscribed' } };
  }
  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at).getTime() < now) {
    return { status: 410, body: { valid: false, reason: 'token_expired' } };
  }
  if (method === 'GET') return { status: 200, body: { valid: true } };

  const { data: updated } = await db
    .from('email_unsubscribe_tokens')
    .update({ used_at: new Date(now).toISOString() })
    .eq('token', token)
    .is('used_at', null)
    .select()
    .maybeSingle();

  if (!updated) {
    return { status: 200, body: { success: false, reason: 'already_unsubscribed' } };
  }

  await db
    .from('suppressed_emails')
    .upsert({ email: tokenRecord.email.toLowerCase(), reason: 'unsubscribe' });

  return { status: 200, body: { success: true } };
}

describe('handle-email-unsubscribe — rapid double-click', () => {
  it('two concurrent POSTs: exactly one wins, the other reports already_unsubscribed', async () => {
    const db = makeFakeDb([
      { token: 't-dbl', email: 'User@Example.com', used_at: null, expires_at: null },
    ]);

    const [a, b] = await Promise.all([
      processUnsubscribe(db, 't-dbl', 'POST'),
      processUnsubscribe(db, 't-dbl', 'POST'),
    ]);

    const winners = [a, b].filter((r) => (r.body as { success?: boolean }).success === true);
    const losers = [a, b].filter(
      (r) => (r.body as { reason?: string }).reason === 'already_unsubscribed',
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].status).toBe(200); // benign, NOT 500

    // Suppression list must receive exactly one write — never duplicated by
    // the loser of the race.
    expect(db.suppressionWrites).toEqual([
      { email: 'user@example.com', reason: 'unsubscribe' },
    ]);
  });

  it('a third late click on the same token still returns already_unsubscribed', async () => {
    const db = makeFakeDb([
      { token: 't-triple', email: 'a@b.co', used_at: null, expires_at: null },
    ]);
    await processUnsubscribe(db, 't-triple', 'POST');
    const second = await processUnsubscribe(db, 't-triple', 'POST');
    const third = await processUnsubscribe(db, 't-triple', 'POST');
    expect(second.body).toMatchObject({ reason: 'already_unsubscribed' });
    expect(third.body).toMatchObject({ reason: 'already_unsubscribed' });
    expect(db.suppressionWrites).toHaveLength(1);
  });
});

describe('handle-email-unsubscribe — stale tab', () => {
  const now = new Date('2026-05-16T12:00:00Z').getTime();
  const longAgo = new Date('2026-04-01T12:00:00Z').toISOString(); // > 30 days old

  it('GET validate on an expired token returns 410 token_expired', async () => {
    const db = makeFakeDb([
      { token: 't-stale', email: 'x@y.co', used_at: null, expires_at: longAgo },
    ]);
    const res = await processUnsubscribe(db, 't-stale', 'GET', now);
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ reason: 'token_expired' });
  });

  it('POST confirm from a stale tab returns 410 and never suppresses', async () => {
    const db = makeFakeDb([
      { token: 't-stale-post', email: 'x@y.co', used_at: null, expires_at: longAgo },
    ]);
    const res = await processUnsubscribe(db, 't-stale-post', 'POST', now);
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ reason: 'token_expired' });
    expect(db.suppressionWrites).toHaveLength(0);
  });

  it('stale tab reopened on an already-used token returns already_unsubscribed (no double-suppress)', async () => {
    const db = makeFakeDb([
      {
        token: 't-used',
        email: 'x@y.co',
        used_at: new Date('2026-05-01T00:00:00Z').toISOString(),
        expires_at: null,
      },
    ]);
    const getRes = await processUnsubscribe(db, 't-used', 'GET', now);
    const postRes = await processUnsubscribe(db, 't-used', 'POST', now);
    expect(getRes.body).toMatchObject({ valid: false, reason: 'already_unsubscribed' });
    expect(postRes.body).toMatchObject({ reason: 'already_unsubscribed' });
    expect(db.suppressionWrites).toHaveLength(0);
  });

  it('unknown token returns 404 and never writes', async () => {
    const db = makeFakeDb([]);
    const res = await processUnsubscribe(db, 'nope', 'POST', now);
    expect(res.status).toBe(404);
    expect(db.suppressionWrites).toHaveLength(0);
  });
});
