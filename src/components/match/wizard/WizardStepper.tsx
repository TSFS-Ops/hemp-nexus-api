/**
 * WizardStepper - Hero macro stepper (Search → Match → POI → Signed Deal → Evidence).
 *
 * Visual language:
 *  - Thicker (3px) rail with semantic fill (primary on completed segments).
 *  - Larger (40px) nodes with ring + pulse on the active step.
 *  - Locked steps muted with dashed ring; complete steps solid primary.
 *  - Designed to be the single dominant progression on the page; sub-step
 *    trackers (e.g. Engagement, Match sub-tabs) intentionally use a different,
 *    quieter visual language so they don't compete.
 *
 * Accessibility unchanged: ordered list, consolidated aria-label per step,
 * aria-current="step" on the active item.
 */

import { CheckCircle2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface WizardStepDef {
  id: string;
  label: string;
  description: string;
  complete: boolean;
  locked: boolean;
  /** Optional reason shown in a tooltip when the step is locked. */
  lockedReason?: string;
}

interface WizardStepperProps {
  steps: WizardStepDef[];
  activeStep: number;
  onStepClick: (index: number) => void;
}

function stepAriaLabel(
  step: WizardStepDef,
  idx: number,
  total: number,
  isActive: boolean,
): string {
  const stateText = step.locked
    ? "locked"
    : isActive
    ? "current step"
    : step.complete
    ? "completed"
    : "available";

  const parts = [`Step ${idx + 1} of ${total}`, step.label, `- ${stateText}`];
  if (isActive && step.description) parts.push(`. ${step.description}`);
  if (step.locked && step.lockedReason) parts.push(`. ${step.lockedReason}`);
  return parts.join(" ");
}

export function WizardStepper({ steps, activeStep, onStepClick }: WizardStepperProps) {
  const total = steps.length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="w-full">
        {/* Desktop hero stepper */}
        <ol
          role="list"
          aria-label="Trade workflow steps"
          className="hidden sm:flex items-start justify-between gap-0 list-none p-0 m-0"
        >
          {steps.map((step, idx) => {
            const isActive = idx === activeStep;
            const isComplete = step.complete;
            const isLocked = step.locked;
            const isClickable = !isLocked && !isActive;

            const button = (
              <button
                type="button"
                onClick={() => isClickable && onStepClick(idx)}
                disabled={isLocked}
                aria-label={stepAriaLabel(step, idx, total, isActive)}
                aria-disabled={isLocked || undefined}
                className={cn(
                  "flex flex-col items-center gap-2 group transition-all duration-200 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md",
                  isClickable && "cursor-pointer",
                  isLocked && "cursor-not-allowed",
                  isActive && "cursor-default",
                )}
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    "relative flex items-center justify-center h-10 w-10 rounded-full border-2 transition-all duration-300",
                    isComplete && "border-primary bg-primary text-primary-foreground shadow-sm",
                    isActive && !isComplete && "border-primary bg-card text-primary ring-2 ring-primary/10 shadow-sm motion-safe:animate-step-pulse",
                    !isActive && !isComplete && !isLocked && "border-border bg-card text-muted-foreground group-hover:border-primary/60 group-hover:text-primary",
                    isLocked && "border-dashed border-muted-foreground/30 bg-muted/40 text-muted-foreground/50",
                  )}
                >
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : isLocked ? (
                    <Lock className="h-3.5 w-3.5" />
                  ) : (
                    <span className={cn("text-sm font-bold tabular-nums", isActive && "text-primary")}>
                      {idx + 1}
                    </span>
                  )}
                </div>
                <div aria-hidden="true" className="text-center min-w-0 max-w-[110px]">
                  <p className={cn(
                    "text-xs font-semibold leading-tight truncate",
                    isActive && "text-foreground",
                    isComplete && !isActive && "text-primary",
                    isLocked && "text-muted-foreground/60",
                    !isActive && !isComplete && !isLocked && "text-muted-foreground",
                  )}>
                    {step.label}
                  </p>
                  {isActive && (
                    <p className="text-[10px] font-mono uppercase tracking-wider text-primary mt-0.5">
                      Current
                    </p>
                  )}
                  {isComplete && !isActive && (
                    <p className="text-[10px] font-mono uppercase tracking-wider text-primary/70 mt-0.5">
                      Done
                    </p>
                  )}
                  {isLocked && (
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mt-0.5">
                      Locked
                    </p>
                  )}
                </div>
              </button>
            );

            return (
              <li
                key={step.id}
                aria-current={isActive ? "step" : undefined}
                className="flex items-start flex-1 min-w-0"
              >
                {isLocked && step.lockedReason ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex-1 flex justify-center">{button}</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs">
                      <strong className="block mb-0.5">Locked</strong>
                      <span className="text-muted-foreground">{step.lockedReason}</span>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="flex-1 flex justify-center">{button}</span>
                )}

                {/* Connector line - thicker, semantic */}
                {idx < steps.length - 1 && (
                  <div
                    aria-hidden="true"
                    className={cn(
                      "flex-1 h-[3px] mt-[18px] mx-1 rounded-full transition-colors duration-300",
                      isComplete ? "bg-primary" : "bg-border",
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>

        {/* Mobile: compact pill stepper */}
        <ol
          role="list"
          aria-label="Trade workflow steps"
          className="sm:hidden flex items-center gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide list-none p-0 m-0"
        >
          {steps.map((step, idx) => {
            const isActive = idx === activeStep;
            const isComplete = step.complete;
            const isLocked = step.locked;

            return (
              <li
                key={step.id}
                aria-current={isActive ? "step" : undefined}
                className="shrink-0"
              >
                <button
                  type="button"
                  onClick={() => !isLocked && !isActive && onStepClick(idx)}
                  disabled={isLocked}
                  aria-label={stepAriaLabel(step, idx, total, isActive)}
                  aria-disabled={isLocked || undefined}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all min-h-[36px] border",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                    isActive && "bg-primary text-primary-foreground border-primary shadow-sm",
                    isComplete && !isActive && "bg-primary/10 text-primary border-primary/30",
                    isLocked && "bg-muted/40 text-muted-foreground/60 border-dashed border-muted-foreground/30 cursor-not-allowed",
                    !isActive && !isComplete && !isLocked && "bg-card text-muted-foreground border-border",
                  )}
                >
                  <span aria-hidden="true" className="contents">
                    {isComplete && <CheckCircle2 className="h-3 w-3" />}
                    {isLocked && <Lock className="h-3 w-3" />}
                    {!isComplete && !isLocked && <span className="font-bold tabular-nums">{idx + 1}</span>}
                    <span>{step.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </TooltipProvider>
  );
}
