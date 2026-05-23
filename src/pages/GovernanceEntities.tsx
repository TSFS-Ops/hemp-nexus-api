import { ShieldCheck } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { GovernorSidebar } from "@/components/governance/GovernorSidebar";
import { GovernancePage } from "@/components/governance/GovernancePage";
import { EntityList } from "@/components/governance/EntityList";
import { MobileBottomNav } from "@/components/MobileBottomNav";

export default function GovernanceEntities() {
  return (
    <RequireAuth>
      <div className="min-h-screen w-full flex bg-white">
        <GovernorSidebar />
        <main className="flex-1 min-w-0">
          <GovernancePage
            eyebrow="Governance Layer · 03"
            title="Entity Verification"
            description="Counterparty register with KYC, UBO chain, authority binding, and risk score. Entities are screened against sanctions and adverse-media feeds at issuance and re-screened on a configured cadence (currently targeted at 90 days)."
            icon={ShieldCheck}
            meta={[
              { label: "Verified", value: "4 entities", tone: "good" },
              { label: "Action Required", value: "2", tone: "bad" },
            ]}
          >
            <EntityList />
          </GovernancePage>
        </main>
        <MobileBottomNav />
      </div>
    </RequireAuth>
  );
}
