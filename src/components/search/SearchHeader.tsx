import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Zap, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchHeaderProps {
  query: string;
  setQuery: (query: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  /** Current user side, optional, pre-populated from landing page URL params */
  side?: "buyer" | "seller" | null;
  /** Called when user changes their side selection */
  onSideChange?: (side: "buyer" | "seller") => void;
}

const EXAMPLE_QUERIES = [
  "buyers for cashew in India",
  "copper cathode suppliers",
  "hemp fibre wholesalers South Africa",
];

export function SearchHeader({ 
  query, 
  setQuery, 
  onSearch, 
  isSearching,
  side,
  onSideChange,
}: SearchHeaderProps) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          Find Counterparties + Company Register
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          One search checks counterparties and the company register together
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Side toggle, always visible so user can set/change role.
            Styled as a deeply interactive segmented control: the active
            side gets a strong filled background and shadow so the
            persona choice is unmistakable. */}
        {onSideChange && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              I am a
            </label>
            <div
              role="tablist"
              aria-label="Trade persona"
              className="inline-flex w-full p-1 rounded-lg bg-slate-100 border border-slate-200 shadow-inner"
            >
              <button
                type="button"
                role="tab"
                aria-selected={side === "buyer"}
                disabled={isSearching}
                onClick={() => onSideChange("buyer")}
                className={cn(
                  "flex-1 h-10 rounded-md text-xs font-semibold transition-all duration-200 flex flex-col items-center justify-center gap-0",
                  side === "buyer"
                    ? "bg-card text-slate-900 ring-1 ring-slate-300"
                    : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/40",
                  isSearching && "opacity-50 cursor-not-allowed",
                )}
              >
                <span>Buyer</span>
                <span className="text-[9px] font-normal opacity-70">Looking to purchase</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={side === "seller"}
                disabled={isSearching}
                onClick={() => onSideChange("seller")}
                className={cn(
                  "flex-1 h-10 rounded-md text-xs font-semibold transition-all duration-200 flex flex-col items-center justify-center gap-0",
                  side === "seller"
                    ? "bg-card text-slate-900 ring-1 ring-slate-300"
                    : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/40",
                  isSearching && "opacity-50 cursor-not-allowed",
                )}
              >
                <span>Seller</span>
                <span className="text-[9px] font-normal opacity-70">Looking to supply</span>
              </button>
            </div>
          </div>
        )}

        {/* Search input */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="flex-1 relative">
            <Input
              placeholder="Search counterparties and registered companies"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              className="pr-10 h-10 sm:h-9 text-sm"
              aria-label="Search counterparties and the company register"
            />
            <Globe className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
          <Button 
            onClick={onSearch} 
            disabled={isSearching} 
            className="h-10 sm:h-9 w-full sm:w-auto touch-target"
          >
            {isSearching ? (
              <>
                <Zap className="h-4 w-4 mr-2 animate-pulse" />
                Searching...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Search
              </>
            )}
          </Button>
        </div>

        {/* Example queries */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
            Try:
          </span>
          {EXAMPLE_QUERIES.map((example) => (
            <button
              key={example}
              onClick={() => setQuery(example)}
              className="text-[10px] sm:text-xs text-primary hover:underline whitespace-nowrap flex-shrink-0"
            >
              "{example}"
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
