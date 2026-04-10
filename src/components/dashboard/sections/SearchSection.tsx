import CounterpartySearch from "@/components/CounterpartySearch";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { Search, CheckCircle2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const DEAL_STEPS = [
  { label: "Search", active: true, complete: false },
  { label: "Match", active: false, complete: false, locked: true },
  { label: "POI", active: false, complete: false, locked: true },
  { label: "WaD", active: false, complete: false, locked: true },
  { label: "Evidence", active: false, complete: false, locked: true },
];

export function SearchSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Find Trading Partners"
        description="Search for counterparties to begin a deal"
      />

      {/* Deal flow stepper — shows user is on Step 1 */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between gap-0">
            {DEAL_STEPS.map((step, idx) => (
              <div key={step.label} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1.5 min-w-0">
                  <div className={cn(
                    "flex items-center justify-center h-7 w-7 rounded-full border-2 transition-all",
                    step.active && "border-primary bg-primary/10 ring-2 ring-primary/20",
                    step.complete && "border-primary bg-primary text-primary-foreground",
                    step.locked && "border-muted/50 bg-muted/30",
                  )}>
                    {step.complete ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : step.locked ? (
                      <Lock className="h-3 w-3 text-muted-foreground/50" />
                    ) : (
                      <span className={cn("text-[10px] font-bold", step.active ? "text-primary" : "text-muted-foreground")}>{idx + 1}</span>
                    )}
                  </div>
                  <span className={cn(
                    "text-[10px] font-semibold",
                    step.active && "text-primary",
                    step.locked && "text-muted-foreground/50",
                    !step.active && !step.locked && "text-muted-foreground",
                  )}>
                    {step.label}
                  </span>
                </div>
                {idx < DEAL_STEPS.length - 1 && (
                  <div className="flex-1 h-0.5 mx-1.5 bg-muted" />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Step 1 of 5 — Find a trading partner to begin the deal lifecycle.
          </p>
        </CardContent>
      </Card>

      {/* Single unified search — no more separate tabs */}
      <CounterpartySearch />
    </div>
  );
}
