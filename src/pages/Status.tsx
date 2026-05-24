/**
 * Public /status — UI-010 holding page (signed Decision Form).
 *
 * The signed Client-Only Decision Form (UI-010) requires that this public
 * route does NOT make any availability claim of any kind (no operational,
 * degraded, incident, service-level, or platform-availability wording).
 * The verbatim holding message below is the ONLY permitted public copy.
 * Any deviation is enforced as a build failure by

 * `scripts/check-public-availability-claims.mjs` and the
 * `src/tests/ui-010-public-status-and-availability-claims.test.ts` suite.
 *
 * Truthful operational state lives behind auth on the admin HealthBoard
 * (`/governance/health`), driven by `cron_heartbeats` and
 * `admin_risk_items`. No public subscriber alert, incident email, or
 * automated outbound status update exists on this surface.
 */
import { PublicHeader } from "@/components/PublicHeader";

// UI-010 verbatim signed holding message. Do NOT edit without updating
// the signed Decision Form and the UI-010 test/prebuild guards.
export const UI_010_PUBLIC_STATUS_HOLDING_MESSAGE =
  "Status information is not currently published. Please contact Izenzo support for platform availability queries." as const;

export default function Status() {
  return (
    <div className="min-h-screen bg-card">
      <PublicHeader />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <p className="text-[13px] font-medium text-muted-foreground tracking-wider uppercase mb-3">
          Platform information
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter text-foreground mb-8">
          Status information not currently published
        </h1>

        <div
          className="rounded-xl border border-border bg-card px-5 py-4"
          data-testid="status-conservative-notice"
        >
          <p className="text-[15px] font-medium text-foreground leading-relaxed">
            {UI_010_PUBLIC_STATUS_HOLDING_MESSAGE}
          </p>
        </div>
      </main>
    </div>
  );
}

