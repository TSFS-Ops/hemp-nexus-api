/**
 * P-5 Batch 7 — Phase 4
 * Audit Dashboard (admin surface, read-only).
 * Append-only audit event explorer (UI surface only; reads via Phase 5 RPC).
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

export default function P5Batch7AuditDashboard() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<string | null>(null);

  return (
    <P5B7DashboardShell dashboard="audit_dashboard">
      <P5B7StaleDataBanner dashboard="audit_dashboard" asOf={null} isStale={true} />
      <P5B7SummaryCards
        cards={[
          { label: "Events (24h)", value: "—" },
          { label: "Dashboard views", value: "—" },
          { label: "Sensitive reveals", value: "—" },
          { label: "Access denied", value: "—" },
        ]}
      />
      <P5B7FilterBar
        query={q}
        onQueryChange={setQ}
        placeholder="Filter audit events…"
        rightSlot={<P5B7SavedViewSelector views={[]} value={view} onChange={setView} disabled />}
      />
      <P5B7DetailSection title="Recent audit events" description="Append-only; explorer wiring lands in Phase 5.">
        <P5B7Empty />
      </P5B7DetailSection>
    </P5B7DashboardShell>
  );
}
