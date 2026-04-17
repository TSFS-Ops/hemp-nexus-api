/**
 * GovernanceTriage page — Governor / Compliance Officer workspace.
 * Renders the persona-specific sidebar + the 40/60 split triage workspace.
 */

import { RequireAuth } from "@/components/RequireAuth";
import { GovernorSidebar } from "@/components/governance/GovernorSidebar";
import TriageInbox from "@/components/governance/TriageInbox";
import { MobileBottomNav } from "@/components/MobileBottomNav";

export default function GovernanceTriage() {
  return (
    <RequireAuth>
      <div className="min-h-screen w-full flex bg-white">
        <GovernorSidebar />
        <main className="flex-1 min-w-0">
          <TriageInbox />
        </main>
        <MobileBottomNav />
      </div>
    </RequireAuth>
  );
}
