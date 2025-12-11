import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowRight, TrendingUp, Sparkles } from "lucide-react";

interface SearchMetrics {
  baselineCount: number;
  enrichedCount: number;
  upliftPct: number;
  enrichmentReasons: Record<string, number>;
}

interface SearchMetricsCardProps {
  metrics: SearchMetrics;
}

export function SearchMetricsCard({ metrics }: SearchMetricsCardProps) {
  return (
    <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
      <CardContent className="py-3 sm:py-4 px-3 sm:px-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Core metrics - always visible */}
          <div className="flex items-center gap-3 sm:gap-6">
            {/* Baseline */}
            <div className="text-center min-w-[40px]">
              <div className="text-lg sm:text-2xl font-bold tabular-nums">
                {metrics.baselineCount}
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground">
                Baseline
              </div>
            </div>
            
            <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
            
            {/* Total found */}
            <div className="text-center min-w-[40px]">
              <div className="text-lg sm:text-2xl font-bold text-primary tabular-nums">
                {metrics.enrichedCount}
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground">
                Found
              </div>
            </div>
          </div>

          {/* Separator - desktop only */}
          <Separator orientation="vertical" className="h-8 hidden sm:block" />

          {/* Uplift indicator */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-green-500 flex-shrink-0" />
            <div className="text-center">
              <div className="text-sm sm:text-lg font-bold text-green-600 dark:text-green-500 tabular-nums">
                +{metrics.upliftPct}%
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
                Uplift
              </div>
            </div>
          </div>

          {/* Enrichment reasons breakdown - desktop only */}
          {Object.keys(metrics.enrichmentReasons || {}).length > 0 && (
            <div className="hidden lg:flex gap-2">
              {Object.entries(metrics.enrichmentReasons).slice(0, 3).map(([reason, count]) => (
                <Tooltip key={reason}>
                  <TooltipTrigger>
                    <Badge variant="secondary" className="text-xs">
                      <Sparkles className="h-3 w-3 mr-1" />
                      {count}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs text-sm">{reason}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
