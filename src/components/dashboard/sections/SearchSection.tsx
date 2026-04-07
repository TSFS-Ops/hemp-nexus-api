import { useState } from "react";
import CounterpartySearch from "@/components/CounterpartySearch";
import { BilateralMatchForm } from "@/components/dashboard/BilateralMatchForm";
import { SectionHeader } from "@/components/ui/section-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Handshake } from "lucide-react";

export function SearchSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Find Counterparties"
        description="Search for verified counterparties online, or create a bilateral match with a known partner"
      />
      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search" className="gap-1.5">
            <Search className="h-4 w-4" />
            Online Search
          </TabsTrigger>
          <TabsTrigger value="bilateral" className="gap-1.5">
            <Handshake className="h-4 w-4" />
            Bilateral (Known Counterparty)
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-4">
          <CounterpartySearch />
        </TabsContent>
        <TabsContent value="bilateral" className="mt-4">
          <BilateralMatchForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
