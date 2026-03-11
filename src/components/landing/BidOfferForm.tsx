/**
 * Structured bid/offer entry form — the primary first action.
 * Fields: Product, Volume, Price, Location, Additional information.
 * Runs search for all visitors (logged out users see preview outcomes).
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
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="product" className="block text-xs font-medium text-muted-foreground mb-1">
            Product / Commodity *
          </label>
          <input
            id="product"
            type="text"
            placeholder="e.g. Copper cathode, Soybeans"
            value={form.product}
            onChange={(e) => update("product", e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md
                     placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2
                     focus:ring-ring/30 focus:border-ring/40 transition-all"
          />
        </div>
        <div>
          <label htmlFor="volume" className="block text-xs font-medium text-muted-foreground mb-1">
            Volume
          </label>
          <input
            id="volume"
            type="text"
            placeholder="e.g. 2,500 MT"
            value={form.volume}
            onChange={(e) => update("volume", e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md
                     placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2
                     focus:ring-ring/30 focus:border-ring/40 transition-all"
          />
        </div>
        <div>
          <label htmlFor="price" className="block text-xs font-medium text-muted-foreground mb-1">
            Price
          </label>
          <input
            id="price"
            type="text"
            placeholder="e.g. USD 8,500/MT"
            value={form.price}
            onChange={(e) => update("price", e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md
                     placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2
                     focus:ring-ring/30 focus:border-ring/40 transition-all"
          />
        </div>
        <div>
          <label htmlFor="location" className="block text-xs font-medium text-muted-foreground mb-1">
            Location / Corridor
          </label>
          <input
            id="location"
            type="text"
            placeholder="e.g. Zambia, South Africa → India"
            value={form.location}
            onChange={(e) => update("location", e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md
                     placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2
                     focus:ring-ring/30 focus:border-ring/40 transition-all"
          />
        </div>
      </div>
      <div>
        <label htmlFor="additionalInfo" className="block text-xs font-medium text-muted-foreground mb-1">
          Additional information
        </label>
        <input
          id="additionalInfo"
          type="text"
          placeholder="e.g. Grade A, minimum lot size, delivery requirements"
          value={form.additionalInfo}
          onChange={(e) => update("additionalInfo", e.target.value)}
          className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md
                   placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2
                   focus:ring-ring/30 focus:border-ring/40 transition-all"
        />
      </div>
      <button
        type="submit"
        disabled={!canSearch || isSearching}
        className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground
                 rounded-md font-medium text-sm transition-colors disabled:opacity-50
                 disabled:cursor-not-allowed flex items-center justify-center gap-2
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {isSearching ? (
          <>
            <span className="h-4 w-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
            Searching…
          </>
        ) : (
          <>
            <Search className="h-4 w-4" />
            Search Counterparties
          </>
        )}
      </button>
    </form>
  );
}
