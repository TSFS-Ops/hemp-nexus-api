/**
 * Public /status — Batch A Stage 1.
 *
 * Previously displayed hardcoded service rows with mocked uptime bars and
 * unconditional health claims. Until a public-incident-disclosure policy is
 * finalised, this page only shows a conservative configuration notice — no
 * uptime metrics, no per-service indicators, no synthetic green claims.
 *
 * Truthful operational state lives behind auth on the admin HealthBoard,
 * driven by cron_heartbeats and admin_risk_items.
 */
import { Wrench } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";

export default function Status() {
  return (
    <div className="min-h-screen bg-card">
      <PublicHeader />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <p className="text-[13px] font-medium text-muted-foreground tracking-wider uppercase mb-3">
          System Status
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter text-foreground mb-8">
          Status monitoring is being configured
        </h1>

        <div
          className="flex items-start gap-3 rounded-xl border border-border bg-card px-5 py-4 mb-8"
          data-testid="status-conservative-notice"
        >
          <Wrench className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="space-y-2">
            <p className="text-[15px] font-medium text-foreground">
              We are not publishing live service status at the moment.
            </p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              A public status feed will be enabled once our incident disclosure
              policy is finalised. Until then, this page intentionally does not
              display uptime metrics or per-service indicators.
            </p>
          </div>
        </div>

        <p className="text-[13px] text-muted-foreground leading-relaxed mb-3">
          If you believe you are experiencing a service issue, please contact{" "}
          <a
            href="mailto:support@izenzo.co.za"
            className="text-[hsl(var(--emerald))] hover:underline font-medium"
          >
            support@izenzo.co.za
          </a>
          .
        </p>
        <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
          Customers with admin access can view live platform health from the
          governance dashboard after signing in.
        </p>
      </main>
    </div>
  );
}
