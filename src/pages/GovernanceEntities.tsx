/**
 * GovernanceEntities — placeholder for the Entity Verification workspace.
 */

import { ShieldCheck } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { GovernorSidebar } from "@/components/governance/GovernorSidebar";
import { GovernancePlaceholder } from "@/components/governance/GovernancePlaceholder";

export default function GovernanceEntities() {
  return (
    <RequireAuth>
      <div className="min-h-screen w-full flex bg-white">
        <GovernorSidebar />
        <main className="flex-1 min-w-0">
          <GovernancePlaceholder
            eyebrow="Governance Layer · 03"
            title="Entity Verification"
            description="Sovereign view of every registered organisation, beneficial owner, and authorised signatory on the network. Provides UBO graphs, sanctions match history, and authority-bind attestations for regulator export."
            icon={ShieldCheck}
            eta="next sprint"
            modules={[
              { code: "ENT_01", label: "Organisation registry with risk band & residency", status: "drafting" },
              { code: "ENT_02", label: "UBO ownership graph (≥100% coverage check)", status: "scoped" },
              { code: "ENT_03", label: "Sanctions screen replay (Dilisense · OFAC · UN)", status: "scoped" },
              { code: "ENT_04", label: "Authority-bind attestation ledger", status: "queued" },
            ]}
          />
        </main>
      </div>
    </RequireAuth>
  );
}
