import CounterpartySearch from "@/components/CounterpartySearch";
import { SectionHeader } from "@/components/ui/section-header";

export function SearchSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Find Counterparties"
        description="Search for buyers or sellers using natural language queries"
      />
      <CounterpartySearch />
    </div>
  );
}
