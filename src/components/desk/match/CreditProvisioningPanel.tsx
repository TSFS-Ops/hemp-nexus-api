import { motion, AnimatePresence } from "framer-motion";
import { X, Check } from "lucide-react";
import { useState } from "react";
import { startCreditCheckout, type CreditPackageId } from "@/lib/credit-checkout";
import { CheckoutErrorNotice } from "@/components/desk/billing/CheckoutErrorNotice";

type Tier = {
  id: CreditPackageId;
  credits: number;
  priceZAR: number;
  label: string;
  recommended?: boolean;
};

// Pricing must match the backend `TOKEN_PACKAGES` registry in
// supabase/functions/token-purchase/index.ts. Drift here will cause
// the checkout to charge a different amount than the UI advertises.
const TIERS: Tier[] = [
  { id: "single", credits: 1, priceZAR: 10, label: "Single Action" },
  { id: "pack_50", credits: 50, priceZAR: 450, label: "Trade Starter", recommended: true },
  { id: "pack_200", credits: 200, priceZAR: 1600, label: "Institutional" },
];

interface CreditProvisioningPanelProps {
  open: boolean;
  onClose: () => void;
  currentBalance?: number;
}

export function CreditProvisioningPanel({
  open,
  onClose,
  currentBalance = 0,
}: CreditProvisioningPanelProps) {
  const [selected, setSelected] = useState<string>("starter");

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Dimmed backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-900/20"
            aria-hidden="true"
          />

          {/* Slide-over panel */}
          <motion.aside
            key="panel"
            role="dialog"
            aria-labelledby="credit-provisioning-title"
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={{ type: "spring", stiffness: 100, damping: 18 }}
            className="fixed inset-y-0 right-0 z-50 w-[400px] bg-card border-l border-border shadow-2xl flex flex-col"
          >
            {/* Header */}
            <header className="px-8 pt-8 pb-6 border-b border-border">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3">
                    Token Vault
                  </p>
                  <h2
                    id="credit-provisioning-title"
                    className="text-xl font-semibold text-foreground tracking-tight leading-snug"
                  >
                    Credit Provisioning Required
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="shrink-0 -mr-2 -mt-1 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>

              <p className="mt-5 text-sm text-muted-foreground leading-relaxed">
                Your current balance is{" "}
                <span className="font-mono text-foreground">{currentBalance} Credits</span>.
                Generating a Proof of Intent requires{" "}
                <span className="font-mono text-foreground">1 Credit (R10 ZAR)</span>.
              </p>
            </header>

            {/* Tiers */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-4">
                Select Provisioning
              </p>

              <div className="space-y-3">
                {TIERS.map((tier) => {
                  const active = selected === tier.id;
                  const perCredit = tier.priceZAR / tier.credits;
                  return (
                    <button
                      key={tier.id}
                      onClick={() => setSelected(tier.id)}
                      className={`w-full text-left rounded-sm border p-4 transition-colors ${
                        active
                          ? "border-slate-900 bg-muted"
                          : "border-border bg-card hover:border-slate-400"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground">
                              {tier.label}
                            </p>
                            {tier.recommended && (
                              <span className="font-mono text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 border border-border text-muted-foreground rounded-sm">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {tier.credits} {tier.credits === 1 ? "Credit" : "Credits"} ·
                            {" "}R{perCredit.toFixed(perCredit % 1 === 0 ? 0 : 2)} per Credit
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-base text-foreground tabular-nums">
                            R{tier.priceZAR.toLocaleString("en-ZA")}
                          </p>
                        </div>
                      </div>
                      {active && (
                        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Check className="h-3 w-3" strokeWidth={2.5} />
                          <span className="font-mono tracking-wide uppercase text-[10px]">
                            Selected
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer · Payment */}
            <footer className="px-8 pt-5 pb-8 border-t border-border bg-card">
              <motion.button
                whileHover={{ scale: 0.99 }}
                whileTap={{ scale: 0.985 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="w-full inline-flex items-center justify-center gap-3 rounded-md bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground shadow-sm hover:shadow-md transition-shadow"
              >
                Proceed to Payment
                <span className="font-mono text-[11px] tracking-wider opacity-80">
                  R{TIERS.find((t) => t.id === selected)?.priceZAR.toLocaleString("en-ZA")}
                </span>
              </motion.button>

              <p className="mt-4 text-center font-mono text-[9px] tracking-[0.3em] uppercase text-muted-foreground/70">
                Secured Settlement
              </p>
              <div className="mt-3 flex items-center justify-center gap-5 grayscale opacity-70">
                <span className="font-mono text-[11px] font-semibold text-muted-foreground tracking-tight">
                  paystack
                </span>
                <span className="h-3 w-px bg-slate-300" />
                <span className="font-sans italic text-[11px] font-bold text-muted-foreground tracking-tight">
                  VISA
                </span>
                <span className="h-3 w-px bg-slate-300" />
                <span className="font-sans text-[11px] font-bold text-muted-foreground tracking-tight">
                  mastercard
                </span>
              </div>
              <p className="mt-4 text-center text-[11px] text-muted-foreground leading-relaxed">
                ZAR funds are held in escrow and applied to your Token balance on confirmation.
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
