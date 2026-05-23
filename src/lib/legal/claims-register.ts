/**
 * DEC-010 — Claims register.
 *
 * Static SSOT for approved investor / client / public claims. Anything
 * not on this list and not in IN_DEVELOPMENT_CLAIMS must be removed
 * from public-facing copy.
 */

export interface ApprovedClaim {
  id: string;
  text: string;
  surfaces: string[]; // "marketing" | "docs" | "ui" | "email"
}

export const APPROVED_CLAIMS: ApprovedClaim[] = [
  { id: "workflow.governed", text: "Governed trade workflow.", surfaces: ["marketing", "ui", "docs"] },
  { id: "workflow.recording", text: "Record, manage, and progress trade intent.", surfaces: ["marketing", "ui"] },
  { id: "poi.pre-acceptance", text: "POI before counterparty acceptance is an initiator-generated intent record awaiting counterparty confirmation.", surfaces: ["marketing", "docs", "ui"] },
  { id: "poi.post-acceptance", text: "After counterparty acceptance, a POI is an accepted POI / mutual intent record — not a final contract or completed transaction.", surfaces: ["marketing", "docs", "ui"] },
  { id: "admin.hold-points", text: "Admin-controlled hold-points for unknown or off-platform counterparties.", surfaces: ["marketing", "docs"] },
  { id: "billing.credits", text: "Pay-as-you-go credit billing with full usage history.", surfaces: ["marketing", "ui"] },
  { id: "hash.recorded", text: "SHA-256 hash recorded on critical state transitions. Coverage is being progressively hardened.", surfaces: ["marketing", "docs"] },
  { id: "demo.controlled", text: "Demo environments use controlled demo data and are not representations of customer activity.", surfaces: ["marketing"] },
];

export const IN_DEVELOPMENT_CLAIMS: ApprovedClaim[] = [
  { id: "status.public", text: "Public status feed is in development.", surfaces: ["marketing"] },
  { id: "screening.continuous", text: "Continuous re-screening is planned hardening.", surfaces: ["marketing", "docs"] },
  { id: "telemetry.realtime", text: "Real-time programme telemetry is in development.", surfaces: ["marketing"] },
  { id: "regulator.export", text: "Independent regulator export endpoints are planned hardening.", surfaces: ["marketing"] },
];
