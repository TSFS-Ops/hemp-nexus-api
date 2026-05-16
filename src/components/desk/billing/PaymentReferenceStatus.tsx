/**
 * PaymentReferenceStatus — visible audit panel for Paystack checkout
 * references on the Billing page.
 *
 * Why this exists:
 *   When a buyer returns from Paystack we silently call /verify and then
 *   refresh the wallet. If the network blips, the webhook is delayed, or
 *   anything else goes sideways the user has no way to see *what happened
 *   to their reference*. They just see "0 credits" and panic (this is
 *   exactly how we lost Thalia's first attempt).
 *
 * What it shows:
 *   For each Paystack reference the user has attempted from this device
 *   (tracked in localStorage at checkout-init time), and for any
 *   reference present in token_ledger for the org, render a row with:
 *     - Reference string
 *     - Status pill: pending / verifying / credited / already credited / failed
 *     - Credits delta (e.g. "+10")
 *     - Timestamp
 *     - Manual "Re-verify" action for stuck rows
 *
 *   Pending rows auto-poll the verify endpoint every 3s for up to 30s.
 *
 * Status derivation (single source of truth):
 *   - token_ledger row exists with action_type='credit'  →  credited
 *   - localStorage attempt + no ledger + verify returned alreadyCredited → already credited
 *   - localStorage attempt + no ledger + still polling   →  pending / verifying
 *   - localStorage attempt + no ledger + verify failed   →  failed (with message)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { verifyCreditCheckout } from "@/lib/credit-checkout";
import { CheckCircle2, Clock3, Loader2, AlertTriangle, RotateCw } from "lucide-react";

const STORAGE_KEY = "izenzo.billing.paystack-attempts.v1";
const MAX_TRACKED = 10;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 30_000;

export type AttemptStatus =
  | "pending" // user returned, no ledger row yet, no verify result
  | "verifying" // /verify call in-flight
  | "credited" // ledger row found OR verify success with credits
  | "already_credited" // verify returned alreadyCredited (idempotent)
  | "failed"; // verify returned success=false or threw

export interface PaystackAttempt {
  reference: string;
  packageId?: string;
  expectedCredits?: number;
  startedAt: string; // ISO
}

interface LedgerRow {
  id: string;
  request_id: string | null;
  tokens_burned: number;
  remaining_balance: number;
  endpoint: string | null;
  action_type: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface RowState {
  reference: string;
  status: AttemptStatus;
  credits?: number;
  newBalance?: number;
  message?: string;
  startedAt?: string;
  ledgerCreatedAt?: string;
  source: "ledger" | "local";
}

// ── Public helper used by checkout initiators ───────────────────
/**
 * Persist a fresh Paystack attempt so the Billing page can show its
 * status when the user returns. Keeps the most recent MAX_TRACKED.
 */
export function recordPaystackAttempt(attempt: PaystackAttempt): void {
  try {
    const existing = readAttempts();
    const next = [
      attempt,
      ...existing.filter((a) => a.reference !== attempt.reference),
    ].slice(0, MAX_TRACKED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

/**
 * Batch C — Fix 4: read recent Paystack attempts that look "pending"
 * to the local device (started within the window, no ledger evidence
 * has reached this tab yet). Used to render a soft two-tab warning
 * near the Purchase CTAs.
 *
 * Pure-localStorage; intentionally does not hit the network. The
 * caller can cross-check against credited references to suppress
 * false positives once a ledger row arrives.
 */
const PENDING_WARN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export function readRecentPendingAttempts(creditedRefs: Set<string> = new Set()): PaystackAttempt[] {
  const now = Date.now();
  return readAttempts().filter((a) => {
    if (creditedRefs.has(a.reference)) return false;
    const started = Date.parse(a.startedAt);
    if (!Number.isFinite(started)) return false;
    return now - started < PENDING_WARN_WINDOW_MS;
  });

function readAttempts(): PaystackAttempt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is PaystackAttempt =>
        a && typeof a === "object" && typeof a.reference === "string"
    );
  } catch {
    return [];
  }
}

function writeAttempts(attempts: PaystackAttempt[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts.slice(0, MAX_TRACKED)));
  } catch {
    /* ignore */
  }
}

// ── Component ───────────────────────────────────────────────────
interface PaymentReferenceStatusProps {
  orgId: string | null;
  /** Called when a poll/verify cycle credits a previously-pending row,
   *  so the parent can refresh wallet balance + ledger view. */
  onCredited?: () => void;
  /** Most-recent reference picked up from the URL on this load — gets
   *  priority polling treatment. */
  activeReference?: string | null;
}

