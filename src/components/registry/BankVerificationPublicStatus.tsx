/**
 * Batch 14B — Claimant-safe verification status badge.
 *
 * Renders ONLY public-safe labels from the accepted Batch 14 SSOT and
 * NEVER shows "Verified" for non-final or expired statuses. Use this on
 * any user-facing surface that needs to display verification status.
 *
 * Pinned by scripts/check-batch-14b-ui-no-verified.mjs.
 */
import { Badge } from "@/components/ui/badge";
import {
  publicLabelFor,
  verificationBadgeFor,
} from "@/lib/registry-bank-verification-ui";
import type { RegistryBankVerificationStatus } from "@/lib/registry-bank-verification";

export interface BankVerificationPublicStatusProps {
  status: RegistryBankVerificationStatus;
  expiresAt?: string | null;
  disputed?: boolean;
  revoked?: boolean;
}

export function BankVerificationPublicStatus({
  status,
  expiresAt,
  disputed,
  revoked,
}: BankVerificationPublicStatusProps) {
  const badge = verificationBadgeFor(status, { expiresAt, disputed, revoked });
  const label = publicLabelFor(status, { expiresAt });
  return (
    <span className="flex gap-1 items-center" data-testid="b14b-public-status">
      <Badge variant="outline">{label}</Badge>
      <Badge variant={badge.tone === "verified" ? "default" : "secondary"}>
        {badge.label}
      </Badge>
    </span>
  );
}

export default BankVerificationPublicStatus;
