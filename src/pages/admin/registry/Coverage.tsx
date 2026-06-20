/**
 * Batch 2 — Admin Country Coverage page (M011).
 */
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { CountryCoverageMatrix } from "@/components/registry/CountryCoverageMatrix";

export default function AdminRegistryCoverage() {
  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Country coverage</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M011" />
      <CountryCoverageMatrix />
    </main>
  );
}
