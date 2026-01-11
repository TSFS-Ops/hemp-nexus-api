import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Zap, Globe } from "lucide-react";

interface SearchHeaderProps {
  query: string;
  setQuery: (query: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  isDemoMode: boolean;
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
  isDemoMode 
}: SearchHeaderProps) {
  return (
    <Card>
      <CardHeader className="pb-3 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          Find Counterparties
          {isDemoMode && (
            <Badge variant="outline" className="ml-auto text-[10px] sm:text-xs">
              Demo
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Enter a natural language query to discover trading partners
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="flex-1 relative">
            <Input
              placeholder="e.g., 'buyers for cashew in India'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              className="pr-10 h-10 sm:h-9 text-sm"
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

        {/* Example queries - scrollable on mobile */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
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
