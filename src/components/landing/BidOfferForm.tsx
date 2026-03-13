/**
 * Swiss-Terminal bid/offer entry — with BID/OFFER tabs and Upload Docs field.
 * Supports locked state during cryptographic scan phase.
 */

import { useState, useEffect, useRef } from "react";
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
  const { restoreDraft, saveDraft, clearDraft, hasRestoredDraft } = useDraftPersistence<{
    side: "bid" | "offer";
    product: string;
    volume: string;
    price: string;
    location: string;
    additionalInfo: string;
  }>("bid-offer");

  const [side, setSide] = useState<"bid" | "offer">("bid");
  const [form, setForm] = useState({
    product: "",
    volume: "",
    price: "",
    location: "",
    additionalInfo: "",
  });
  const [borderPulse, setBorderPulse] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const initialised = useRef(false);

  // Restore draft on mount
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

  // Save draft on every change (after initial load)
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
    if (canSearch && !isLocked) onSearch({ ...form, side });
  };

  const disabled = isLocked || isSearching;

  return (
    <form onSubmit={handleSubmit}>
      {/* BID / OFFER tabs */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setSide("bid")}
          className={`flex-1 h-10 text-[11px] font-mono uppercase tracking-widest font-medium transition-all duration-200
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
          className={`flex-1 h-10 text-[11px] font-mono uppercase tracking-widest font-medium transition-all duration-200
                     border-l border-border
                     ${side === "offer"
                       ? "bg-primary text-primary-foreground"
                       : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                     }`}
        >
          OFFER (Seller)
        </button>
      </div>

      {/* Fields: Product, Price, Quantity, Upload Docs */}
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
        {/* Upload Docs field */}
        <div
          className={`focus-copper-line border-b transition-colors duration-500 sm:border-l border-border ${
            borderPulse ? "border-primary" : "border-border"
          }`}
        >
          <label
            className="block px-3 pt-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground select-none"
          >
            Upload Docs
          </label>
          <button
            type="button"
            disabled={disabled}
            className="w-full h-9 px-3 pb-2 text-[13px] font-mono bg-transparent
                       text-muted-foreground/30 hover:text-muted-foreground/50
                       flex items-center gap-2 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Add documents</span>
          </button>
        </div>
      </div>

      {/* Search button — right-aligned */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSearch || disabled}
          className={`h-10 px-8 font-mono text-[11px] uppercase tracking-widest font-medium
                   transition-all duration-300 disabled:cursor-not-allowed
                   flex items-center justify-center gap-2.5
                   focus:outline-none active:scale-[0.995]
                   ${isSearching
                     ? "bg-basalt text-basalt-foreground w-full"
                     : "bg-primary text-primary-foreground shadow-inner-metallic hover:opacity-90 disabled:opacity-30"
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
        className="block px-3 pt-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground select-none"
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
        className="w-full h-9 px-3 pb-2 text-[13px] font-mono bg-transparent
                   placeholder:text-muted-foreground/30 text-foreground
                   focus:outline-none border-none
                   transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
      />
    </div>
  );
}
