/**
 * Batch 2 — Admin Provenance page (M010).
 */
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { ProvenanceSourceList } from "@/components/registry/ProvenanceSourceList";

export default function AdminRegistryProvenance() {
  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Registry provenance</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M010" />
      <ProvenanceSourceList />
    </main>
  );
}
