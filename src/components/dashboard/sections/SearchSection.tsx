import CounterpartySearch from "@/components/CounterpartySearch";
import { BilateralMatchForm } from "@/components/dashboard/BilateralMatchForm";
import { UnilateralIntentForm } from "@/components/dashboard/UnilateralIntentForm";
import { SectionHeader } from "@/components/ui/section-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Handshake, Megaphone } from "lucide-react";

export function SearchSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Find Counterparties"
        description="Search online, create a bilateral match, or publish a unilateral intent to attract liquidity"
      />
      <Tabs defaultValue="search">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="search" className="gap-1.5">
            <Search className="h-4 w-4" />
            Online Search
          </TabsTrigger>
          <TabsTrigger value="bilateral" className="gap-1.5">
            <Handshake className="h-4 w-4" />
            Bilateral (Known Counterparty)
          </TabsTrigger>
          <TabsTrigger value="unilateral" className="gap-1.5">
            <Megaphone className="h-4 w-4" />
            Unilateral Intent
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-4">
          <CounterpartySearch />
        </TabsContent>
        <TabsContent value="bilateral" className="mt-4">
          <BilateralMatchForm />
        </TabsContent>
        <TabsContent value="unilateral" className="mt-4">
          <UnilateralIntentForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
