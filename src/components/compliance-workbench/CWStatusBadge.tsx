/**
 * Compliance Workbench — status badge.
 *
 * One badge for every enum surface: case status, risk band, evidence state,
 * provider state, hold type, decision outcome, priority, RFI item state.
 * Tones map to Tailwind variants without hardcoding raw colours.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONE,
  DECISION_OUTCOME_LABELS,
  EVIDENCE_STATE_LABELS,
  HOLD_TYPE_LABELS,
  PRIORITY_LABELS,
  PROVIDER_STATE_LABELS,
  RISK_BAND_LABELS,
  RISK_BAND_TONE,
  type CaseStatus,
  type DecisionOutcome,
  type EvidenceState,
  type HoldType,
  type Priority,
  type ProviderState,
  type RiskBand,
} from "@/lib/compliance-workbench/constants";

type Tone = "neutral" | "info" | "warn" | "success" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-primary/30 bg-primary/10 text-primary",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

const EVIDENCE_TONE: Record<EvidenceState, Tone> = {
  required: "neutral",
  missing: "warn",
  uploaded: "info",
  under_review: "info",
  accepted: "success",
  rejected: "danger",
  replacement_requested: "warn",
  expired: "warn",
  waived: "neutral",
  superseded: "neutral",
};

const PROVIDER_TONE: Record<ProviderState, Tone> = {
  not_required: "neutral",
  required: "neutral",
  pending: "info",
  clear: "success",
  possible_match: "warn",
  confirmed_match: "danger",
  mismatch: "danger",
  review_required: "warn",
  provider_error: "warn",
  expired: "warn",
  refresh_required: "warn",
  manually_resolved: "info",
};

const DECISION_TONE: Record<DecisionOutcome, Tone> = {
  approved: "success",
  conditionally_approved: "success",
  rejected: "danger",
  blocked: "danger",
  suspended: "warn",
  more_information_required: "warn",
};

const HOLD_TONE: Record<HoldType, Tone> = {
  sanctions: "danger",
  critical_risk: "danger",
  verification_refresh: "warn",
  evidence_remediation: "warn",
  provider_error: "warn",
  legal_hold: "danger",
};

const PRIORITY_TONE: Record<Priority, Tone> = {
  normal: "neutral",
  high: "info",
  urgent: "warn",
  immediate: "danger",
};

interface Props {
  kind: "case_status" | "risk" | "evidence" | "provider" | "decision" | "hold" | "priority";
  value: string | null | undefined;
  className?: string;
}

export function CWStatusBadge({ kind, value, className }: Props) {
  if (!value) {
    return (
      <Badge variant="outline" className={cn(TONE_CLASS.neutral, className)}>
        —
      </Badge>
    );
  }
  let tone: Tone = "neutral";
  let label: string = value;
  switch (kind) {
    case "case_status":
      tone = CASE_STATUS_TONE[value as CaseStatus] ?? "neutral";
      label = CASE_STATUS_LABELS[value as CaseStatus] ?? value;
      break;
    case "risk":
      tone = RISK_BAND_TONE[value as RiskBand] ?? "neutral";
      label = RISK_BAND_LABELS[value as RiskBand] ?? value;
      break;
    case "evidence":
      tone = EVIDENCE_TONE[value as EvidenceState] ?? "neutral";
      label = EVIDENCE_STATE_LABELS[value as EvidenceState] ?? value;
      break;
    case "provider":
      tone = PROVIDER_TONE[value as ProviderState] ?? "neutral";
      label = PROVIDER_STATE_LABELS[value as ProviderState] ?? value;
      break;
    case "decision":
      tone = DECISION_TONE[value as DecisionOutcome] ?? "neutral";
      label = DECISION_OUTCOME_LABELS[value as DecisionOutcome] ?? value;
      break;
    case "hold":
      tone = HOLD_TONE[value as HoldType] ?? "neutral";
      label = HOLD_TYPE_LABELS[value as HoldType] ?? value;
      break;
    case "priority":
      tone = PRIORITY_TONE[value as Priority] ?? "neutral";
      label = PRIORITY_LABELS[value as Priority] ?? value;
      break;
  }
  return (
    <Badge variant="outline" className={cn("font-medium", TONE_CLASS[tone], className)}>
      {label}
    </Badge>
  );
}
