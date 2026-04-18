/**
 * WizardStepper - Horizontal 5-step stepper with strict linear locking.
 *
 * Steps: Search → Match → POI → WaD → Evidence Pack
 * Locked steps display a lock icon and cannot be clicked.
 * Uses Izenzo Emerald for active/complete states, Deep Slate for locked.
 */

import { CheckCircle2, Lock, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardStepDef {
  id: string;
  label: string;
  description: string;
  /** Whether this step's requirements are met */
  complete: boolean;
  /** Whether the step is locked (strict linear) */
  locked: boolean;
}

interface WizardStepperProps {
  steps: WizardStepDef[];
  activeStep: number;
  onStepClick: (index: number) => void;
}

export function WizardStepper({ steps, activeStep, onStepClick }: WizardStepperProps) {
  return (
    <div className="w-full">
      {/* Desktop stepper */}
      <div className="hidden sm:flex items-center justify-between gap-0">
        {steps.map((step, idx) => {
          const isActive = idx === activeStep;
          const isComplete = step.complete;
          const isLocked = step.locked;
          const isClickable = !isLocked && !isActive;

          return (
            <div key={step.id} className="flex items-center flex-1 min-w-0">
              <button
                type="button"
                onClick={() => isClickable && onStepClick(idx)}
                disabled={isLocked}
                className={cn(
                  "flex flex-col items-center gap-1.5 group transition-all duration-200 min-w-0",
                  isClickable && "cursor-pointer",
                  isLocked && "cursor-not-allowed opacity-50",
                  isActive && "cursor-default",
                )}
              >
                <div className={cn(
                  "flex items-center justify-center h-8 w-8 rounded-full border-2 transition-all duration-300",
                  isComplete && "border-primary bg-primary text-primary-foreground",
                  isActive && !isComplete && "border-primary bg-primary/10 ring-2 ring-primary/20",
                  !isActive && !isComplete && !isLocked && "border-muted-foreground/30 group-hover:border-primary/50",
                  isLocked && "border-muted/50 bg-muted/30",
                )}>
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : isLocked ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground/50" />
                  ) : isActive ? (
                    <span className="text-xs font-bold text-primary">{idx + 1}</span>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">{idx + 1}</span>
                  )}
                </div>
                <div className="text-center min-w-0 max-w-[100px]">
                  <p className={cn(
                    "text-[11px] font-semibold leading-tight truncate",
                    isActive && "text-primary",
                    isComplete && "text-primary",
                    isLocked && "text-muted-foreground/50",
                    !isActive && !isComplete && !isLocked && "text-muted-foreground",
                  )}>
                    {step.label}
                  </p>
                </div>
              </button>

              {/* Connector line */}
              {idx < steps.length - 1 && (
                <div className={cn(
                  "flex-1 h-0.5 mx-2 transition-colors duration-300",
                  isComplete ? "bg-primary" : "bg-muted",
                )} />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: compact pill stepper */}
      <div className="sm:hidden flex items-center gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {steps.map((step, idx) => {
          const isActive = idx === activeStep;
          const isComplete = step.complete;
          const isLocked = step.locked;

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => !isLocked && !isActive && onStepClick(idx)}
              disabled={isLocked}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0 min-h-[36px]",
                isActive && "bg-primary text-primary-foreground",
                isComplete && !isActive && "bg-primary/10 text-primary",
                isLocked && "bg-muted/30 text-muted-foreground/50 cursor-not-allowed",
                !isActive && !isComplete && !isLocked && "bg-muted text-muted-foreground",
              )}
            >
              {isComplete && <CheckCircle2 className="h-3 w-3" />}
              {isLocked && <Lock className="h-3 w-3" />}
              {!isComplete && !isLocked && <span className="font-bold">{idx + 1}</span>}
              <span>{step.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active step description */}
      {steps[activeStep] && (
        <p className="text-xs text-muted-foreground mt-2 text-center sm:text-left">
          {steps[activeStep].description}
        </p>
      )}
    </div>
  );
}
