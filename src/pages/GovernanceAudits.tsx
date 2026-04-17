import { FileSearch } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { GovernorSidebar } from "@/components/governance/GovernorSidebar";
import { GovernancePage } from "@/components/governance/GovernancePage";
import { AuditList } from "@/components/governance/AuditList";
import { MobileBottomNav } from "@/components/MobileBottomNav";

export default function GovernanceAudits() {
  return (
    <RequireAuth>
      <div className="min-h-screen w-full flex bg-white">
        <GovernorSidebar />
        <main className="flex-1 min-w-0">
          <GovernancePage
            eyebrow="Governance Layer · 02"
            title="Active Audits"
            description="Long-running compliance investigations across counterparties, sealed WaD certificates, and regulator-initiated reviews. Each audit carries its own evidence trail, scoped officer assignment, and time-locked conclusion."
            icon={FileSearch}
            meta={[
              { label: "Open", value: "5 cases", tone: "warn" },
              { label: "Sealed (30d)", value: "12", tone: "good" },
            ]}
          >
            <AuditList />
          </GovernancePage>
        </main>
        <MobileBottomNav />
      </div>
    </RequireAuth>
  );
}
