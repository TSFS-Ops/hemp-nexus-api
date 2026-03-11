/**
 * Swiss-Terminal bid/offer entry — ledger-line input cells.
 * Supports locked state during cryptographic scan phase.
 */

import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";

export interface BidOfferData {
  product: string;
  volume: string;
  price: string;
  location: string;
  additionalInfo: string;
}

interface BidOfferFormProps {
  onSearch: (data: BidOfferData) => void;
  isSearching: boolean;
  isLocked?: boolean;
}

export function BidOfferForm({ onSearch, isSearching, isLocked = false }: BidOfferFormProps) {
  const [form, setForm] = useState<BidOfferData>({
    product: "",
    volume: "",
    price: "",
    location: "",
    additionalInfo: "",
  });
  const [borderPulse, setBorderPulse] = useState(false);

  // Pulse borders when locking
  useEffect(() => {
    if (isLocked) {
      setBorderPulse(true);
      const t = setTimeout(() => setBorderPulse(false), 800);
      return () => clearTimeout(t);
    }
  }, [isLocked]);

  const update = (field: keyof BidOfferData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canSearch = form.product.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSearch && !isLocked) onSearch(form);
  };

  const disabled = isLocked || isSearching;

  return (
    <form onSubmit={handleSubmit}>
      {/* Ledger-line grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <LedgerField
          id="product"
          label="Product"
          required
          placeholder="Copper cathode"
          value={form.product}
          onChange={(v) => update("product", v)}
          disabled={disabled}
          pulsingBorder={borderPulse}
        />
        <LedgerField
          id="volume"
          label="Volume"
          placeholder="2,500 MT"
          value={form.volume}
          onChange={(v) => update("volume", v)}
          className="sm:border-l border-border"
          disabled={disabled}
          pulsingBorder={borderPulse}
        />
        <LedgerField
          id="price"
          label="Price"
          placeholder="USD 8,500/MT"
          value={form.price}
          onChange={(v) => update("price", v)}
          disabled={disabled}
          pulsingBorder={borderPulse}
        />
        <LedgerField
          id="location"
          label="Location"
          placeholder="Zambia → India"
          value={form.location}
          onChange={(v) => update("location", v)}
          className="sm:border-l border-border"
          disabled={disabled}
          pulsingBorder={borderPulse}
        />
      </div>
      <LedgerField
        id="additionalInfo"
        label="Additional information"
        placeholder="Grade A, delivery requirements"
        value={form.additionalInfo}
        onChange={(v) => update("additionalInfo", v)}
        full
        disabled={disabled}
        pulsingBorder={borderPulse}
      />

      {/* Search button — Phase 1: shifts to basalt "EXECUTING..." when scanning */}
      <button
        type="submit"
        disabled={!canSearch || disabled}
        className={`w-full h-10 mt-0 font-mono text-[12px] uppercase tracking-widest font-medium
                 transition-all duration-300 disabled:cursor-not-allowed
                 flex items-center justify-center gap-2
                 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring
                 ${isSearching
                   ? "bg-basalt text-basalt-foreground"
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
    </form>
  );
}

function LedgerField({
  id,
  label,
  placeholder,
  value,
  onChange,
  required,
  className = "",
  full,
  disabled,
  pulsingBorder,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  className?: string;
  full?: boolean;
  disabled?: boolean;
  pulsingBorder?: boolean;
}) {
  return (
    <div
      className={`border-b transition-colors duration-500 ${
        pulsingBorder ? "border-primary" : "border-border"
      } ${className}`}
    >
      <label
        htmlFor={id}
        className="block px-3 pt-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
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
        className="w-full h-8 px-3 pb-1.5 text-[13px] font-mono bg-transparent
                   placeholder:text-muted-foreground/25 text-foreground
                   focus:outline-none border-none
                   focus:bg-accent/30 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
