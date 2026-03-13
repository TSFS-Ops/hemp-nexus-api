/**
 * 6-step visual pipeline — KYC+AI → Analysis → Counterparty → Create POI → Commit → WaD.
 * With "Find a Bid/Offer" or "Find a Buyer/Seller" toggle above.
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
      {/* Toggle: Find a Bid/Offer or Find a Buyer/Seller */}
      <div className="flex items-center justify-center gap-3 px-4 py-4 border-b border-border">
        <button
          onClick={() => setActiveTab("bid")}
          className={`inline-flex items-center gap-2 px-5 py-2.5 text-[11px] font-mono uppercase tracking-widest font-medium
                     transition-all duration-200 flex-1 max-w-[240px] justify-center
                     ${activeTab === "bid"
                       ? "bg-primary text-primary-foreground shadow-inner-metallic"
                       : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
                     }`}
        >
          <Search className="h-3.5 w-3.5" />
          Find a Bid / Offer
        </button>
        <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">or</span>
        <button
          onClick={() => setActiveTab("buyer")}
          className={`inline-flex items-center gap-2 px-5 py-2.5 text-[11px] font-mono uppercase tracking-widest font-medium
                     transition-all duration-200 flex-1 max-w-[240px] justify-center
                     ${activeTab === "buyer"
                       ? "bg-primary text-primary-foreground shadow-inner-metallic"
                       : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
                     }`}
        >
          <Users className="h-3.5 w-3.5" />
          Find a Buyer / Seller
        </button>
      </div>

      {/* 6-step pipeline */}
      <div className="px-4 py-5 overflow-x-auto">
        <div className="flex items-center justify-between min-w-[600px] gap-1">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1">
              <div className="flex flex-col items-center text-center min-w-[85px]">
                <div
                  className={`w-12 h-12 rounded-full border flex items-center justify-center mb-2 transition-colors
                    ${i === PIPELINE_STEPS.length - 1
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-accent/30 text-muted-foreground"
                    }`}
                >
                  <span className="text-[10px] font-mono font-bold">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <span className="text-[10px] font-semibold text-foreground leading-tight">{step.label}</span>
                <span className="text-[9px] text-muted-foreground/60 leading-tight mt-0.5">{step.subtitle}</span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground/30 flex-shrink-0 mx-1" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
