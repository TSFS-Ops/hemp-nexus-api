/**
 * ActionRequiredBanner — focal "what do I do next?" banner.
 *
 * Sits directly under the macro WizardStepper. Three visual modes:
 *
 *   • action   — high-contrast amber surface; you must do something now.
 *   • locked   — quiet slate surface with dashed border; waiting on a
 *                counterparty / external event, no action available.
 *   • complete — primary tinted surface; nothing to do, all done.
 *
 * Designed to be the single most prominent "next action" cue on the page so
 * the user's eye is drawn straight to it after the macro stepper.
 */

import { ReactNode } from "react";
import { AlertTriangle, Lock, CheckCircle2, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ActionTone = "action" | "locked" | "complete";

interface ActionRequiredBannerProps {
  tone: ActionTone;
  /** Short eyebrow label, e.g. "Your turn" / "Waiting on counterparty" */
  eyebrow: string;
  /** Main headline — be direct, e.g. "Generate Proof of Intent" */
  title: string;
  /** Single sentence elaborating what / why */
  description?: string;
  /** Optional CTA — only meaningful when tone === "action" or "complete" */
  cta?: ReactNode;
  /** Optional secondary content below description (status pill, sub-meta) */
  meta?: ReactNode;
  /** Optional tooltip help text shown next to the title */
  helpText?: string;
}

const TONE_STYLES: Record<
  ActionTone,
  {
    container: string;
    eyebrow: string;
    iconWrap: string;
    icon: ReactNode;
  }
> = {
  action: {
    container:
      "border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 shadow-sm",
    eyebrow: "text-amber-700 dark:text-amber-300",
    iconWrap:
      "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/60 dark:text-amber-200 dark:border-amber-700",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  locked: {
    container:
      "border-dashed border-border bg-muted/40 shadow-none",
    eyebrow: "text-muted-foreground",
    iconWrap:
      "bg-card text-muted-foreground border-border",
    icon: <Lock className="h-4 w-4" />,
  },
  complete: {
    container: "border-primary/30 bg-primary/5 shadow-sm",
    eyebrow: "text-primary",
    iconWrap: "bg-primary/10 text-primary border-primary/30",
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
};

export function ActionRequiredBanner({
  tone,
  eyebrow,
  title,
  description,
  cta,
  meta,
  helpText,
}: ActionRequiredBannerProps) {
  const s = TONE_STYLES[tone];

  return (
    <TooltipProvider delayDuration={150}>
      <div
        role={tone === "action" ? "alert" : "status"}
        aria-live={tone === "action" ? "assertive" : "polite"}
        className={cn(
          "rounded-md border p-4 sm:p-5 transition-all",
          s.container,
        )}
      >
        <div className="flex items-start gap-3 sm:gap-4">
          <div
            aria-hidden
            className={cn(
              "h-9 w-9 rounded-md border flex items-center justify-center shrink-0 mt-0.5",
              s.iconWrap,
            )}
          >
            {s.icon}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <p
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.18em] font-semibold",
                s.eyebrow,
              )}
            >
              {eyebrow}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-sm sm:text-base font-semibold text-foreground leading-tight">
                {title}
              </h3>
              {helpText && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground/60 hover:text-foreground transition-colors"
                      aria-label="More information"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {helpText}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {description && (
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {description}
              </p>
            )}
            {meta && <div className="pt-1">{meta}</div>}
          </div>
          {cta && <div className="shrink-0 self-center hidden sm:block">{cta}</div>}
        </div>
        {cta && <div className="sm:hidden mt-3">{cta}</div>}
      </div>
    </TooltipProvider>
  );
}
