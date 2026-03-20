/**
 * Bloomberg-style bid/offer entry form — dark terminal aesthetic.
 * Premium dark inputs with emerald focus states.
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
    <form onSubmit={handleSubmit}>
      {/* Draft restored notice */}
      {draftRestored && (
        <div className="flex items-center justify-between px-3 py-1.5" style={{ backgroundColor: 'var(--lt-panel)', borderBottom: '1px solid var(--lt-border)' }}>
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

      {/* BID / OFFER tabs */}
      <div className="flex" style={{ borderBottom: '1px solid var(--lt-border)' }}>
        <button
          type="button"
          onClick={() => setSide("bid")}
          className="flex-1 h-11 text-[12px] font-semibold uppercase tracking-wider transition-all duration-200"
          style={{
            backgroundColor: side === "bid" ? 'var(--lt-emerald-dark)' : 'transparent',
            color: side === "bid" ? 'white' : 'var(--lt-text-muted)',
          }}
        >
          BID (Buyer)
        </button>
        <button
          type="button"
          onClick={() => setSide("offer")}
          className="flex-1 h-11 text-[12px] font-semibold uppercase tracking-wider transition-all duration-200"
          style={{
            backgroundColor: side === "offer" ? 'var(--lt-emerald-dark)' : 'transparent',
            color: side === "offer" ? 'white' : 'var(--lt-text-muted)',
            borderLeft: '1px solid var(--lt-border)',
          }}
        >
          OFFER (Seller)
        </button>
      </div>

      {/* Fields grid */}
      <div className="grid grid-cols-1 sm:grid-cols-4">
        <TerminalField
          id="product" label="Product" required placeholder="Select product / asset"
          value={form.product} onChange={(v) => update("product", v)}
          disabled={disabled}
        />
        <TerminalField
          id="price" label="Price" placeholder="Enter price (ZAR/USD)"
          value={form.price} onChange={(v) => update("price", v)}
          disabled={disabled} borderLeft
        />
        <TerminalField
          id="volume" label="Quantity" placeholder="Enter quantity"
          value={form.volume} onChange={(v) => update("volume", v)}
          disabled={disabled} borderLeft
        />
        {/* Upload Docs — disabled */}
        <div
          style={{ borderBottom: '1px solid var(--lt-border)', borderLeft: '1px solid var(--lt-border)' }}
          className="hidden sm:block"
        >
          <label className="block px-3 pt-2.5 text-[11px] font-mono uppercase tracking-wider font-medium" style={{ color: 'var(--lt-text-dim)' }}>
            Upload Docs
          </label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full h-9 px-3 pb-2 text-[13px] font-mono flex items-center gap-2 opacity-40 cursor-not-allowed" style={{ color: 'var(--lt-text-muted)' }}>
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

      {/* Search button */}
      <div className="flex sm:justify-end">
        <button
          type="submit"
          disabled={!canSearch || disabled}
          className="h-11 sm:h-10 px-8 font-mono text-[12px] uppercase tracking-wider font-semibold
                   transition-all duration-200 disabled:cursor-not-allowed
                   flex items-center justify-center gap-2.5
                   w-full sm:w-auto rounded-none"
          style={{
            backgroundColor: isSearching
              ? 'var(--lt-panel)'
              : canSearch && !disabled
                ? 'var(--lt-emerald-dark)'
                : 'var(--lt-panel)',
            color: canSearch && !disabled ? 'white' : 'var(--lt-text-dim)',
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

function TerminalField({
  id, label, placeholder, value, onChange, required,
  disabled, borderLeft,
}: {
  id: string; label: string; placeholder: string; value: string;
  onChange: (v: string) => void; required?: boolean;
  disabled?: boolean; borderLeft?: boolean;
}) {
  return (
    <div
      style={{
        borderBottom: '1px solid var(--lt-border)',
        ...(borderLeft ? { borderLeft: '1px solid var(--lt-border)' } : {}),
      }}
      className="group"
    >
      <label
        htmlFor={id}
        className="block px-3 pt-2.5 text-[11px] font-mono uppercase tracking-wider font-medium select-none"
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
        className="w-full h-10 sm:h-9 px-3 pb-2 text-[13px] font-mono bg-transparent
                   focus:outline-none border-none
                   transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          color: 'var(--lt-text)',
          caretColor: 'var(--lt-emerald)',
        }}
      />
    </div>
  );
}
