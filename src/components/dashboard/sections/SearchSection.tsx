import CounterpartySearch from "@/components/CounterpartySearch";
import { SectionHeader } from "@/components/ui/section-header";

export function SearchSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Find Counterparties"
        description="Search for verified buyers or sellers, then create a match to begin the intent workflow"
      />
      <CounterpartySearch />
    </div>
  );
}
