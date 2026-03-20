/**
 * Bloomberg-style bid/offer entry form — ultra-premium dark terminal aesthetic.
 * Pill-shaped toggles, borderless inputs with focus glow, rounded search button.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Upload } from "lucide-react";
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
    <form onSubmit={handleSubmit} className="p-4 space-y-4">
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
              setForm({ product: "", volume: "", price: "", location: "", additionalInfo: "" });
              setSide("bid");
            }}
            className="text-[11px] font-mono underline hover:opacity-80"
            style={{ color: 'var(--lt-emerald)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* BID / OFFER pill toggle */}
      <div className="inline-flex rounded-full p-1" style={{ backgroundColor: '#0D1220', border: '1px solid var(--lt-border)' }}>
        <button
          type="button"
          onClick={() => setSide("bid")}
          className="px-5 py-2 text-[11px] font-mono uppercase tracking-wider font-semibold rounded-full transition-all duration-200"
          style={{
            backgroundColor: side === "bid" ? 'var(--lt-panel)' : 'transparent',
            color: side === "bid" ? 'var(--lt-emerald)' : 'var(--lt-text-dim)',
            boxShadow: side === "bid" ? '0 0 12px rgba(16, 185, 129, 0.15)' : 'none',
          }}
        >
          BID (Buyer)
        </button>
        <button
          type="button"
          onClick={() => setSide("offer")}
          className="px-5 py-2 text-[11px] font-mono uppercase tracking-wider font-semibold rounded-full transition-all duration-200"
          style={{
            backgroundColor: side === "offer" ? 'var(--lt-panel)' : 'transparent',
            color: side === "offer" ? 'var(--lt-emerald)' : 'var(--lt-text-dim)',
            boxShadow: side === "offer" ? '0 0 12px rgba(16, 185, 129, 0.15)' : 'none',
          }}
        >
          OFFER (Seller)
        </button>
      </div>

      {/* Fields grid — borderless inputs with focus glow */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <PremiumField
          id="product" label="Product" required placeholder="Select product / asset"
          value={form.product} onChange={(v) => update("product", v)}
          disabled={disabled}
        />
        <PremiumField
          id="price" label="Price" placeholder="Enter price (ZAR/USD)"
          value={form.price} onChange={(v) => update("price", v)}
          disabled={disabled}
        />
        <PremiumField
          id="volume" label="Quantity" placeholder="Enter quantity"
          value={form.volume} onChange={(v) => update("volume", v)}
          disabled={disabled}
        />
        {/* Upload Docs — disabled */}
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wider font-medium mb-1.5 pl-1" style={{ color: 'var(--lt-text-dim)' }}>
            Upload Docs
          </label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="w-full h-10 px-3 text-[13px] font-mono flex items-center gap-2 opacity-40 cursor-not-allowed rounded-lg"
                  style={{ backgroundColor: '#111827', color: 'var(--lt-text-muted)' }}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Add documents</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">
                <p className="text-xs">Document uploads are available inside the dashboard after you sign in.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Search button — rounded-full with emerald glow */}
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
