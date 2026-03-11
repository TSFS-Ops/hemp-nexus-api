/**
 * Terminal-like compact bid/offer entry — the primary first action.
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

const fieldClass =
  "w-full h-9 px-3 text-[13px] bg-background border border-border rounded-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring/40 focus:border-ring/50 transition-all font-sans";

const labelClass = "block text-[11px] font-medium text-muted-foreground mb-1 uppercase tracking-wider";

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
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="product" className={labelClass}>Product *</label>
          <input
            id="product"
            type="text"
            placeholder="e.g. Copper cathode"
            value={form.product}
            onChange={(e) => update("product", e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="volume" className={labelClass}>Volume</label>
          <input
            id="volume"
            type="text"
            placeholder="e.g. 2,500 MT"
            value={form.volume}
            onChange={(e) => update("volume", e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="price" className={labelClass}>Price</label>
          <input
            id="price"
            type="text"
            placeholder="e.g. USD 8,500/MT"
            value={form.price}
            onChange={(e) => update("price", e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="location" className={labelClass}>Location</label>
          <input
            id="location"
            type="text"
            placeholder="e.g. Zambia → India"
            value={form.location}
            onChange={(e) => update("location", e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor="additionalInfo" className={labelClass}>Additional information</label>
        <input
          id="additionalInfo"
          type="text"
          placeholder="e.g. Grade A, delivery requirements"
          value={form.additionalInfo}
          onChange={(e) => update("additionalInfo", e.target.value)}
          className={fieldClass}
        />
      </div>
      <button
        type="submit"
        disabled={!canSearch || isSearching}
        className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground
                 rounded-sm font-medium text-[13px] transition-colors disabled:opacity-40
                 disabled:cursor-not-allowed flex items-center justify-center gap-2
                 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {isSearching ? (
          <>
            <span className="h-3.5 w-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
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
