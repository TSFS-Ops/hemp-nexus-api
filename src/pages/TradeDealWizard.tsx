import { Check, FileText, ShieldCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/ui/page-container";

// ─────────────────────────────────────────────────────────────
// 9-Step Progress Bar
// ─────────────────────────────────────────────────────────────
const STEPS = [
  "Interest",
  "Details",
  "Docs",
  "Search",
  "Choice",
  "Surface",
  "Match",
  "Generate POI",
  "WaD Issuance",
];

const ACTIVE_STEP = 8; // 1-indexed: Generate POI

function ProgressBar() {
  return (
    <div className="border-b border-border bg-background px-4 md:px-8 py-4 md:py-5">
      {/* Mobile: compact "Step N of M · label" */}
      <div className="md:hidden flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background text-xs font-semibold shrink-0">
            {ACTIVE_STEP}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Step {ACTIVE_STEP} of {STEPS.length}</p>
            <p className="text-sm font-semibold text-foreground truncate">{STEPS[ACTIVE_STEP - 1]}</p>
          </div>
        </div>
        <div className="flex gap-0.5 shrink-0">
          {STEPS.map((_, idx) => (
            <span
              key={idx}
              className={cn(
                "h-1 w-3 rounded-full",
                idx + 1 < ACTIVE_STEP && "bg-foreground",
                idx + 1 === ACTIVE_STEP && "bg-foreground",
                idx + 1 > ACTIVE_STEP && "bg-border",
              )}
            />
          ))}
        </div>
      </div>

      {/* Desktop: full stepper */}
      <div className="hidden md:flex items-center justify-between max-w-5xl mx-auto">
        {STEPS.map((label, idx) => {
          const stepNum = idx + 1;
          const isCompleted = stepNum < ACTIVE_STEP;
          const isActive = stepNum === ACTIVE_STEP;
          const isLast = idx === STEPS.length - 1;

          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold shrink-0",
                    isCompleted &&
                      "bg-foreground border-foreground text-background",
                    isActive &&
                      "bg-foreground border-foreground text-background ring-4 ring-foreground/10",
                    !isCompleted && !isActive &&
                      "bg-background border-border text-muted-foreground",
                  )}
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" /> : stepNum}
                </div>
                <span
                  className={cn(
                    "text-[11px] font-medium whitespace-nowrap",
                    isActive && "text-foreground",
                    isCompleted && "text-muted-foreground",
                    !isCompleted && !isActive && "text-muted-foreground/60",
                  )}
                >
                  {stepNum}. {label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "flex-1 h-px mx-2 -mt-5",
                    stepNum < ACTIVE_STEP ? "bg-foreground" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function TradeDealWizard() {
  const docHash =
    "a4f2e8c19b3d4e7a8c6f2d1e9b5a4c8f7e3d2a51c4f4a9b9e8d7f3c2b1a5d6e";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
            <SidebarTrigger />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-tight truncate">Trade Deal Wizard</h1>
              <p className="text-xs text-muted-foreground truncate">
                Match #M-2024-0847 · Aurubis AG
              </p>
            </div>
          </header>

          <ProgressBar />

          {/* Main interface */}
          <main className="flex-1">
            <PageContainer size="narrow">
              <div className="mb-6">
                <h2 className="text-xl font-semibold tracking-tight">
                  Generate Proof of Intent
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Review the deal payload and seal this trade intent on the ledger.
                </p>
              </div>

              <div className="border border-border rounded-md bg-background overflow-hidden">
                {/* TOP SECTION, Deal Summary */}
                <div className="p-6 space-y-5">
                  {/* Counterparty */}
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                      Counterparty
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-base font-semibold text-foreground">
                        Aurubis AG
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <ShieldCheck className="h-3 w-3" />
                        Verified
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono">
                      DE-HRB-1062 · Hamburg, Germany
                    </div>
                  </div>

                  <div className="h-px bg-border" />

                  {/* Commercial Terms */}
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                      Commercial Terms
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground">Commodity</div>
                        <div className="text-sm font-medium mt-0.5">Copper Cathode</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Volume</div>
                        <div className="text-sm font-medium mt-0.5 font-mono">500 MT</div>
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <div className="text-xs text-muted-foreground">Price</div>
                        <div className="text-sm font-medium mt-0.5 font-mono">
                          USD 8,500 / MT
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      Total contract value:{" "}
                      <span className="font-mono text-foreground">USD 4,250,000</span>
                    </div>
                  </div>

                  <div className="h-px bg-border" />

                  {/* Attached Documents */}
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                      Attached Documents
                    </div>
                    <div className="border border-border rounded-md">
                      <div className="flex items-center justify-between px-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              sahpra_licence.pdf
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground truncate">
                              sha256:{docHash}
                            </div>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 shrink-0 ml-3">
                          <Lock className="h-3 w-3" />
                          Sealed
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* BOTTOM SECTION, Commercial Action */}
                <div className="border-t border-border bg-secondary/40 p-5 md:p-6">
                  <div className="text-center max-w-md mx-auto">
                    <h3 className="text-base font-bold text-foreground">
                      Record this Trade Intent
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Final review before recording the Draft POI.
                    </p>
                    <Button
                      size="lg"
                      className="mt-4 w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold min-h-[44px]"
                    >
                      Generate POI (1 Credit)
                    </Button>
                    <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                      Generating this Draft Proof of Intent (initiator-generated intent record,
                      awaiting counterparty confirmation) will atomically consume 1 Credit
                      ($1.00 USD, charged in USD at checkout) and record a cryptographic
                      hash of this payload. POI mint is recorded and not user-revocable; admin
                      reversal workflows may apply.
                    </p>
                  </div>
                </div>
              </div>
            </PageContainer>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
