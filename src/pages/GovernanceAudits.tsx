/**
 * GovernanceAudits — placeholder for the Active Audits workspace.
 */

import { FileSearch } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { GovernorSidebar } from "@/components/governance/GovernorSidebar";
import { GovernancePlaceholder } from "@/components/governance/GovernancePlaceholder";

export default function GovernanceAudits() {
  return (
    <RequireAuth>
      <div className="min-h-screen w-full flex bg-white">
        <GovernorSidebar />
        <main className="flex-1 min-w-0">
          <GovernancePlaceholder
            eyebrow="Governance Layer · 02"
            title="Active Audits"
            description="Long-running compliance investigations across counterparties, sealed WaD certificates, and regulator-initiated reviews. Each audit will carry its own evidence trail, scoped governor assignments, and time-locked conclusions."
            icon={FileSearch}
            eta="next sprint"
            modules={[
              { code: "AUD_01", label: "Open audit register with severity routing", status: "drafting" },
              { code: "AUD_02", label: "Counterparty evidence vault & chain-of-custody", status: "scoped" },
              { code: "AUD_03", label: "Regulator request inbox (SARS · FIC · SARB)", status: "scoped" },
              { code: "AUD_04", label: "Audit conclusion ledger with cryptographic seal", status: "queued" },
            ]}
          />
        </main>
      </div>
    </RequireAuth>
  );
}
