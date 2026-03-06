import { MatchAnalytics } from "@/components/MatchAnalytics";
import { SectionHeader } from "@/components/ui/section-header";

export function AnalyticsSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Match Analytics"
        description="Insights and statistics about your trading activity"
      />
      <MatchAnalytics />
    </div>
  );
}
