/**
 * Batch 2 — Admin Import Batches page (M012).
 */
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { ImportBatchList } from "@/components/registry/ImportBatchList";

export default function AdminRegistryImports() {
  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Import batches</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M012" />
      <ImportBatchList />
    </main>
  );
}
