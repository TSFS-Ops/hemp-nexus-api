/**
 * Izenzo Action Desk, progressive trade entry form.
 * Shows only Product initially. Reveals Price/Quantity/Region after product is selected.
 * No premature Buyer/Seller toggle, side defaults to "buyer" and is set later in the flow.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import { CommoditySelect } from "@/components/ui/commodity-select";

export interface TradeInterestData {
  product: string;
  volume: string;
  price: string;
  location: string;
  additionalInfo: string;
  side: "buyer" | "seller";
}

interface TradeInterestFormProps {
  onSearch: (data: TradeInterestData) => void;
  isSearching: boolean;
  isLocked?: boolean;
}

export function TradeInterestForm({ onSearch, isSearching, isLocked = false }: TradeInterestFormProps) {
  const [side, setSide] = useState<"buyer" | "seller" | null>(null);
  const [form, setForm] = useState({
    product: "",
    volume: "",
    price: "",
    location: "",
    additionalInfo: "",
  });

  const formRef = useRef(form);
  formRef.current = form;

  const getCurrentData = useCallback(() => {
    const f = formRef.current;
    const hasContent = f.product || f.volume || f.price || f.location;
    if (!hasContent) return null;
    return { side: (side || "buyer") as "buyer" | "seller", ...f };
  }, [side]);

  const { restoreDraft, saveDraft, clearDraft, hasRestoredDraft } = useDraftPersistence<{
    side: "buyer" | "seller";
    product: string;
    volume: string;
    price: string;
    location: string;
    additionalInfo: string;
  }>("trade-interest", getCurrentData);

  const [draftRestored, setDraftRestored] = useState(false);
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const draft = restoreDraft();
    if (draft) {
      setForm({
        product: draft.product || "",
        volume: draft.volume || "",
        price: draft.price || "",
        location: draft.location || "",
        additionalInfo: draft.additionalInfo || "",
      });
      if (draft.side) setSide(draft.side);
      setDraftRestored(true);
    }
  }, [restoreDraft]);

  useEffect(() => {
    if (!initialised.current) return;
    const hasContent = form.product || form.volume || form.price || form.location;
    if (hasContent) {
      saveDraft({ side: side || "buyer", ...form });
    }
  }, [form, saveDraft, side]);

  const update = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canSearch = form.product.trim().length > 0 && side !== null;
  const showDetails = form.product.trim().length > 0;

  const submittingRef = useRef(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSearch || isLocked || !side) return;
    if (submittingRef.current || isSearching) return;
    submittingRef.current = true;
    clearDraft();
    setDraftRestored(false);
    onSearch({ ...form, side });
    requestAnimationFrame(() => { submittingRef.current = false; });
  };

  const disabled = isLocked || isSearching;

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4">
      {/* Buyer / Seller toggle, first decision point */}
      <div>
        <label
          className="block text-[11px] font-mono uppercase tracking-wider font-medium mb-1.5 pl-1 select-none"
          style={{ color: 'var(--lt-text-dim)' }}
        >
          I am a<span className="ml-0.5" style={{ color: 'var(--lt-emerald)' }}>*</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSide("buyer")}
            className="h-12 rounded-lg font-mono text-[12px] uppercase tracking-wider font-semibold transition-all duration-200 border flex flex-col items-center justify-center gap-0"
            style={{
              backgroundColor: side === "buyer" ? 'var(--lt-emerald-dark)' : '#111827',
              color: side === "buyer" ? 'white' : 'var(--lt-text-dim)',
              borderColor: side === "buyer" ? 'var(--lt-emerald)' : 'transparent',
              boxShadow: side === "buyer" ? '0 0 12px rgba(5, 150, 105, 0.2)' : 'none',
            }}
          >
            <span>Buyer</span>
            <span className="text-[9px] font-normal normal-case tracking-normal opacity-60">Looking to purchase</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSide("seller")}
            className="h-12 rounded-lg font-mono text-[12px] uppercase tracking-wider font-semibold transition-all duration-200 border flex flex-col items-center justify-center gap-0"
            style={{
              backgroundColor: side === "seller" ? 'var(--lt-emerald-dark)' : '#111827',
              color: side === "seller" ? 'white' : 'var(--lt-text-dim)',
              borderColor: side === "seller" ? 'var(--lt-emerald)' : 'transparent',
              boxShadow: side === "seller" ? '0 0 12px rgba(5, 150, 105, 0.2)' : 'none',
            }}
          >
            <span>Seller</span>
            <span className="text-[9px] font-normal normal-case tracking-normal opacity-60">Looking to supply</span>
          </button>
        </div>
      </div>

      {/* Draft restored notice */}
      {draftRestored && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg"
             style={{ backgroundColor: 'var(--lt-panel)', border: '1px solid var(--lt-border)' }}>
          <span className="text-[11px] font-mono" style={{ color: 'var(--lt-text-muted)' }}>
            Draft restored from your previous session
          </span>
          <button
            type="button"
            onClick={() => {
              clearDraft();
              setDraftRestored(false);
              setSide(null);
              setForm({ product: "", volume: "", price: "", location: "", additionalInfo: "" });
            }}
            className="text-[11px] font-mono underline hover:opacity-80"
            style={{ color: 'var(--lt-emerald)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Product, always visible, primary entry point */}
      <div>
        <label
          htmlFor="product"
          className="block text-[11px] font-mono uppercase tracking-wider font-medium mb-1.5 pl-1 select-none"
          style={{ color: 'var(--lt-text-dim)' }}
        >
          What are you looking to trade?<span className="ml-0.5" style={{ color: 'var(--lt-emerald)' }}>*</span>
        </label>
        <CommoditySelect
          id="product"
          value={form.product}
          onChange={(v) => update("product", v)}
          disabled={disabled}
          placeholder="e.g. Soybeans, Copper, Crude Oil"
          variant="landing"
        />
      </div>

      {/* Additional fields, revealed progressively after product selection */}
      {showDetails && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-up">
          <PremiumField
            id="price" label="Price (optional)" placeholder="e.g. $495/MT"
            value={form.price} onChange={(v) => update("price", v)}
            disabled={disabled}
          />
          <PremiumField
            id="volume" label="Quantity (optional)" placeholder="e.g. 25,000 MT"
            value={form.volume} onChange={(v) => update("volume", v)}
            disabled={disabled}
          />
          <PremiumField
            id="location" label="Delivery Region (optional)" placeholder="e.g. Malawi, South Africa"
            value={form.location} onChange={(v) => update("location", v)}
            disabled={disabled}
          />
        </div>
      )}

      {/* Submit */}
      <div className="flex sm:justify-end">
        <button
          type="submit"
          disabled={!canSearch || disabled}
          className="h-10 px-8 font-mono text-[12px] uppercase tracking-wider font-semibold
                   transition-all duration-200 disabled:cursor-not-allowed
                   flex items-center justify-center gap-2.5
                   w-full sm:w-auto rounded-full"
          style={{
            backgroundColor: isSearching
              ? 'var(--lt-panel)'
              : canSearch && !disabled
                ? 'var(--lt-emerald-dark)'
                : 'var(--lt-panel)',
            color: canSearch && !disabled ? 'white' : 'var(--lt-text-dim)',
            boxShadow: canSearch && !disabled && !isSearching
              ? '0 0 20px rgba(5, 150, 105, 0.25)'
              : 'none',
          }}
        >
          {isSearching ? (
            <>
              <span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <ArrowRight className="h-3.5 w-3.5" />
              {side === "seller" ? "Submit Sell Interest" : side === "buyer" ? "Submit Buy Interest" : "Select Buy or Sell"}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function PremiumField({
  id, label, placeholder, value, onChange, required, disabled,
}: {
  id: string; label: string; placeholder: string; value: string;
  onChange: (v: string) => void; required?: boolean; disabled?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] font-mono uppercase tracking-wider font-medium mb-1.5 pl-1 select-none"
        style={{ color: 'var(--lt-text-dim)' }}
      >
        {label}
        {required && <span className="ml-0.5" style={{ color: 'var(--lt-emerald)' }}>*</span>}
      </label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-10 px-3 text-[13px] font-mono rounded-lg
                   border border-transparent
                   focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30
                   transition-all duration-200
                   disabled:opacity-40 disabled:cursor-not-allowed
                   placeholder:text-[var(--lt-text-dim)]"
        style={{
          backgroundColor: '#111827',
          color: 'var(--lt-text)',
          caretColor: 'var(--lt-emerald)',
        }}
      />
    </div>
  );
}
