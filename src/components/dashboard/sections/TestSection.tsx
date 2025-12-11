import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ApiDocs from "@/components/ApiDocs";
import ComprehensiveApiTests from "@/components/ComprehensiveApiTests";

export function TestSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="font-bold tracking-tight">API Reference & Testing</h1>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
          Complete documentation with interactive playground and automated test suite
        </p>
      </header>
      <Tabs defaultValue="documentation" className="w-full">
        <TabsList className="flex w-full h-auto gap-1 p-1 overflow-x-auto">
          <TabsTrigger value="documentation" className="flex-1 min-w-fit px-3 py-2 text-sm">Documentation</TabsTrigger>
          <TabsTrigger value="tests" className="flex-1 min-w-fit px-3 py-2 text-sm">Automated Tests</TabsTrigger>
        </TabsList>
        <TabsContent value="documentation" className="mt-5 sm:mt-6">
          <ApiDocs />
        </TabsContent>
        <TabsContent value="tests" className="mt-5 sm:mt-6">
          <ComprehensiveApiTests />
        </TabsContent>
      </Tabs>
    </div>
  );
}
