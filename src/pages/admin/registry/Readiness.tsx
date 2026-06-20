/**
 * Batch 1 — Admin readiness dashboard (M019).
 */
import { useAuth } from "@/contexts/AuthContext";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { ReadinessMatrix } from "@/components/registry/ReadinessMatrix";

export default function AdminRegistryReadiness() {
  const { roles } = useAuth();
  const roleList = (Array.isArray(roles) ? roles : []) as string[];
  const canEdit =
    roleList.includes("platform_admin") || roleList.includes("compliance_owner");

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Module readiness</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M019" />
      <ReadinessMatrix canEdit={canEdit} />
    </main>
  );
}
