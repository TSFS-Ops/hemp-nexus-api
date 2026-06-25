/**
 * P-5 Batch 5 — Phase 5
 * Warning banners using approved wording only.
 */
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { P5B5_APPROVED_PHRASES } from "@/lib/p5-batch5/wording";
import type {
  P5B5CorrectionStatus,
  P5B5DisputeStatus,
  P5B5FinalityStatus,
  P5B5FinalOutcomeCode,
  P5B5MemoryStatus,
  P5B5ProviderDependencyStatus,
} from "@/lib/p5-batch5/outcomes";

export interface P5B5BannerInput {
  finality_status?: P5B5FinalityStatus | null;
  final_outcome_code?: P5B5FinalOutcomeCode | null;
  memory_status?: P5B5MemoryStatus | null;
  dispute_status?: P5B5DisputeStatus | null;
  correction_status?: P5B5CorrectionStatus | null;
  provider_dependency_status?: P5B5ProviderDependencyStatus | null;
}

function Row({
  tone,
  title,
  message,
}: {
  tone: "warning" | "info" | "danger";
  title: string;
  message: string;
}) {
  const Icon = tone === "danger" ? ShieldAlert : tone === "warning" ? AlertTriangle : Info;
  return (
    <Alert data-p5b5-banner={title}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function P5B5WarningBanners({ input }: { input: P5B5BannerInput }) {
  const banners: { tone: "warning" | "info" | "danger"; title: string; message: string }[] = [];

  if (input.final_outcome_code === "TEST_OR_INVALID" || input.finality_status === "invalid_test") {
    banners.push({ tone: "danger", title: "Test / Invalid", message: P5B5_APPROVED_PHRASES.TEST_OR_INVALID });
  }
  if (input.finality_status === "under_dispute" || input.dispute_status === "under_dispute") {
    banners.push({ tone: "warning", title: "Under Dispute", message: P5B5_APPROVED_PHRASES.UNDER_DISPUTE_SHORT });
  }
  if (input.memory_status === "paused") {
    banners.push({ tone: "warning", title: "Memory Paused", message: P5B5_APPROVED_PHRASES.MEMORY_PAUSED });
  }
  if (input.finality_status === "superseded") {
    banners.push({ tone: "info", title: "Superseded", message: P5B5_APPROVED_PHRASES.SUPERSEDED });
  }
  if (input.correction_status === "corrected") {
    banners.push({ tone: "info", title: "Corrected", message: P5B5_APPROVED_PHRASES.CORRECTED_SHORT });
  }
  if (input.memory_status === "excluded") {
    banners.push({ tone: "info", title: "Excluded from Memory", message: P5B5_APPROVED_PHRASES.EXCLUDED_FROM_MEMORY });
  }
  if (
    input.final_outcome_code === "FAILED_PROVIDER_DEPENDENCY" ||
    input.provider_dependency_status === "failed" ||
    input.provider_dependency_status === "inconclusive"
  ) {
    banners.push({
      tone: "warning",
      title: "Provider Dependency",
      message: P5B5_APPROVED_PHRASES.PROVIDER_DEPENDENCY,
    });
  }

  if (banners.length === 0) return null;
  return (
    <div className="space-y-2">
      {banners.map((b) => (
        <Row key={b.title} tone={b.tone} title={b.title} message={b.message} />
      ))}
    </div>
  );
}

export default P5B5WarningBanners;
