import { MatchAnalytics } from "@/components/MatchAnalytics";

export function AnalyticsSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="font-bold tracking-tight">Match Analytics</h1>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
          Insights and statistics about your trading activity
        </p>
      </header>
      <MatchAnalytics />
    </div>
  );
}
