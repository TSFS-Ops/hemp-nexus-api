import CounterpartySearch from "@/components/CounterpartySearch";

export function SearchSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Find Counterparties</h1>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
          Search for buyers or sellers using natural language queries
        </p>
      </header>
      <CounterpartySearch />
    </div>
  );
}
