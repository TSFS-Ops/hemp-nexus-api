/**
 * Swiss-Terminal bid/offer entry — ledger-line input cells.
 * Fields: Product, Volume, Price, Location, Additional information.
 */

import { useState } from "react";
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
}

export function BidOfferForm({ onSearch, isSearching }: BidOfferFormProps) {
  const [form, setForm] = useState<BidOfferData>({
    product: "",
    volume: "",
    price: "",
    location: "",
    additionalInfo: "",
  });

  const update = (field: keyof BidOfferData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canSearch = form.product.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSearch) onSearch(form);
  };

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
        />
        <LedgerField
          id="volume"
          label="Volume"
          placeholder="2,500 MT"
          value={form.volume}
          onChange={(v) => update("volume", v)}
          className="sm:border-l border-border"
        />
        <LedgerField
          id="price"
          label="Price"
          placeholder="USD 8,500/MT"
          value={form.price}
          onChange={(v) => update("price", v)}
        />
        <LedgerField
          id="location"
          label="Location"
          placeholder="Zambia → India"
          value={form.location}
          onChange={(v) => update("location", v)}
          className="sm:border-l border-border"
        />
      </div>
      <LedgerField
        id="additionalInfo"
        label="Additional information"
        placeholder="Grade A, delivery requirements"
        value={form.additionalInfo}
        onChange={(v) => update("additionalInfo", v)}
        full
      />

      {/* Search — machined copper button */}
      <button
        type="submit"
        disabled={!canSearch || isSearching}
        className="w-full h-10 mt-0 bg-primary text-primary-foreground shadow-inner-metallic
                 font-mono text-[12px] uppercase tracking-widest font-medium
                 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed
                 hover:opacity-90 flex items-center justify-center gap-2
                 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {isSearching ? (
          <>
            <span className="h-3 w-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            Searching…
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
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  className?: string;
  full?: boolean;
}) {
  return (
    <div className={`border-b border-border ${full ? "" : ""} ${className}`}>
      <label
        htmlFor={id}
        className="block px-3 pt-2 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60"
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
        className="w-full h-8 px-3 pb-1.5 text-[13px] font-mono bg-transparent
                   placeholder:text-muted-foreground/25 text-foreground
                   focus:outline-none border-none
                   focus:bg-accent/30 transition-colors"
      />
    </div>
  );
}
