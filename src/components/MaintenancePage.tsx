import { useEffect, useRef, useState } from "react";

/**
 * MAINTENANCE GATE
 * ----------------
 * When MAINTENANCE_MODE is true, every visitor — regardless of route or auth state —
 * sees only the reboot/migration page with a live countdown. Login is blocked because
 * the gate sits ABOVE the Router, so /auth, /desk, /hq, etc. never mount.
 *
 * To disable: set MAINTENANCE_MODE = false (single line) or remove <MaintenanceGate>
 * from App.tsx.
 *
 * Target: 2026-05-03 13:00 Africa/Johannesburg (SAST, UTC+2) = 2026-05-03 11:00 UTC.
 */
export const MAINTENANCE_MODE = true;
const TARGET_UTC_MS = Date.UTC(2026, 4, 3, 11, 0, 0); // May = month index 4
// Anchor: the moment MAINTENANCE_MODE was flipped on. Progress % is computed
// across the real outage window (start -> resume), so the bar reflects how far
// through the actual outage we are, not an assumed 24h window.
const MAINTENANCE_START_UTC_MS = Date.UTC(2026, 4, 2, 8, 30, 0);
const WINDOW_MS = Math.max(1, TARGET_UTC_MS - MAINTENANCE_START_UTC_MS);

const ACTIVITY_LOG: string[] = [
  "Migrating evidence ledger…",
  "Re-indexing trade requests…",
  "Rotating signing keys…",
  "Verifying RLS policies…",
  "Compacting audit trail…",
  "Replaying webhook queue…",
  "Recomputing counterparty ratings…",
  "Synchronising regional replicas…",
  "Validating POI state machine…",
  "Sealing WaD attestation snapshots…",
  "Pruning expired session tokens…",
  "Warming edge function caches…",
];

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function useCountdown(targetMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const diff = Math.max(0, targetMs - now);
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { diff, days, hours, minutes, seconds, isOver: diff === 0, now };
}

function useActivityRotator(intervalMs = 3500) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % ACTIVITY_LOG.length),
      intervalMs,
    );
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return ACTIVITY_LOG[index];
}

export function MaintenancePage() {
  const { days, hours, minutes, seconds, isOver, now } = useCountdown(TARGET_UTC_MS);
  const activity = useActivityRotator();

  const targetSastLabel = "Sunday 3 May 2026 · 13:00 SAST (Johannesburg)";

  // Progress 0–100 across the assumed 24h window, clamped.
  const elapsed = Math.max(0, Math.min(WINDOW_MS, now - MAINTENANCE_START_UTC_MS));
  const progressPct = isOver ? 100 : Math.round((elapsed / WINDOW_MS) * 1000) / 10;

  return (
    <div className="min-h-screen w-full bg-[#F8FAFC] text-[#0F172A] flex items-center justify-center px-6 py-10 font-sans">
      <div className="w-full max-w-2xl">
        <div
          className="border border-[#E2E8F0] rounded-md bg-white px-8 py-12 sm:px-12 sm:py-16 text-center"
          style={{ animation: "fade-in 0.5s ease-out both" }}
        >
          <div
            className="flex items-center justify-center gap-2 mb-8 flex-wrap"
            style={{ animation: "fade-in 0.5s ease-out 0.05s both" }}
          >
            <StatusPulseDot />
            <span className="text-base sm:text-2xl uppercase tracking-[0.14em] sm:tracking-[0.18em] text-[#475569] font-bold whitespace-nowrap">
              System status · Pre-flight
            </span>
          </div>

          <p
            className="text-[#475569] text-base leading-relaxed mb-10 max-w-xl mx-auto"
            style={{ animation: "fade-in 0.5s ease-out 0.25s both" }}
          >
            Izenzo is temporarily offline while we complete a scheduled platform
            reboot and data migration. All sign-in, trading, and API surfaces are
            paused.
          </p>

          {isOver ? (
            <div
              className="border border-[#E2E8F0] rounded-md bg-[#F8FAFC] px-6 py-8 mb-8 text-center"
              style={{ animation: "fade-in 0.5s ease-out 0.35s both" }}
            >
              <p className="text-sm text-[#475569] mb-2">Scheduled resume time has passed.</p>
              <p className="text-base text-[#0F172A]">
                Final checks in progress. Please refresh shortly.
              </p>
            </div>
          ) : (
            <div
              className="border border-[#E2E8F0] rounded-md bg-[#F8FAFC] px-6 pt-8 pb-6 mb-8 text-center"
              style={{ animation: "fade-in 0.5s ease-out 0.35s both" }}
            >
              <p className="text-xs uppercase tracking-[0.16em] text-[#475569] mb-5">
                Time until resume
              </p>
              <div
                className="grid grid-cols-4 gap-3 sm:gap-6"
                role="timer"
                aria-live="polite"
                aria-label={`${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds remaining`}
              >
                <CountdownCell value={days} label="Days" />
                <CountdownCell value={hours} label="Hours" />
                <CountdownCell value={minutes} label="Minutes" />
                <CountdownCell value={seconds} label="Seconds" />
              </div>

              {/* Progress bar */}
              <div className="mt-8">
                <div
                  className="h-1.5 w-full rounded-full bg-[#E2E8F0] overflow-hidden"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Maintenance progress"
                >
                  <div
                    className="h-full bg-[#047857] rounded-full transition-[width] duration-700 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2 text-[11px] text-[#64748B] font-mono tabular-nums">
                  <span>Maintenance progress</span>
                  <span className="text-[#047857]">{progressPct.toFixed(1)}%</span>
                </div>
              </div>

              {/* Live activity log */}
              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[#475569] min-h-[20px]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#047857] animate-pulse" />
                <span
                  key={activity}
                  className="font-mono tracking-tight"
                  style={{ animation: "fade-in 0.5s ease-out both" }}
                >
                  {activity}
                </span>
              </div>
            </div>
          )}

          <div
            className="border-t border-[#E2E8F0] pt-6 space-y-2 text-center"
            style={{ animation: "fade-in 0.5s ease-out 0.45s both" }}
          >
            <p className="text-xs uppercase tracking-[0.16em] text-[#475569]">
              Resume scheduled for
            </p>
            <p className="text-base font-medium text-[#0F172A]">{targetSastLabel}</p>
            <p className="text-xs text-[#64748B]">
              Equivalent: 2026-05-03 11:00 UTC
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

function StatusPulseDot() {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full rounded-full bg-[#047857] opacity-60 animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#047857]" />
    </span>
  );
}

function CountdownCell({ value, label }: { value: number; label: string }) {
  const padded = pad(value);
  const prevRef = useRef(padded);
  const changed = prevRef.current !== padded;
  useEffect(() => {
    prevRef.current = padded;
  }, [padded]);

  return (
    <div className="text-center">
      <div className="relative h-10 sm:h-14 overflow-hidden">
        <div
          key={padded}
          className="font-mono text-3xl sm:text-5xl font-semibold tabular-nums text-[#047857] tracking-tight leading-none"
          style={{
            animation: changed ? "digit-slide 0.35s ease-out" : undefined,
          }}
        >
          {padded}
        </div>
      </div>
      <div className="text-[10px] sm:text-xs uppercase tracking-[0.14em] text-[#475569] mt-2">
        {label}
      </div>
    </div>
  );
}
