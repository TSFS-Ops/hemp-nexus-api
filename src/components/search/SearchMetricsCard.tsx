import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowRight, TrendingUp, Globe, Shield, BookOpen } from "lucide-react";

interface SearchMetrics {
  baselineCount: number;
  enrichedCount: number;
  upliftPct: number;
  enrichmentReasons: Record<string, number>;
  orderBookMatches?: number;
}

interface SearchMetricsCardProps {
  metrics: SearchMetrics;
}

export function SearchMetricsCard({ metrics }: SearchMetricsCardProps) {
  const totalFound = metrics.baselineCount + metrics.enrichedCount + (metrics.orderBookMatches || 0);

  return (
    <Card className="bg-card border-border rounded-md shadow-none">
      <CardContent className="py-3 sm:py-4 px-3 sm:px-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
          {/* Source breakdown */}
          <div className="flex items-center gap-3 sm:gap-5">
            {/* Registry */}
            <Tooltip>
              <TooltipTrigger>
                <div className="text-center min-w-[40px]">
                  <div className="flex items-center justify-center gap-1">
                    <Shield className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-lg sm:text-2xl font-bold tabular-nums">{metrics.baselineCount}</span>
                  </div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground">Registry</div>
                </div>
              </TooltipTrigger>
              <TooltipContent>Registered trading partners on the platform</TooltipContent>
            </Tooltip>

            {/* Order Book */}
            {(metrics.orderBookMatches || 0) > 0 && (
              <>
                <span className="text-muted-foreground text-xs">+</span>
                <Tooltip>
                  <TooltipTrigger>
                    <div className="text-center min-w-[40px]">
                      <div className="flex items-center justify-center gap-1">
                        <BookOpen className="h-3.5 w-3.5 text-purple-500" />
                        <span className="text-lg sm:text-2xl font-bold tabular-nums">{metrics.orderBookMatches}</span>
                      </div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Orders</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Active trade orders matching your query</TooltipContent>
                </Tooltip>
              </>
            )}

            {/* Web Discovery */}
            {metrics.enrichedCount > 0 && (
              <>
                <span className="text-muted-foreground text-xs">+</span>
                <Tooltip>
                  <TooltipTrigger>
                    <div className="text-center min-w-[40px]">
                      <div className="flex items-center justify-center gap-1">
                        <Globe className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-lg sm:text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">{metrics.enrichedCount}</span>
                      </div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Web</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Companies discovered via AI-enriched web search</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>

          <Separator orientation="vertical" className="h-8 hidden sm:block" />

          {/* Total */}
          <div className="flex items-center gap-2">
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
            <div className="text-center">
              <div className="text-lg sm:text-2xl font-bold text-primary tabular-nums">
                {totalFound}
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground">Total</div>
            </div>
          </div>

          {/* Uplift indicator */}
          {metrics.enrichedCount > 0 && (
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-green-500 flex-shrink-0" />
              <div className="text-center">
                <div className="text-sm sm:text-lg font-bold text-green-600 dark:text-green-500 tabular-nums">
                  +{metrics.enrichedCount} web
                </div>
                <div className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
                  AI Discovery
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
