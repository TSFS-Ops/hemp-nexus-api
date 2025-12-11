import { MatchAnalytics } from "@/components/MatchAnalytics";

export function AnalyticsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Match Analytics</h1>
        <p className="text-muted-foreground">
          Insights and statistics about your trading activity
        </p>
      </div>
      <MatchAnalytics />
    </div>
  );
}
