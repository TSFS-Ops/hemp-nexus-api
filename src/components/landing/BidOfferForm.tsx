/**
 * Swiss-Terminal bid/offer entry — with BID/OFFER tabs and Upload Docs field.
 * Supports locked state during cryptographic scan phase.
 * Mobile: single-column stacked fields, full-width search button.
 * Desktop: 4-column grid, right-aligned search button.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Upload, Info } from "lucide-react";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface BidOfferData {
  product: string;
  volume: string;
  price: string;
  location: string;
  additionalInfo: string;
  side: "bid" | "offer";
}

interface BidOfferFormProps {
  onSearch: (data: BidOfferData) => void;
  isSearching: boolean;
  isLocked?: boolean;
}

export function BidOfferForm({ onSearch, isSearching, isLocked = false }: BidOfferFormProps) {
  const [side, setSideState] = useState<"bid" | "offer">("bid");
  const [form, setForm] = useState({
    product: "",
    volume: "",
    price: "",
    location: "",
    additionalInfo: "",
  });

  const sideRef = useRef(side);
  sideRef.current = side;
  const formRef = useRef(form);
  formRef.current = form;

  const getCurrentData = useCallback(() => {
    const f = formRef.current;
    const hasContent = f.product || f.volume || f.price || f.location;
    if (!hasContent) return null;
    return { side: sideRef.current, ...f };
  }, []);

  const { restoreDraft, saveDraft, clearDraft, hasRestoredDraft } = useDraftPersistence<{
    side: "bid" | "offer";
    product: string;
    volume: string;
    price: string;
    location: string;
    additionalInfo: string;
  }>("bid-offer", getCurrentData);

  const setSide = useCallback((s: "bid" | "offer") => {
    setSideState(s);
  }, []);
  const [borderPulse, setBorderPulse] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const draft = restoreDraft();
    if (draft) {
      setSide(draft.side);
      setForm({
        product: draft.product || "",
        volume: draft.volume || "",
        price: draft.price || "",
        location: draft.location || "",
        additionalInfo: draft.additionalInfo || "",
      });
      setDraftRestored(true);
    }
  }, [restoreDraft]);

  useEffect(() => {
    if (!initialised.current) return;
    const hasContent = form.product || form.volume || form.price || form.location;
    if (hasContent) {
      saveDraft({ side, ...form });
    }
  }, [side, form, saveDraft]);

  useEffect(() => {
    if (isLocked) {
      setBorderPulse(true);
      const t = setTimeout(() => setBorderPulse(false), 800);
      return () => clearTimeout(t);
    }
  }, [isLocked]);

  const update = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canSearch = form.product.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSearch && !isLocked) {
      clearDraft();
      setDraftRestored(false);
      onSearch({ ...form, side });
    }
  };

  const disabled = isLocked || isSearching;

  return (
    <form onSubmit={handleSubmit}>
      {/* Draft restored notice */}
      {draftRestored && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
          <span className="text-[11px] font-mono text-muted-foreground">
            Draft restored from your previous session
          </span>
          <button
            type="button"
            onClick={() => {
              clearDraft();
              setDraftRestored(false);
              setForm({ product: "", volume: "", price: "", location: "", additionalInfo: "" });
              setSide("bid");
            }}
            className="text-[11px] font-mono text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* BID / OFFER segmented control — full-width on all sizes */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setSide("bid")}
          className={`flex-1 h-11 sm:h-10 text-[11px] font-mono uppercase tracking-widest font-medium transition-all duration-200
                     ${side === "bid"
                       ? "bg-primary text-primary-foreground"
                       : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                     }`}
        >
          BID (Buyer)
        </button>
        <button
          type="button"
          onClick={() => setSide("offer")}
          className={`flex-1 h-11 sm:h-10 text-[11px] font-mono uppercase tracking-widest font-medium transition-all duration-200
                     border-l border-border
                     ${side === "offer"
                       ? "bg-primary text-primary-foreground"
                       : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                     }`}
        >
          OFFER (Seller)
        </button>
      </div>

      {/* Fields: single column on mobile, 4-col on sm+ */}
      <div className="grid grid-cols-1 sm:grid-cols-4">
        <LedgerField
          id="product" label="Product" required placeholder="Select product / asset"
          value={form.product} onChange={(v) => update("product", v)}
          disabled={disabled} pulsingBorder={borderPulse}
        />
        <LedgerField
          id="price" label="Price" placeholder="Enter price (ZAR/USD)"
          value={form.price} onChange={(v) => update("price", v)}
          className="sm:border-l border-border" disabled={disabled} pulsingBorder={borderPulse}
        />
        <LedgerField
          id="volume" label="Quantity" placeholder="Enter quantity"
          value={form.volume} onChange={(v) => update("volume", v)}
          className="sm:border-l border-border" disabled={disabled} pulsingBorder={borderPulse}
        />
        {/* Upload Docs field — disabled */}
        <div
          className={`focus-copper-line border-b transition-colors duration-500 sm:border-l border-border ${
            borderPulse ? "border-primary" : "border-border"
          }`}
        >
          <label
            className="block px-3 pt-2.5 text-[12px] font-mono uppercase tracking-widest text-muted-foreground font-medium select-none"
          >
            Upload Docs
          </label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="w-full h-9 px-3 pb-2 text-[13px] font-mono bg-transparent
                             text-muted-foreground cursor-not-allowed
                             flex items-center gap-2 opacity-40"
                  aria-disabled="true"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Available after sign-in</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">
                <p className="text-xs">Document uploads are available inside the dashboard after you sign in or create an account.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Search button — full-width on mobile, right-aligned on desktop */}
      <div className="flex sm:justify-end">
        <button
          type="submit"
          disabled={!canSearch || disabled}
          className={`h-11 sm:h-10 px-8 font-mono text-[11px] uppercase tracking-widest font-medium
                   transition-all duration-300 disabled:cursor-not-allowed
                   flex items-center justify-center gap-2.5
                   focus:outline-none active:scale-[0.995]
                   w-full sm:w-auto
                   ${isSearching
                     ? "bg-basalt text-basalt-foreground"
                     : canSearch && !disabled
                       ? "bg-primary text-primary-foreground shadow-inner-metallic hover:opacity-90"
                       : "bg-muted text-muted-foreground opacity-100"
                   }`}
        >
          {isSearching ? (
            <>
              <span className="h-3 w-3 border-2 border-basalt-foreground/30 border-t-basalt-foreground rounded-full animate-spin" />
              Executing...
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" />
              Search
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function LedgerField({
  id, label, placeholder, value, onChange, required,
  className = "", disabled, pulsingBorder,
}: {
  id: string; label: string; placeholder: string; value: string;
  onChange: (v: string) => void; required?: boolean; className?: string;
  disabled?: boolean; pulsingBorder?: boolean;
}) {
  return (
    <div
      className={`focus-copper-line border-b transition-colors duration-500 ${
        pulsingBorder ? "border-primary" : "border-border"
      } ${className}`}
    >
      <label
        htmlFor={id}
        className="block px-3 pt-2.5 text-[12px] font-mono uppercase tracking-widest text-muted-foreground font-medium select-none"
      >
        {label}
        {required && <span className="text-primary ml-0.5">*</span>}
      </label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-10 sm:h-9 px-3 pb-2 text-[13px] font-mono bg-transparent
                   placeholder:text-muted-foreground text-foreground
                   focus:outline-none border-none rounded-[4px]
                   transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
      />
    </div>
  );
}
