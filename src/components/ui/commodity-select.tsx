/**
 * CommoditySelect - Autocomplete combobox for commodity selection.
 *
 * Features:
 * - Grouped by category with visual separators
 * - Type-ahead search (label, category, HS code)
 * - Free-text fallback: if the user's input doesn't match, the raw text is kept
 * - Controlled component: value is the commodity label string
 * - Works identically in landing form (dark theme) and dashboard forms (light theme)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Check, ChevronsUpDown, Package } from "lucide-react";
import { searchCommodities, getCommoditiesByCategory, type CommodityEntry, type CommodityCategory } from "@/lib/commodity-taxonomy";
import { cn } from "@/lib/utils";
interface CommoditySelectProps {
  /** Current value (commodity label or free-text) */
  value: string;
  /** Called when the user selects or types a commodity */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Disable the input */
  disabled?: boolean;
  /** HTML id for label association */
  id?: string;
  /** Additional className for the outer wrapper */
  className?: string;
  /** Render variant */
  variant?: "default" | "landing";
}
export function CommoditySelect({
  value,
  onChange,
  placeholder = "Search or type a commodity…",
  disabled = false,
  id,
  className,
  variant = "default"
}: CommoditySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  // Build filtered results
  const results = searchCommodities(query || value);
  const grouped = groupResults(results);
  const flatResults = results; // for keyboard nav

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const selectItem = useCallback((entry: CommodityEntry) => {
    onChange(entry.label);
    setQuery("");
    setOpen(false);
    setHighlightIndex(-1);
  }, [onChange]);
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    onChange(v); // keep value in sync for free-text fallback
    if (!open) setOpen(true);
    setHighlightIndex(-1);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex(i => Math.min(i + 1, flatResults.length - 1));
      if (!open) setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightIndex >= 0 && flatResults[highlightIndex]) {
      e.preventDefault();
      selectItem(flatResults[highlightIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightIndex(-1);
    }
  };
  const isLanding = variant === "landing";
  return <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <input ref={inputRef} id={id} type="text" value={query || value} onChange={handleInputChange} onFocus={() => setOpen(true)} onKeyDown={handleKeyDown} placeholder={placeholder} disabled={disabled} autoComplete="off" className={cn("w-full pr-8 transition-all duration-200", isLanding ? ["h-10 px-3 text-[13px] font-mono rounded-lg", "border border-transparent", "focus:outline-none focus:border-[hsl(var(--emerald)/0.4)] focus:ring-1 focus:ring-emerald-500/30", "disabled:opacity-40 disabled:cursor-not-allowed", "placeholder:text-[var(--lt-text-dim)]"].join(" ") : ["flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm", "ring-offset-background placeholder:text-muted-foreground", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", "disabled:cursor-not-allowed disabled:opacity-50"].join(" "))} style={isLanding ? {
        backgroundColor: "#111827",
        color: "var(--lt-text)",
        caretColor: "var(--lt-emerald)"
      } : undefined} />
        <ChevronsUpDown className={cn("absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none", isLanding ? "text-[var(--lt-text-dim)]" : "text-muted-foreground")} />
      </div>

      {/* Dropdown */}
      {open && !disabled && <div ref={listRef} className={cn("absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border shadow-lg", isLanding ? "bg-[#111827] border-[var(--lt-border)]" : "bg-popover border-border")}>
          {flatResults.length === 0 ? <div className={cn("px-3 py-3 text-xs", isLanding ? "text-[var(--lt-text-dim)]" : "text-muted-foreground")}>
              <Package className="h-3.5 w-3.5 inline mr-1.5 opacity-60" /> No match found, your text will be used as-is </div> : Array.from(grouped.entries()).map(([category, items]) => <div key={category}>
                {/* Category header */}
                <div className={cn("px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider font-semibold sticky top-0", isLanding ? "text-[var(--lt-text-dim)] bg-[#0D1220] border-b border-[var(--lt-border)]" : "text-muted-foreground bg-muted/50 border-b")}>
                  {category}
                </div>
                {items.map(entry => {
          const globalIdx = flatResults.indexOf(entry);
          const isSelected = value === entry.label;
          const isHighlighted = globalIdx === highlightIndex;
          return <button key={entry.key} type="button" onMouseDown={e => {
            e.preventDefault(); // prevent blur
            selectItem(entry);
          }} onMouseEnter={() => setHighlightIndex(globalIdx)} className={cn("w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors", isLanding ? [isHighlighted ? "bg-[var(--lt-panel)]" : "", isSelected ? "text-[var(--lt-emerald)]" : "text-[var(--lt-text)]"].join(" ") : [isHighlighted ? "bg-accent" : "", isSelected ? "text-primary" : ""].join(" "))}>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                      <span className="flex-1 truncate">{entry.label}</span>
                      {entry.hsCode && <span className={cn("text-[10px] font-mono tabular-nums shrink-0", isLanding ? "text-[var(--lt-text-dim)]" : "text-muted-foreground")}>
                          HS {entry.hsCode}
                        </span>}
                    </button>;
        })}
              </div>)}
        </div>}
    </div>;
}

/** Group a flat list of results by category, preserving category order */
function groupResults(results: CommodityEntry[]): Map<CommodityCategory, CommodityEntry[]> {
  const map = new Map<CommodityCategory, CommodityEntry[]>();
  for (const r of results) {
    if (!map.has(r.category)) map.set(r.category, []);
    map.get(r.category)!.push(r);
  }
  return map;
}