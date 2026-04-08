import { MatchesList } from "@/components/MatchesList";
import { SectionHeader } from "@/components/ui/section-header";

export function MatchesSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Your Matches"
        description="Review matches, send trade requests, and download evidence packs"
      />
      <MatchesList />
    </div>
  );
}
