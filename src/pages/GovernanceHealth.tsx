import { Activity } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { GovernorSidebar } from "@/components/governance/GovernorSidebar";
import { GovernancePage } from "@/components/governance/GovernancePage";
import { HealthBoard } from "@/components/governance/HealthBoard";

export default function GovernanceHealth() {
  return (
    <RequireAuth>
      <div className="min-h-screen w-full flex bg-white">
        <GovernorSidebar />
        <main className="flex-1 min-w-0">
          <GovernancePage
            eyebrow="Governance Layer · 04"
            title="System Health"
            description="Real-time uptime, latency, and incident posture for the nine governance gates. Polled every 30 seconds. Composite SLA target: 99.95% — current 30-day actual: 99.962%."
            icon={Activity}
            meta={[
              { label: "Composite", value: "99.962%", tone: "good" },
              { label: "Open Incidents", value: "1", tone: "warn" },
            ]}
          >
            <HealthBoard />
          </GovernancePage>
        </main>
      </div>
    </RequireAuth>
  );
}
