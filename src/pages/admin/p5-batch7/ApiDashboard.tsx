/**
 * P-5 Batch 7 — Phase 4
 * API Dashboard (admin surface, read-only). API client status / usage summary.
 * No raw keys or secrets are rendered. Reveal is gated to a Phase 5 RPC.
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
  P5B7SensitiveField,
} from "@/components/p5-batch7/DashboardShell";

export default function P5Batch7ApiDashboard() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<string | null>(null);

  return (
    <P5B7DashboardShell dashboard="api_dashboard">
      <P5B7StaleDataBanner dashboard="api_dashboard" asOf={null} isStale={true} />
      <P5B7SummaryCards
        cards={[
          { label: "Active clients", value: "—" },
          { label: "Rotating", value: "—" },
          { label: "Revoked", value: "—" },
          { label: "Requests (24h)", value: "—" },
        ]}
      />
      <P5B7FilterBar
        query={q}
        onQueryChange={setQ}
        placeholder="Filter clients…"
        rightSlot={<P5B7SavedViewSelector views={[]} value={view} onChange={setView} disabled />}
      />
      <P5B7DetailSection title="Client credentials" description="Keys are always masked. Reveal requires a governed action.">
        <div className="space-y-2">
          <P5B7SensitiveField label="Sample client key" value="sk_live_xxxxxxxxxxxxxxxx" />
          <P5B7SensitiveField label="Sample webhook secret" value="whsec_xxxxxxxxxxxxxxxx" />
        </div>
      </P5B7DetailSection>
      <P5B7DetailSection title="Usage volume" description="Read-only summary from the v1 API projection.">
        <P5B7Empty label="Usage rollup wiring lands in Phase 5." />
      </P5B7DetailSection>
    </P5B7DashboardShell>
  );
}
