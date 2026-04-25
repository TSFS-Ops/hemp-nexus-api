/**
 * WizardStepper - Horizontal 5-step stepper with strict linear locking.
 *
 * Steps: Search → Match → POI → WaD → Evidence Pack
 * Locked steps display a lock icon and cannot be clicked.
 * Uses Izenzo Emerald for active/complete states, Deep Slate for locked.
 *
 * Accessibility:
 *  - Wrapped in an explicit ordered list (`<ol role="list">`) so the steps
 *    are announced as a numbered sequence even when CSS strips list bullets.
 *  - Each step button gets a single consolidated `aria-label`
 *    ("Step 2 of 5: Match — current step") to prevent screen readers from
 *    announcing the number, label, and state as three separate items.
 *  - The active step is marked `aria-current="step"`.
 *  - Decorative icons (check, lock, numerals) are `aria-hidden`.
 *  - The active-step description below the rail is `aria-hidden` because the
 *    button it describes already includes the same text in its aria-label,
 *    avoiding a double announcement.
 *  - Mobile and desktop variants share the same source data; only one is
 *    rendered at a time via responsive `display:none`, which also hides the
 *    other from assistive tech (so steps are not announced twice).
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

/** Build a single, screen-reader-friendly label that combines the step
 *  number, name, lifecycle state, and (for the active step) its description.
 *  Centralised here so desktop and mobile variants stay in sync. */
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

  const parts = [
    `Step ${idx + 1} of ${total}`,
    step.label,
    `— ${stateText}`,
  ];
  if (isActive && step.description) {
    parts.push(`. ${step.description}`);
  }
  return parts.join(" ");
}

export function WizardStepper({ steps, activeStep, onStepClick }: WizardStepperProps) {
  const total = steps.length;

  return (
    <div className="w-full">
      {/* Desktop stepper */}
      <ol
        role="list"
        aria-label="Trade workflow steps"
        className="hidden sm:flex items-center justify-between gap-0 list-none p-0 m-0"
      >
        {steps.map((step, idx) => {
          const isActive = idx === activeStep;
          const isComplete = step.complete;
          const isLocked = step.locked;
          const isClickable = !isLocked && !isActive;

          return (
            <li
              key={step.id}
              aria-current={isActive ? "step" : undefined}
              className="flex items-center flex-1 min-w-0"
            >
              <button
                type="button"
                onClick={() => isClickable && onStepClick(idx)}
                disabled={isLocked}
                aria-label={stepAriaLabel(step, idx, total, isActive)}
                aria-disabled={isLocked || undefined}
                className={cn(
                  "flex flex-col items-center gap-1.5 group transition-all duration-200 min-w-0",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md",
                  isClickable && "cursor-pointer",
                  isLocked && "cursor-not-allowed opacity-50",
                  isActive && "cursor-default",
                )}
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    "flex items-center justify-center h-8 w-8 rounded-full border-2 transition-all duration-300",
                    isComplete && "border-primary bg-primary text-primary-foreground",
                    isActive && !isComplete && "border-primary bg-primary/10 ring-2 ring-primary/20",
                    !isActive && !isComplete && !isLocked && "border-muted-foreground/30 group-hover:border-primary/50",
                    isLocked && "border-muted/50 bg-muted/30",
                  )}
                >
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
                <div aria-hidden="true" className="text-center min-w-0 max-w-[100px]">
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
                <div
                  aria-hidden="true"
                  className={cn(
                    "flex-1 h-0.5 mx-2 transition-colors duration-300",
                    isComplete ? "bg-primary" : "bg-muted",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile: compact pill stepper. Same semantics, narrower layout. */}
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
                  "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all min-h-[36px]",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  isActive && "bg-primary text-primary-foreground",
                  isComplete && !isActive && "bg-primary/10 text-primary",
                  isLocked && "bg-muted/30 text-muted-foreground/50 cursor-not-allowed",
                  !isActive && !isComplete && !isLocked && "bg-muted text-muted-foreground",
                )}
              >
                <span aria-hidden="true" className="contents">
                  {isComplete && <CheckCircle2 className="h-3 w-3" />}
                  {isLocked && <Lock className="h-3 w-3" />}
                  {!isComplete && !isLocked && <span className="font-bold">{idx + 1}</span>}
                  <span>{step.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/*
        Active step description.
        aria-hidden because the active step's button already includes this
        description in its consolidated aria-label — without this, a screen
        reader would announce the description twice when focus lands on the
        active step.
      */}
      {steps[activeStep] && (
        <p
          aria-hidden="true"
          className="text-xs text-muted-foreground mt-2 text-center sm:text-left"
        >
          {steps[activeStep].description}
        </p>
      )}
    </div>
  );
}
