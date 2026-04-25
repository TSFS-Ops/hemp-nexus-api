/**
 * English source-of-truth catalogue.
 *
 * Every translatable key in the app MUST exist here (other locales fall
 * back to `en`). Group keys by surface using dot notation; keep them
 * grep-able and avoid generic re-use across unrelated features.
 *
 * Placeholder syntax:
 *   "Hello {name}"                          → params: { name }
 *   "{count, plural, one {1 item} other {{count} items}}"
 */
export const en = {
  // ── Attestation flow (Signed Deal "Without a Doubt") ───────────────
  "wad.attest.statement":
    "I confirm this is not a contract. No payment. No obligation. This is a record that intent was confirmed.",
  "wad.attest.statementLabel": "Attestation Statement:",
  "wad.attest.confirmCheckbox":
    "I confirm that this is NOT a contract, involves NO payment, and creates NO legal obligation. This is an evidence record that intent was confirmed.",
  "wad.attest.nameLabel": "Your Full Name (as signatory)",
  "wad.attest.namePlaceholder": "Enter your full legal name",

  "wad.attest.button.attest": "Attest",
  "wad.attest.button.submitting": "Submitting attestation…",
  "wad.attest.button.retry": "Retry attestation",
  "wad.attest.button.pleaseWait": ", please wait",

  "wad.attest.error.title": "Attestation failed",
  "wad.attest.error.fallback": "Failed to attest",
  "wad.attest.error.refLabel": "Reference ID",
  "wad.attest.error.refHelp":
    "Please include the Reference ID when reporting this issue to support.",
  "wad.attest.error.copy": "Copy",
  "wad.attest.error.copied": "Copied",
  "wad.attest.error.copyAria": "Copy reference ID {id} to clipboard",
  "wad.attest.error.copiedAria": "Reference ID copied to clipboard",
  "wad.attest.error.withRef": "{message} (Ref: {requestId})",

  "wad.attest.toast.recorded": "Attestation recorded",
  "wad.attest.toast.nameRequired": "Please enter your name",
  "wad.attest.toast.confirmRequired":
    "Please confirm the attestation statement",

  "wad.attest.notAvailable.title": "Attestation not available",
  "wad.attest.notAvailable.body":
    "Only buyer and seller signatories can attest on this Signed Deal.",

  "wad.attest.alreadyAttested.title": "You have already attested",
  "wad.attest.alreadyAttested.body": "Waiting for other party",

  "wad.attest.sealed.title": "Signed Deal has been sealed",
  "wad.attest.sealed.body": "All attestations complete",

  // ── Signatories step ───────────────────────────────────────────────
  "wad.signatories.intro":
    "Both buyer and seller must attest before the Signed Deal can be sealed.",
  "wad.signatories.buyer": "Buyer Signatory",
  "wad.signatories.seller": "Seller Signatory",
  "wad.signatories.attestedBadge": "Attested",
  "wad.signatories.recordsLabel": "Attestation Records",

  // ── Progress stepper ───────────────────────────────────────────────
  "wad.progress.heading": "Attestation progress",
  "wad.progress.summary":
    "{attested} of {total} signatories attested",
  "wad.progress.barLabel": "Signatories attested",
  "wad.progress.barValueText":
    "{attested} of {total} signatories attested ({pct}%)",
  "wad.progress.live":
    "Attestation progress: {attested} of {total} signatories attested. Next: {next}.",
  "wad.progress.signatoriesLabel": "Signatories",

  "wad.progress.node.attested": "Attested",
  "wad.progress.node.pending": "Awaiting attestation",
  "wad.progress.node.closed": "Attestation closed",
  "wad.progress.node.you": "You",
  "wad.progress.node.youHint": "(you)",

  "wad.progress.next.heading": "Next",
  "wad.progress.next.aria": "Next action: {label}. {description}",

  // Status-specific next-action copy (new flow, gated by feature flag).
  "wad.next.sealed.download.label": "Download certificate",
  "wad.next.sealed.download.desc":
    "Sealed — PDF certificate is available.",
  "wad.next.sealed.label": "Sealed",
  "wad.next.sealed.desc":
    "All attestations recorded and the deal is sealed.",
  "wad.next.revoked.label": "Revoked",
  "wad.next.revoked.desc": "This Signed Deal has been revoked.",
  "wad.next.superseded.label": "Superseded",
  "wad.next.superseded.desc": "A newer Signed Deal has replaced this one.",
  "wad.next.canSeal.label": "Seal Signed Deal",
  "wad.next.canSeal.desc":
    "Both signatories have attested — ready to seal.",
  "wad.next.canAttest.label": "Attest now",
  "wad.next.canAttest.desc":
    "Your attestation is required to progress this deal.",
  "wad.next.awaitingOther.label": "Awaiting other party",
  "wad.next.awaitingOther.desc":
    "You've attested — waiting for the counterparty to attest.",
  "wad.next.awaitingAll.label": "Awaiting attestations",
  "wad.next.awaitingAll.desc":
    "Both signatories must attest before this deal can be sealed.",
  "wad.next.viewOnly.label": "View only",
  "wad.next.viewOnly.desc":
    "Only buyer and seller signatories can attest on this deal.",

  // Legacy next-action copy (pre-rollout, generic phrasing).
  "wad.next.legacy.canSealDesc":
    "Buyer and seller signatories have attested.",
  "wad.next.legacy.canAttestDesc":
    "Buyer and seller signatories must attest.",
  "wad.next.legacy.awaitingDesc":
    "Buyer and seller signatories must attest.",
  "wad.next.legacy.awaitingOtherLabel": "Awaiting other signatory",
  "wad.next.legacy.terminalDesc":
    "Buyer and seller signatories cannot attest on this deal.",
} as const;
