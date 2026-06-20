/**
 * Batch 1 — Business decision register admin page (M018).
 */
import { useAuth } from "@/contexts/AuthContext";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { DecisionList } from "@/components/registry/DecisionList";

export default function AdminRegistryDecisions() {
  const { roles } = useAuth();
  const roleList = (Array.isArray(roles) ? roles : []) as string[];
  const canEdit =
    roleList.includes("platform_admin") || roleList.includes("compliance_owner");

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Business decisions</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M018" />
      <DecisionList canEdit={canEdit} />
    </main>
  );
}