export function PaymentReferenceStatus({
  orgId,
  onCredited,
  activeReference,
}: PaymentReferenceStatusProps) {
  const [attempts, setAttempts] = useState<PaystackAttempt[]>(() => readAttempts());
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [verifyState, setVerifyState] = useState<
    Record<string, { status: AttemptStatus; credits?: number; newBalance?: number; message?: string }>
  >({});
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const pollStartRef = useRef<Record<string, number>>({});

  // ── Load purchase ledger rows for this org ──────────────────
  const loadLedger = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("token_ledger")
      .select(
        "id, request_id, tokens_burned, remaining_balance, endpoint, action_type, created_at, metadata"
      )
      .eq("org_id", orgId)
      .eq("action_type", "credit")
      .order("created_at", { ascending: false })
      .limit(20);
    setLedger((data ?? []) as unknown as LedgerRow[]);
  }, [orgId]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  // ── If activeReference shows up, ensure it's tracked locally ─
  useEffect(() => {
    if (!activeReference) return;
    const exists = attempts.some((a) => a.reference === activeReference);
    if (!exists) {
      const next = [
        { reference: activeReference, startedAt: new Date().toISOString() },
        ...attempts,
      ].slice(0, MAX_TRACKED);
      setAttempts(next);
      writeAttempts(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReference]);

  // ── Build the merged row list (ledger + local-only attempts) ─
  const ledgerByRef = useMemo(() => {
    const m = new Map<string, LedgerRow>();
    for (const row of ledger) {
      if (row.request_id) m.set(row.request_id, row);
    }
    return m;
  }, [ledger]);

  const rows: RowState[] = useMemo(() => {
    const seen = new Set<string>();
    const out: RowState[] = [];

    // 1. Local attempts first — they preserve order + show "pending" UX
    for (const a of attempts) {
      seen.add(a.reference);
      const ledgerRow = ledgerByRef.get(a.reference);
      if (ledgerRow) {
        out.push({
          reference: a.reference,
          status: "credited",
          credits: Math.abs(Number(ledgerRow.tokens_burned ?? 0)) || a.expectedCredits,
          newBalance: ledgerRow.remaining_balance,
          startedAt: a.startedAt,
          ledgerCreatedAt: ledgerRow.created_at,
          source: "ledger",
        });
        continue;
      }
      const v = verifyState[a.reference];
      out.push({
        reference: a.reference,
        status: v?.status ?? "pending",
        credits: v?.credits ?? a.expectedCredits,
        newBalance: v?.newBalance,
        message: v?.message,
        startedAt: a.startedAt,
        source: "local",
      });
    }

    // 2. Append any ledger rows we haven't already covered
    for (const row of ledger) {
      const ref = row.request_id;
      if (!ref || seen.has(ref)) continue;
      out.push({
        reference: ref,
        status: "credited",
        credits: Math.abs(Number(row.tokens_burned ?? 0)),
        newBalance: row.remaining_balance,
        ledgerCreatedAt: row.created_at,
        source: "ledger",
      });
    }

    return out;
  }, [attempts, ledger, ledgerByRef, verifyState]);

  // ── Auto-verify pending rows ─────────────────────────────────
  useEffect(() => {
    const pending = rows.filter(
      (r) => r.source === "local" && (r.status === "pending" || r.status === "verifying")
    );
    if (pending.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      for (const row of pending) {
        const startedAt = pollStartRef.current[row.reference] ?? Date.now();
        pollStartRef.current[row.reference] = startedAt;
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) continue;

        setVerifyState((s) => ({
          ...s,
          [row.reference]: { ...s[row.reference], status: "verifying" },
        }));
        try {
          const result = await verifyCreditCheckout(row.reference);
          if (cancelled) return;
          if (result.success) {
            setVerifyState((s) => ({
              ...s,
              [row.reference]: {
                status: result.alreadyCredited ? "already_credited" : "credited",
                credits: result.credits,
                newBalance: result.newBalance,
              },
            }));
            await loadLedger();
            onCredited?.();
          } else {
            setVerifyState((s) => ({
              ...s,
              [row.reference]: {
                status: "pending",
                message: result.message,
              },
            }));
          }
        } catch (e) {
          if (cancelled) return;
          setVerifyState((s) => ({
            ...s,
            [row.reference]: {
              status: "failed",
              message: e instanceof Error ? e.message : "Verification failed",
            },
          }));
        }
      }
    };

    void tick();
    const handle = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.reference}:${r.status}:${r.source}`).join("|")]);

  const handleManualVerify = async (reference: string) => {
    setRetrying((s) => ({ ...s, [reference]: true }));
    setVerifyState((s) => ({
      ...s,
      [reference]: { ...s[reference], status: "verifying" },
    }));
    try {
      const result = await verifyCreditCheckout(reference);
      if (result.success) {
        setVerifyState((s) => ({
          ...s,
          [reference]: {
            status: result.alreadyCredited ? "already_credited" : "credited",
            credits: result.credits,
            newBalance: result.newBalance,
          },
        }));
        await loadLedger();
        onCredited?.();
      } else {
        setVerifyState((s) => ({
          ...s,
          [reference]: {
            status: "failed",
            message: result.message ?? "Transaction not successful",
          },
        }));
      }
    } catch (e) {
      setVerifyState((s) => ({
        ...s,
        [reference]: {
          status: "failed",
          message: e instanceof Error ? e.message : "Verification failed",
        },
      }));
    } finally {
      setRetrying((s) => ({ ...s, [reference]: false }));
    }
  };

  const handleClear = (reference: string) => {
    const next = attempts.filter((a) => a.reference !== reference);
    setAttempts(next);
    writeAttempts(next);
  };

  if (!orgId || rows.length === 0) return null;

  return (
    <section className="mb-20">
      <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-border">
        <h2 className="text-sm font-medium tracking-wider uppercase text-muted-foreground">
          Recent Payments
        </h2>
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/70">
          Paystack · Reference Status
        </p>
      </div>

      <div className="overflow-hidden bg-card border border-border rounded-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/60">
              <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                Reference
              </th>
              <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                Status
              </th>
              <th className="text-right px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                Credits
              </th>
              <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                When
              </th>
              <th className="text-right px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ts = row.ledgerCreatedAt ?? row.startedAt;
              const isFinal =
                row.status === "credited" || row.status === "already_credited";
              return (
                <tr
                  key={row.reference}
                  className="border-b border-border last:border-b-0 align-top"
                >
                  <td className="px-5 py-4 font-mono text-[12px] text-foreground break-all">
                    {row.reference}
                    {row.message && row.status === "failed" && (
                      <p className="mt-1 font-sans text-[11px] text-destructive break-words">
                        {row.message}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-sm tabular-nums">
                    {typeof row.credits === "number" ? (
                      <span
                        className={
                          isFinal ? "font-semibold text-emerald-700" : "text-muted-foreground"
                        }
                      >
                        +{row.credits}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                    {typeof row.newBalance === "number" && (
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        Balance {row.newBalance}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    {ts
                      ? `${new Date(ts).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })} · ${new Date(ts).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "—"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {isFinal ? (
                      <button
                        type="button"
                        onClick={() => handleClear(row.reference)}
                        className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Clear
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleManualVerify(row.reference)}
                        disabled={retrying[row.reference]}
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-foreground hover:text-emerald-700 transition-colors disabled:opacity-50"
                      >
                        <RotateCw
                          className={`h-3 w-3 ${
                            retrying[row.reference] ? "animate-spin" : ""
                          }`}
                          strokeWidth={2.5}
                        />
                        Re-verify
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/60">
        References auto-verify for 30 seconds after return from Paystack. Stuck? Press Re-verify or contact support@izenzo.co.za.
      </p>
    </section>
  );
}

// ── Status pill ─────────────────────────────────────────────────
function StatusPill({ status }: { status: AttemptStatus }) {
  const config: Record<
    AttemptStatus,
    { label: string; classes: string; icon: React.ReactNode }
  > = {
    pending: {
      label: "Pending",
      classes: "bg-amber-50 text-amber-800 border-amber-200",
      icon: <Clock3 className="h-3 w-3" strokeWidth={2.5} />,
    },
    verifying: {
      label: "Verifying",
      classes: "bg-sky-50 text-sky-800 border-sky-200",
      icon: <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />,
    },
    credited: {
      label: "Credited",
      classes: "bg-emerald-50 text-emerald-800 border-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />,
    },
    already_credited: {
      label: "Already Credited",
      classes: "bg-emerald-50 text-emerald-800 border-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />,
    },
    failed: {
      label: "Failed",
      classes: "bg-destructive/10 text-destructive border-destructive/30",
      icon: <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />,
    },
  };
  const c = config[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-mono text-[10px] tracking-wider uppercase ${c.classes}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}
