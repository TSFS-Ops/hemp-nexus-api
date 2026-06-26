/**
 * P-5 Batch 7 — Phase 4
 * Provider Dashboard (admin surface, read-only).
 * Provider dependency status (no raw payloads).
 */
import { useState } from "react";
import {
  P5B7DashboardShell,
  P5B7SummaryCards,
  P5B7FilterBar,
  P5B7SavedViewSelector,
  P5B7DetailSection,
  P5B7StaleDataBanner,
  P5B7Empty,
} from "@/components/p5-batch7/DashboardShell";

export default function P5Batch7ProviderDashboard() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<string | null>(null);

  return (
    <P5B7DashboardShell dashboard="provider_dashboard">
      <P5B7StaleDataBanner dashboard="provider_dashboard" asOf={null} isStale={true} />
      <P5B7SummaryCards
        cards={[
          { label: "Providers monitored", value: "—" },
          { label: "Healthy", value: "—" },
          { label: "Degraded", value: "—" },
          { label: "Unavailable", value: "—" },
        ]}
      />
      <P5B7FilterBar
        query={q}
        onQueryChange={setQ}
        placeholder="Filter providers…"
        rightSlot={<P5B7SavedViewSelector views={[]} value={view} onChange={setView} disabled />}
      />
      <P5B7DetailSection title="Dependency status" description="Aggregated read-only signals. Raw provider payloads are never displayed.">
        <P5B7Empty label="Awaiting provider response — live provider wiring lands in Phase 5." />
      </P5B7DetailSection>
    </P5B7DashboardShell>
  );
}
