import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrgProfileForm } from "@/components/account/OrgProfileForm";
import { TeamManagement } from "@/components/account/TeamManagement";
import { SecuritySettings } from "@/components/account/SecuritySettings";
import { DataControls } from "@/components/account/DataControls";

export function AccountSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organisation & Account</h1>
        <p className="text-muted-foreground mt-1">
          Manage your organisation profile, team members, security settings, and data controls.
        </p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile">Organisation</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="data">Data Controls</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4">
          <OrgProfileForm />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <TeamManagement />
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <SecuritySettings />
        </TabsContent>
        <TabsContent value="data" className="mt-4">
          <DataControls />
        </TabsContent>
      </Tabs>
    </div>
  );
}
