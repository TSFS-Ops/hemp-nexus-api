/**
 * ProofDrawer, Mobile-only slide-up sheet for the "Proof / Preview" pane
 * of all split-screen surfaces (Match Compiler, Inbound Review, Triage,
 * Schema Explorer).
 *
 * Architecture:
 *   - Desktop (>= md): renders nothing visible. The right pane is shown
 *     side-by-side via the parent's existing layout.
 *   - Mobile (< md): renders a floating glassmorphism trigger button at
 *     bottom-center and a full-screen framer-motion drawer.
 *
 * The drawer feels weighted via cubic-bezier(0.32, 0.72, 0, 1), Apple's
 * "ease out expo" used throughout iOS sheets.
 */
import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

export type DrawerTone = "ink" | "terminal";

interface ProofDrawerProps {
  /** Drawer open state (controlled). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Floating trigger label, e.g. "View Certificate" or "View Audit". */
  triggerLabel: string;
  /** Optional small mono prefix above the trigger label, e.g. "WAD-7F2A". */
  triggerKicker?: string;
  /** Drawer header title rendered at the top of the sheet. */
  title: string;
  /** Optional subtitle / context line. */
  subtitle?: string;
  /** Drawer body. */
  children: ReactNode;
  /**
   * Visual tone:
   *   - ink:      light surface (Trader / Governor)
   *   - terminal: dark slate-950 surface (Developer)
   */
  tone?: DrawerTone;
  /** Hide the floating trigger entirely (e.g. if parent renders its own). */
  hideTrigger?: boolean;
}

const SPRING = { type: "spring" as const, stiffness: 360, damping: 36, mass: 0.9 };
const EASE = [0.32, 0.72, 0, 1] as const;

export function ProofDrawer({
  open,
  onOpenChange,
  triggerLabel,
  triggerKicker,
  title,
  subtitle,
  children,
  tone = "ink",
  hideTrigger = false,
}: ProofDrawerProps) {
  const isMobile = useIsMobile();

  // On desktop, the parent's split layout handles everything.
  if (!isMobile) return null;

  const isDark = tone === "terminal";

  return (
    <>
      {/* ── Floating Glassmorphism Trigger ───────────────────────── */}
      {!hideTrigger && !open && (
        <motion.button
          type="button"
          onClick={() => onOpenChange(true)}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className={[
            "md:hidden fixed left-1/2 -translate-x-1/2 z-40",
            // Sit just above the bottom-nav (h ~ 56px + safe-area)
            "bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+12px)]",
            "flex items-center gap-2.5 px-5 py-3 rounded-sm",
            "backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.12)]",
            "min-h-[48px] font-medium text-sm tracking-tight",
            isDark
              ? "bg-slate-900/85 border border-slate-700 text-slate-100"
              : "bg-white/85 border border-slate-300 text-slate-900",
          ].join(" ")}
          aria-label={triggerLabel}
        >
          {triggerKicker && (
            <span
              className={[
                "font-mono text-[9px] tracking-[0.22em] uppercase",
                isDark ? "text-slate-400" : "text-slate-500",
              ].join(" ")}
            >
              {triggerKicker}
            </span>
          )}
          <span>{triggerLabel}</span>
          <span
            className={[
              "ml-1 inline-block h-1.5 w-1.5 rounded-full",
              isDark ? "bg-green-400" : "bg-emerald-600",
            ].join(" ")}
            aria-hidden
          />
        </motion.button>
      )}

      {/* ── Sheet ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Scrim */}
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              onClick={() => onOpenChange(false)}
              className="md:hidden fixed inset-0 z-50 bg-black/40"
            />

            {/* Sheet body */}
            <motion.aside
              key="sheet"
              role="dialog"
              aria-modal="true"
              aria-label={title}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={SPRING}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.4 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 600) {
                  onOpenChange(false);
                }
              }}
              className={[
                "md:hidden fixed inset-x-0 bottom-0 z-50",
                "h-[92vh] rounded-t-sm flex flex-col",
                "shadow-[0_-12px_40px_rgba(0,0,0,0.18)]",
                isDark
                  ? "bg-slate-950 text-slate-100 border-t border-slate-800"
                  : "bg-white text-slate-900 border-t border-slate-200",
              ].join(" ")}
            >
              {/* Drag handle */}
              <div className="pt-2 pb-1 flex justify-center shrink-0">
                <span
                  className={[
                    "h-1 w-10 rounded-full",
                    isDark ? "bg-slate-700" : "bg-slate-300",
                  ].join(" ")}
                  aria-hidden
                />
              </div>

              {/* Header */}
              <header
                className={[
                  "shrink-0 px-5 pb-3 pt-1 flex items-start justify-between gap-4 border-b",
                  isDark ? "border-slate-800" : "border-slate-200",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <p
                    className={[
                      "font-mono text-[10px] tracking-[0.25em] uppercase",
                      isDark ? "text-slate-500" : "text-slate-500",
                    ].join(" ")}
                  >
                    Proof Surface
                  </p>
                  <h2 className="mt-1 text-base font-semibold tracking-tight truncate">
                    {title}
                  </h2>
                  {subtitle && (
                    <p
                      className={[
                        "mt-0.5 text-xs truncate",
                        isDark ? "text-slate-400" : "text-slate-600",
                      ].join(" ")}
                    >
                      {subtitle}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label="Close"
                  className={[
                    "shrink-0 inline-flex items-center justify-center rounded-sm",
                    "h-11 w-11 -mr-2 transition-colors",
                    isDark
                      ? "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
                  ].join(" ")}
                >
                  <X className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </header>

              {/* Body */}
              <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)]">
                {children}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
