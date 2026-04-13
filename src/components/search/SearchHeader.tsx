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
  /** Current user side — optional, pre-populated from landing page URL params */
  side?: "bid" | "offer" | null;
  /** Called when user changes their side selection */
  onSideChange?: (side: "bid" | "offer") => void;
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
    <Card>
      <CardHeader className="pb-3 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          Find Trading Partners
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Select your role, then search for trading partners
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Side toggle — always visible so user can set/change role */}
        {onSideChange && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              I am a
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSearching}
                onClick={() => onSideChange("bid")}
                className={cn(
                  "h-10 rounded-lg text-xs font-semibold transition-all duration-200 border flex flex-col items-center justify-center gap-0",
                  side === "bid"
                    ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                    : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
                  isSearching && "opacity-50 cursor-not-allowed",
                )}
              >
                <span>Buyer</span>
                <span className="text-[9px] font-normal opacity-60">Bid — looking to purchase</span>
              </button>
              <button
                type="button"
                disabled={isSearching}
                onClick={() => onSideChange("offer")}
                className={cn(
                  "h-10 rounded-lg text-xs font-semibold transition-all duration-200 border flex flex-col items-center justify-center gap-0",
                  side === "offer"
                    ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                    : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
                  isSearching && "opacity-50 cursor-not-allowed",
                )}
              >
                <span>Seller</span>
                <span className="text-[9px] font-normal opacity-60">Offer — looking to supply</span>
              </button>
            </div>
          </div>
        )}

        {/* Search input */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="flex-1 relative">
            <Input
              placeholder="e.g., 'buyers for cashew in India'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              className="pr-10 h-10 sm:h-9 text-sm"
              aria-label="Search for trading partners"
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
