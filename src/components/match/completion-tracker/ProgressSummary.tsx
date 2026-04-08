/**
 * ProgressSummary - Overall deal progress bar and recommended next action.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import type { CompletionState, TrackerAction } from "@/lib/completion-engine";

interface ProgressSummaryProps {
  state: CompletionState;
  onAction: (action: TrackerAction) => void;
}

export function ProgressSummary({ state, onAction }: ProgressSummaryProps) {
  const { stages, overallPct, recommendedAction, summary } = state;
  const completedCount = stages.filter(s => s.status === "complete").length;
  const blockedCount = stages.filter(s => s.status === "blocked").length;
  const allDone = completedCount === stages.length;

  return (
    <Card className={allDone ? "border-success/30" : blockedCount > 0 ? "border-destructive/30" : ""}>
      <CardContent className="pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Deal Progress to Finality</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {completedCount} of {stages.length} stages complete
            </p>
          </div>
          <div className="flex items-center gap-1">
            {stages.map((s, i) => (
              <div key={i} className="flex items-center">
                <div className={`h-3 w-3 rounded-full ${
                  s.status === "complete" ? "bg-success" :
                  s.status === "in_progress" ? "bg-primary" :
                  s.status === "blocked" ? "bg-destructive" :
                  "bg-muted"
                }`} />
                {i < stages.length - 1 && (
                  <div className={`h-0.5 w-6 ${
                    s.status === "complete" ? "bg-success" : "bg-muted"
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <Progress value={overallPct} className="h-2" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {allDone ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-success font-medium">{summary}</span>
              </>
            ) : blockedCount > 0 ? (
              <>
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-destructive font-medium">{summary}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{summary}</span>
            )}
          </div>
          {recommendedAction && (
            <Button size="sm" variant="default" onClick={() => onAction(recommendedAction)} className="h-7 text-xs">
              <ArrowRight className="h-3.5 w-3.5 mr-1" />
              {recommendedAction.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
