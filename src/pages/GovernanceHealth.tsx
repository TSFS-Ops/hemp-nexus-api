/**
 * GovernanceHealth — placeholder for the System Health workspace.
 */

import { Activity } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { GovernorSidebar } from "@/components/governance/GovernorSidebar";
import { GovernancePlaceholder } from "@/components/governance/GovernancePlaceholder";

export default function GovernanceHealth() {
  return (
    <RequireAuth>
      <div className="min-h-screen w-full flex bg-white">
        <GovernorSidebar />
        <main className="flex-1 min-w-0">
          <GovernancePlaceholder
            eyebrow="Governance Layer · 04"
            title="System Health"
            description="Real-time integrity surface for the governance plane: edge function uptime, queue depth on the WaD issuance pipeline, evidence-ledger replication lag, and any drift on cryptographic signing keys."
            icon={Activity}
            eta="this quarter"
            modules={[
              { code: "SYS_01", label: "Edge function latency & error budget", status: "drafting" },
              { code: "SYS_02", label: "WaD issuance pipeline queue depth", status: "scoped" },
              { code: "SYS_03", label: "Evidence ledger replication & hash drift", status: "scoped" },
              { code: "SYS_04", label: "Signing-key rotation & HSM attestations", status: "queued" },
            ]}
          />
        </main>
      </div>
    </RequireAuth>
  );
}
