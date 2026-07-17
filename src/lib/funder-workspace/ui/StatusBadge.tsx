/**
 * Funder Workspace - single status badge component for every status enum
 * we render (release, consent, pack, org, approval, user, generic).
 * Colour semantics are consistent across all funder surfaces.
 */
import { Badge } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import type {
  ConsentStatus,
  FunderOrgApprovalStatus,
  FunderOrgStatus,
  PackVersionRow,
  ReleaseStatus,
} from "@/lib/funder-workspace/types";
import type { P5B3FunderUserStatus } from "@/lib/p5-batch3/constants";
import {
  consentStatusLabel,
  funderUserStatusLabel,
  humanize,
  orgStatusLabel,
  packStatusLabel,
  releaseStatusLabel,
  approvalStatusLabel,
} from "./labels";

type Variant = "default" | "secondary" | "destructive" | "outline";

const RELEASE_VARIANT: Record<string, Variant> = {
  active: "default",
  expiring_soon: "outline",
  draft: "secondary",
  expired: "secondary",
  revoked: "destructive",
};
const CONSENT_VARIANT: Record<ConsentStatus, Variant> = {
  granted: "default",
  not_required: "default",
  pending: "secondary",
  overridden: "outline",
  declined: "destructive",
};
const PACK_VARIANT: Record<PackVersionRow["status"], Variant> = {
  sealed: "default",
  generated: "default",
  pending: "secondary",
  superseded: "secondary",
  revoked: "destructive",
  failed: "destructive",
};
const USER_VARIANT: Record<P5B3FunderUserStatus, Variant> = {
  active: "default",
  invited: "outline",
  deactivated: "secondary",
};
const ORG_VARIANT: Record<FunderOrgStatus, Variant> = {
  active: "default",
  suspended: "destructive",
  closed: "secondary",
};
const APPROVAL_VARIANT: Record<FunderOrgApprovalStatus, Variant> = {
  approved: "default",
  admin_created: "default",
  requested: "secondary",
  rejected: "destructive",
  suspended: "destructive",
};

type Kind = "release" | "consent" | "pack" | "user" | "org" | "approval";

interface Props {
  kind: Kind;
  value: string | null | undefined;
  className?: string;
}

export function StatusBadge({ kind, value, className }: Props) {
  if (!value) return <Badge variant="secondary" className={className}>-</Badge>;
  let variant: Variant = "secondary";
  let label = humanize(value);
  switch (kind) {
    case "release":
      variant = RELEASE_VARIANT[value] ?? "secondary";
      label = releaseStatusLabel(value as ReleaseStatus);
      break;
    case "consent":
      variant = CONSENT_VARIANT[value as ConsentStatus] ?? "secondary";
      label = consentStatusLabel(value as ConsentStatus);
      break;
    case "pack":
      variant = PACK_VARIANT[value as PackVersionRow["status"]] ?? "secondary";
      label = packStatusLabel(value as PackVersionRow["status"]);
      break;
    case "user":
      variant = USER_VARIANT[value as P5B3FunderUserStatus] ?? "secondary";
      label = funderUserStatusLabel(value as P5B3FunderUserStatus);
      break;
    case "org":
      variant = ORG_VARIANT[value as FunderOrgStatus] ?? "secondary";
      label = orgStatusLabel(value);
      break;
    case "approval":
      variant = APPROVAL_VARIANT[value as FunderOrgApprovalStatus] ?? "secondary";
      label = approvalStatusLabel(value);
      break;
  }
  return (
    <Badge variant={variant as VariantProps<typeof Badge>["variant"]} className={className}>
      {label}
    </Badge>
  );
}
