import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ApiDocs from "@/components/ApiDocs";
import ComprehensiveApiTests from "@/components/ComprehensiveApiTests";

export function TestSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">API Reference & Testing</h1>
        <p className="text-muted-foreground">
          Complete documentation with interactive playground and automated test suite
        </p>
      </div>
      <Tabs defaultValue="documentation" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="documentation">Documentation</TabsTrigger>
          <TabsTrigger value="tests">Automated Tests</TabsTrigger>
        </TabsList>
        <TabsContent value="documentation" className="mt-6">
          <ApiDocs />
        </TabsContent>
        <TabsContent value="tests" className="mt-6">
          <ComprehensiveApiTests />
        </TabsContent>
      </Tabs>
    </div>
  );
}
