/**
 * attest-error-report - assembles a plain-text incident report users can
 * download from the inline attestation error alert and email/attach to
 * support. Kept text-only (no JSON, no PDF) so it opens in any client
 * and is trivially redactable before sending.
 */

export interface AttestErrorReportInput {
  wadId: string;
  matchId?: string | null;
  buyerOrgId?: string | null;
  sellerOrgId?: string | null;
  userOrgId?: string | null;
  resolvedRole?: string | null;
  attestedName: string;
  attestConfirmed: boolean;
  error: {
    message: string;
    requestId?: string;
    kind?: string;
  };
  appVersion?: string;
}

function line(label: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return `${label}: -`;
  return `${label}: ${String(value)}`;
}

export function buildAttestErrorReport(
  input: AttestErrorReportInput,
  now: Date = new Date(),
): string {
  const ua =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "-";
  const url =
    typeof window !== "undefined" && window.location ? window.location.href : "-";

  return [
    "Izenzo - Attestation error report",
    "==================================",
    "",
    line("Generated at", now.toISOString()),
    line("Page", url),
    line("User agent", ua),
    line("App version", input.appVersion),
    "",
    "── Error ──",
    line("Message", input.error.message),
    line("Reference ID", input.error.requestId),
    line("Kind", input.error.kind),
    "",
    "── Context ──",
    line("WaD ID", input.wadId),
    line("Match ID", input.matchId),
    line("Buyer org", input.buyerOrgId),
    line("Seller org", input.sellerOrgId),
    line("Acting org", input.userOrgId),
    line("Resolved role", input.resolvedRole),
    "",
    "── Form fields at time of error ──",
    line("Attested name", input.attestedName),
    line("Confirmation checkbox", input.attestConfirmed ? "checked" : "unchecked"),
    "",
    "Please attach this file when contacting Izenzo support.",
    "",
  ].join("\n");
}

/** Filename like `izenzo-attest-error-<wadId>-2026-04-25T12-34-56.txt`. */
export function buildAttestErrorReportFilename(
  wadId: string,
  now: Date = new Date(),
): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  const safeWad = wadId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "wad";
  return `izenzo-attest-error-${safeWad}-${stamp}.txt`;
}
