/**
 * 6-step visual pipeline — KYC+AI → Analysis → Counterparty → Create POI → Commit → WaD.
 * With "Find a Bid/Offer" or "Find a Buyer/Seller" toggle above.
 * Mobile: buttons stacked vertically with OR divider; stepper is swipeable with hidden scrollbar.
 * Desktop: buttons side-by-side, stepper laid out horizontally.
 */

import { useState } from "react";
import { Search, Users, ArrowRight } from "lucide-react";

const PIPELINE_STEPS = [
  { label: "KYC + AI", subtitle: "Verify identity" },
  { label: "AI+ Analysis", subtitle: "Match & Score" },
  { label: "Counterparty Found", subtitle: "Review Options" },
  { label: "Create POI", subtitle: "Structuring" },
  { label: "Commit", subtitle: "to POI" },
  { label: "WaD", subtitle: "Without-a-Doubt" },
];

export function WorkflowPipeline() {
  const [activeTab, setActiveTab] = useState<"bid" | "buyer">("bid");

  return (
    <div className="border border-border bg-background">
      {/* Toggle: stacked on mobile, side-by-side on sm+ */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-center gap-0 sm:gap-3 px-4 py-3 sm:py-4 border-b border-border">
        <button
          onClick={() => setActiveTab("bid")}
          className={`inline-flex items-center gap-2 px-5 py-2.5 text-[11px] font-mono uppercase tracking-widest font-medium
                     transition-all duration-200 justify-center w-full sm:w-auto sm:flex-1 sm:max-w-[240px]
                     ${activeTab === "bid"
                       ? "bg-primary text-primary-foreground shadow-inner-metallic"
                       : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
                     }`}
        >
          <Search className="h-3.5 w-3.5" />
          Find a Bid / Offer
        </button>

        {/* OR divider — horizontal on mobile, inline text on desktop */}
        <div className="flex items-center justify-center gap-3 py-2 sm:py-0 sm:gap-0">
          <div className="flex-1 h-px bg-border sm:hidden" />
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest px-2 sm:px-0">or</span>
          <div className="flex-1 h-px bg-border sm:hidden" />
        </div>

        <button
          onClick={() => setActiveTab("buyer")}
          className={`inline-flex items-center gap-2 px-5 py-2.5 text-[11px] font-mono uppercase tracking-widest font-medium
                     transition-all duration-200 justify-center w-full sm:w-auto sm:flex-1 sm:max-w-[240px]
                     ${activeTab === "buyer"
                       ? "bg-primary text-primary-foreground shadow-inner-metallic"
                       : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
                     }`}
        >
          <Users className="h-3.5 w-3.5" />
          Find a Buyer / Seller
        </button>
      </div>

      {/* 6-step pipeline — swipeable on mobile with hidden scrollbar */}
      <div className="px-4 py-6 overflow-x-auto scrollbar-hide">
        <div className="flex items-center sm:justify-between gap-1" style={{ minWidth: '600px' }}>
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1 flex-shrink-0">
              <div className="flex flex-col items-center text-center min-w-[85px]">
                <div
                  className={`w-12 h-12 rounded-full border flex items-center justify-center mb-2 transition-colors
                    ${i === PIPELINE_STEPS.length - 1
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-accent/30 text-muted-foreground"
                    }`}
                >
                  <span className="text-[11px] font-mono font-bold">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <span className="text-[12px] font-semibold text-foreground leading-tight">{step.label}</span>
                <span className="text-[11px] text-muted-foreground font-medium leading-tight mt-0.5">{step.subtitle}</span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0 mx-1" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
