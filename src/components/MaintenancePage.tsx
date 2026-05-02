import { useEffect, useState } from "react";

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
  return { diff, days, hours, minutes, seconds, isOver: diff === 0 };
}

export function MaintenancePage() {
  const { days, hours, minutes, seconds, isOver } = useCountdown(TARGET_UTC_MS);

  const targetSastLabel = "Sunday 3 May 2026 · 13:00 SAST (Johannesburg)";

  return (
    <div className="min-h-screen w-full bg-[#F8FAFC] text-[#0F172A] flex items-center justify-center px-6 py-10 font-sans">
      <div className="w-full max-w-2xl">
        <div className="border border-[#E2E8F0] rounded-md bg-white px-8 py-12 sm:px-12 sm:py-16">
          <div className="flex items-center gap-2 mb-8">
            <div className="h-2 w-2 rounded-full bg-[#047857] animate-pulse" />
            <span className="text-xs uppercase tracking-[0.18em] text-[#475569] font-medium">
              System status · Maintenance
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight mb-4">
            Reboot &amp; migration underway
          </h1>

          <p className="text-[#475569] text-base leading-relaxed mb-10 max-w-xl">
            Izenzo is temporarily offline while we complete a scheduled platform
            reboot and data migration. All sign-in, trading, and API surfaces are
            paused. Service will resume automatically at the time below.
          </p>

          {isOver ? (
            <div className="border border-[#E2E8F0] rounded-md bg-[#F8FAFC] px-6 py-8 mb-8">
              <p className="text-sm text-[#475569] mb-2">Scheduled resume time has passed.</p>
              <p className="text-base text-[#0F172A]">
                Final checks in progress. Please refresh shortly.
              </p>
            </div>
          ) : (
            <div className="border border-[#E2E8F0] rounded-md bg-[#F8FAFC] px-6 py-8 mb-8">
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
            </div>
          )}

          <div className="border-t border-[#E2E8F0] pt-6 space-y-2">
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

function CountdownCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="font-mono text-3xl sm:text-5xl font-semibold tabular-nums text-[#0F172A] tracking-tight">
        {pad(value)}
      </div>
      <div className="text-[10px] sm:text-xs uppercase tracking-[0.14em] text-[#475569] mt-2">
        {label}
      </div>
    </div>
  );
}
