/**
 * OPS-010 — Reusable demo badge.
 * Visible "DEMO" pill for any record carrying is_demo=true.
 */
import { Badge } from "@/components/ui/badge";

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={
        "border-amber-500/60 bg-amber-50 text-amber-900 font-mono text-[10px] tracking-wider uppercase " +
        (className ?? "")
      }
      title="OPS-010 — Demo workspace record. Not a production artefact."
    >
      Demo
    </Badge>
  );
}
