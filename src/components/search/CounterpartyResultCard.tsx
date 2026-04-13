import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  CheckCircle, ExternalLink, Sparkles, Users, Lightbulb, Globe, Shield, Mail 
} from "lucide-react";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  score: number;
  isEnriched: boolean;
  enrichmentReason: string | null;
  whySurfaced: string;
  coherence: {
    score: number;
    passed: boolean;
    factors: string[];
  };
  metadata?: {
    web_discovered?: boolean;
    has_contact?: boolean;
    contact_masked?: boolean;
    verified?: boolean;
    [key: string]: any;
  };
}

interface CounterpartyResultCardProps {
  result: SearchResult;
  rank: number;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onFindSimilar?: (result: SearchResult) => void;
  /** The current user's side — used to infer the counterparty's role */
  userSide?: "bid" | "offer";
}

function getSourceLabel(source: string): { label: string; icon: React.ReactNode; color: string } {
  switch (source) {
    case "verified_registry":
      return { label: "Verified", icon: <Shield className="h-2.5 w-2.5 sm:h-3 sm:w-3" />, color: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300" };
    case "counterparty_registry":
      return { label: "Registered", icon: <Shield className="h-2.5 w-2.5 sm:h-3 sm:w-3" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" };
    case "order_book":
      return { label: "Order Book", icon: <Sparkles className="h-2.5 w-2.5 sm:h-3 sm:w-3" />, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300" };
    case "web_discovery":
      return { label: "Web Discovery", icon: <Globe className="h-2.5 w-2.5 sm:h-3 sm:w-3" />, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" };
    default:
      return { label: source, icon: null, color: "" };
  }
}

export function CounterpartyResultCard({ 
  result, 
  rank, 
  isSelected, 
  onToggleSelect,
  onFindSimilar,
  userSide,
}: CounterpartyResultCardProps) {
  const sourceInfo = getSourceLabel(result.source);
  const isWebDiscovered = result.source === "web_discovery" || result.metadata?.web_discovered;
  const hasContact = result.metadata?.has_contact;

  return (
    <Card 
      className={`transition-all cursor-pointer hover:border-primary/50 ${
        isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : ""
      }`}
      onClick={() => onToggleSelect(result.id)}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex gap-3">
          {/* Rank/Selection indicator */}
          <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
            <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
              isSelected 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted text-muted-foreground"
            }`}>
              {isSelected ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                rank
              )}
            </div>
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              {Math.round(result.score * 100)}%
            </span>
          </div>

          {/* Content area */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Header row: Title + source badge */}
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-medium text-sm sm:text-base leading-snug line-clamp-1 sm:line-clamp-none">
                {result.title}
              </h4>
              
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Counterparty role badge — inferred from user's side */}
                {userSide && (
                  <Badge 
                    variant="outline" 
                    className={`text-[10px] sm:text-xs px-1.5 py-0 h-5 gap-0.5 ${
                      userSide === "bid" 
                        ? "border-orange-300 text-orange-700 dark:border-orange-600 dark:text-orange-300" 
                        : "border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-300"
                    }`}
                  >
                    {userSide === "bid" ? "Seller" : "Buyer"}
                  </Badge>
                )}
                <Badge 
                  variant="secondary" 
                  className={`${sourceInfo.color} text-[10px] sm:text-xs px-1.5 py-0 h-5 gap-0.5`}
                >
                  {sourceInfo.icon}
                  <span className="hidden sm:inline">{sourceInfo.label}</span>
                </Badge>
              </div>
            </div>
            
            {/* Description */}
            <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">
              {result.description}
            </p>

            {/* Contact indicator for web-discovered results */}
            {isWebDiscovered && hasContact && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" />
                <span>Contact available — visible after match creation</span>
              </div>
            )}

            {/* Why Surfaced - hidden on mobile */}
            <div className="hidden sm:flex items-start gap-1.5 pt-0.5">
              <Lightbulb className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground italic line-clamp-1">
                {result.whySurfaced}
              </p>
            </div>

            {/* Coherence & factors row */}
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <div className="flex items-center gap-1">
                <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${
                  result.coherence.passed ? "bg-green-500" : "bg-yellow-500"
                }`} />
                <span className="text-[10px] sm:text-xs text-muted-foreground">
                  {Math.round(result.coherence.score * 100)}%
                </span>
              </div>
              
              {result.coherence.factors.length > 0 && (
                <>
                  <Badge 
                    variant="outline" 
                    className="text-[10px] sm:text-xs py-0 h-4 sm:h-5 px-1.5"
                  >
                    {result.coherence.factors[0]}
                  </Badge>
                  {result.coherence.factors.length > 1 && (
                    <Badge 
                      variant="outline" 
                      className="text-[10px] sm:text-xs py-0 h-4 sm:h-5 px-1.5 hidden sm:inline-flex"
                    >
                      {result.coherence.factors[1]}
                    </Badge>
                  )}
                  {result.coherence.factors.length > 2 && (
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">
                      +{result.coherence.factors.length - 2}
                    </span>
                  )}
                  {result.coherence.factors.length > 1 && (
                    <span className="text-[10px] text-muted-foreground sm:hidden">
                      +{result.coherence.factors.length - 1}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Actions row */}
            <div className="flex items-center gap-1.5 sm:gap-2 pt-1.5 sm:pt-2">
              {result.url !== "#" && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 sm:h-7 text-xs px-2 sm:px-3 touch-target" 
                  asChild
                >
                  <a 
                    href={result.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    <span className="hidden xs:inline">View </span>Website
                  </a>
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-8 sm:h-7 text-xs px-2 sm:px-3 touch-target" 
                    onClick={(e) => {
                      e.stopPropagation();
                      onFindSimilar?.(result);
                    }}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    Similar
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Show trading partners similar to this one</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
