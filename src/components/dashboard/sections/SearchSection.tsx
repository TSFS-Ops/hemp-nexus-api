import CounterpartySearch from "@/components/CounterpartySearch";

export function SearchSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">Find Counterparties</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Search for buyers or sellers using natural language queries
        </p>
      </div>
      <CounterpartySearch />
    </div>
  );
}
