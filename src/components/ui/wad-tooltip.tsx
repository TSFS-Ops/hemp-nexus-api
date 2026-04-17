/**
 * WadTooltip, Renders the term "WaD" (or a custom label) with a small info icon
 * and a hover tooltip that explains the acronym in plain language.
 *
 * Usage:
 *   <WadTooltip />                        → "WaD (i)"
 *   <WadTooltip label="WaD Management" /> → "WaD Management (i)"
 *   <WadTooltip inline />                 → inline "WaD" with tooltip, no icon
 */

import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

const WAD_EXPLANATION =
  "Without a Doubt (WaD): a sealed, tamper-evident evidence bundle that confirms the full trade trail. It is not a contract, but an auditable proof bundle.";

interface WadTooltipProps {
  /** Custom label text. Defaults to "WaD". */
  label?: string;
  /** Render inline without the info icon. */
  inline?: boolean;
  /** Additional CSS classes on the outer span. */
  className?: string;
}

export function WadTooltip({ label = "WaD", inline = false, className = "" }: WadTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 cursor-help ${className}`}>
            <span>{label}</span>
            {!inline && <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-sm">
          <p>{WAD_EXPLANATION}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
