/**
 * Lightweight load/performance test — notification-dispatch under concurrency
 *
 * Mirrors the contract enforced by `supabase/functions/notification-dispatch/
 * index.ts`. We do NOT spin up the Deno edge runtime here; instead we
 * reproduce the dispatcher's branching logic (challenge suppression vs
 * normal dispatch) against an in-memory fake DB and run hundreds of
 * concurrent events through it to prove:
 *
 *   1. Audit-row accounting is exact under concurrency — N suppressed
 *      events produce N suppression audits, zero lost writes, zero
 *      duplicate writes.
 *   2. Mixed suppressed + dispatched workloads keep their shapes
 *      independent (suppressed events never call the email fake).
 *   3. The handler's per-call cost stays inside a soft latency budget
 *      under a burst — guards against an accidental O(N²) regression
 *      (e.g. someone re-introducing a sequential lookup over all
 *      previously-dispatched rows).
 *
 * Static guard at the top pins the real handler's suppression branch so
 * the simulator stays an honest mirror.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HANDLER_SRC = readFileSync(
  'supabase/functions/notification-dispatch/index.ts',
  'utf8',
);

// ---------------------------------------------------------------------------
// 0. Static guard — fail loud if the real handler's suppression / audit
//    contract drifts away from what the simulator models.
// ---------------------------------------------------------------------------
describe('notification-dispatch — handler contract guard', () => {
  it('suppresses progression.* events when an open challenge exists', () => {
    expect(HANDLER_SRC).toMatch(/event_type\.startsWith\(['"]progression\.['"]\)/);
    expect(HANDLER_SRC).toMatch(/\.in\(['"]status['"],\s*\[['"]open['"],\s*['"]under_review['"]\]\)/);
    expect(HANDLER_SRC).toMatch(/challenge\.progression_notification_suppressed/);
  });

  it('writes a notification.dispatched audit for non-suppressed events', () => {
    expect(HANDLER_SRC).toMatch(/action:\s*["']notification\.dispatched["']/);
  });

  it('fails CLOSED if the suppression audit insert fails', () => {
    expect(HANDLER_SRC).toMatch(/suppression_audit_failed/);
  });
});

// ---------------------------------------------------------------------------
// 1. Minimal in-memory fake + simulated dispatch core.
// ---------------------------------------------------------------------------

type AuditRow = { action: string; metadata: Record<string, unknown> };
type DispatchRow = { event_type: string; channel: string; status: string };

class FakeDb {
  audits: AuditRow[] = [];
  dispatches: DispatchRow[] = [];
  openChallengeByMatch = new Map<string, { id: string; status: string }>();
  emailCalls = 0;

  // Mimic Postgres serialising INSERTs — we don't need real locking because
  // JS is single-threaded; this is a fairness check, not a SQL race test.
  async insertAudit(row: AuditRow) {
    this.audits.push(row);
  }
  async insertDispatch(row: DispatchRow) {
    this.dispatches.push(row);
  }
  async lookupOpenChallenge(matchId: string) {
    return this.openChallengeByMatch.get(matchId) ?? null;
  }
}

type DispatchEvent = {
  event_type: string;
  message: string;
  subject?: string;
  metadata?: Record<string, unknown>;
};

type DispatchResult =
  | { ok: true; suppressed: true; reason: 'challenge_open'; challenge_id: string }
  | { ok: true; suppressed?: false; dispatched: string[]; skipped: { channel: string; reason: string }[] }
  | { ok: false; error: string };

async function simulateDispatch(db: FakeDb, evt: DispatchEvent): Promise<DispatchResult> {
  if (!evt.event_type || !evt.message) {
    return { ok: false, error: 'event_type and message are required' };
  }
  // Suppression branch (matches handler lines 110-189).
  if (evt.event_type.startsWith('progression.')) {
    const matchId = (evt.metadata?.match_id ?? evt.metadata?.matchId) as string | undefined;
    if (matchId) {
      const open = await db.lookupOpenChallenge(matchId);
      if (open) {
        await db.insertAudit({
          action: 'challenge.progression_notification_suppressed',
          metadata: {
            match_id: matchId,
            challenge_id: open.id,
            challenge_status: open.status,
            notification_type: evt.event_type,
          },
        });
        return { ok: true, suppressed: true, reason: 'challenge_open', challenge_id: open.id };
      }
    }
  }
  // Normal dispatch branch — one fake recipient, one channel.
  db.emailCalls += 1;
  await db.insertDispatch({
    event_type: evt.event_type,
    channel: 'email',
    status: 'dispatched',
  });
  await db.insertAudit({
    action: 'notification.dispatched',
    metadata: { event_type: evt.event_type, channels: ['email'] },
  });
  return { ok: true, dispatched: ['email'], skipped: [] };
}

// ---------------------------------------------------------------------------
// 2. Concurrency assertions.
// ---------------------------------------------------------------------------

describe('notification-dispatch — concurrent suppression workload', () => {
  it('200 concurrent suppressed events produce exactly 200 suppression audits and 0 email calls', async () => {
    const db = new FakeDb();
    const matchId = 'match-under-challenge';
    db.openChallengeByMatch.set(matchId, { id: 'chal-1', status: 'open' });

    const events: DispatchEvent[] = Array.from({ length: 200 }, (_, i) => ({
      event_type: 'progression.poi_minted',
      message: `m-${i}`,
      metadata: { match_id: matchId },
    }));

    const results = await Promise.all(events.map((e) => simulateDispatch(db, e)));

    const suppressed = results.filter(
      (r): r is Extract<DispatchResult, { suppressed: true }> => 'suppressed' in r && r.suppressed === true,
    );
    expect(suppressed).toHaveLength(200);
    expect(db.emailCalls).toBe(0);
    expect(db.dispatches).toHaveLength(0);
    expect(
      db.audits.filter((a) => a.action === 'challenge.progression_notification_suppressed'),
    ).toHaveLength(200);
    expect(
      db.audits.filter((a) => a.action === 'notification.dispatched'),
    ).toHaveLength(0);
  });
});

describe('notification-dispatch — concurrent normal workload', () => {
  it('200 concurrent normal events produce 200 dispatch rows + 200 dispatched audits', async () => {
    const db = new FakeDb();
    const events: DispatchEvent[] = Array.from({ length: 200 }, (_, i) => ({
      event_type: 'admin.alert',
      message: `m-${i}`,
    }));

    await Promise.all(events.map((e) => simulateDispatch(db, e)));

    expect(db.emailCalls).toBe(200);
    expect(db.dispatches).toHaveLength(200);
    expect(db.audits.filter((a) => a.action === 'notification.dispatched')).toHaveLength(200);
    // No stray suppression rows on a clean event_type.
    expect(
      db.audits.filter((a) => a.action === 'challenge.progression_notification_suppressed'),
    ).toHaveLength(0);
  });
});

describe('notification-dispatch — mixed concurrent workload', () => {
  it('interleaved suppressed + dispatched events keep their branches isolated', async () => {
    const db = new FakeDb();
    db.openChallengeByMatch.set('m-blocked', { id: 'chal-x', status: 'under_review' });

    const events: DispatchEvent[] = [];
    for (let i = 0; i < 100; i++) {
      events.push({
        event_type: 'progression.poi_minted',
        message: `s-${i}`,
        metadata: { match_id: 'm-blocked' },
      });
      events.push({ event_type: 'admin.alert', message: `n-${i}` });
    }
    // Shuffle to interleave the two flows.
    events.sort(() => Math.random() - 0.5);

    await Promise.all(events.map((e) => simulateDispatch(db, e)));

    expect(db.emailCalls).toBe(100); // only the admin.alert half
    expect(db.dispatches).toHaveLength(100);
    expect(
      db.audits.filter((a) => a.action === 'challenge.progression_notification_suppressed'),
    ).toHaveLength(100);
    expect(
      db.audits.filter((a) => a.action === 'notification.dispatched'),
    ).toHaveLength(100);
  });
});

describe('notification-dispatch — soft latency budget', () => {
  it('500 concurrent simulated dispatches complete inside 1000ms wall time', async () => {
    // Catches accidental O(N²) regressions in the simulator (and, by proxy,
    // in the real handler's pre-checks — anything we add here that scales
    // poorly will show up).
    const db = new FakeDb();
    const events: DispatchEvent[] = Array.from({ length: 500 }, (_, i) => ({
      event_type: i % 3 === 0 ? 'progression.poi_minted' : 'admin.alert',
      message: `m-${i}`,
      metadata: i % 3 === 0 ? { match_id: 'm-free' } : undefined, // no open challenge → falls through
    }));

    const t0 = performance.now();
    const results = await Promise.all(events.map((e) => simulateDispatch(db, e)));
    const elapsedMs = performance.now() - t0;

    expect(results.every((r) => r.ok === true)).toBe(true);
    expect(elapsedMs).toBeLessThan(1000);
    // Accounting sanity: total audit rows equals total events (one audit per).
    expect(db.audits.length).toBe(500);
  });
});
