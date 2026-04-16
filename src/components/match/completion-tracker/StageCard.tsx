/**
 * StageCard - Renders a single completion stage with status, substeps, and actions.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Lock,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ShieldCheck,
  FileCheck,
  Truck,
  Shield,
  Info,
} from "lucide-react";
import { useState } from "react";
import type { StageState, TrackerAction, StageId, StageStatus, UserRole } from "@/lib/completion-engine";

function hasRoleAccess(current: UserRole, required: UserRole | null): boolean {
  if (!required) return true;
  const hierarchy: Record<UserRole, number> = { org_member: 0, org_admin: 1, platform_admin: 2 };
  return hierarchy[current] >= hierarchy[required];
}

const STAGE_ICONS: Record<StageId, React.ReactNode> = {
  poi: <ShieldCheck className="h-5 w-5" />,
  wad: <FileCheck className="h-5 w-5" />,
  pod: <Truck className="h-5 w-5" />,
  evidence: <Shield className="h-5 w-5" />,
};

const STAGE_EXPLAINERS: Record<StageId, string> = {
  poi: "A Proof of Intent records both parties\u2019 confirmed interest in a trade. It is the first binding evidence step.",
  wad: "Without a Doubt \u2014 a sealed, tamper-evident evidence bundle confirming the full trade trail. Not a contract, but a \u2018proof bundle\u2019.",
  pod: "Tracks fulfilment milestones after the deal is sealed. Each milestone must be completed in sequence.",
  evidence: "A cryptographically hashed archive of all documents, attestations, and audit records for this trade.",
};

function statusIcon(status: StageStatus) {
  switch (status) {
    case "complete": return <CheckCircle2 className="h-5 w-5 text-success" />;
    case "in_progress": return <Clock className="h-5 w-5 text-primary animate-pulse" />;
    case "blocked": return <AlertTriangle className="h-5 w-5 text-destructive" />;
    case "pending": return <Circle className="h-5 w-5 text-muted-foreground" />;
    case "not_started": return <Circle className="h-5 w-5 text-muted-foreground/40" />;
  }
}

const STATUS_LABELS: Record<StageStatus, string> = {
  complete: "Complete",
  in_progress: "In Progress",
  blocked: "Blocked",
  pending: "Pending",
  not_started: "Not Started",
};

const STATUS_VARIANTS: Record<StageStatus, "default" | "secondary" | "destructive" | "outline"> = {
  complete: "default",
  in_progress: "secondary",
  blocked: "destructive",
  pending: "outline",
  not_started: "outline",
};

interface StageCardProps {
  stage: StageState;
  userRole: UserRole;
  onAction: (action: TrackerAction) => void;
  defaultExpanded?: boolean;
}

export function StageCard({ stage, userRole, onAction, defaultExpanded = false }: StageCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || stage.status === "in_progress" || stage.status === "blocked");

  const allowedActions = stage.actions.filter(a => a.allowed && hasRoleAccess(userRole, a.requiredRole));
  const blockedActions = stage.actions.filter(a => !a.allowed || !hasRoleAccess(userRole, a.requiredRole));
  const recommendedAction = stage.actions.find(a => a.isRecommended);

  return (
    <Card className={stage.status === "blocked" ? "border-destructive/50" : stage.status === "complete" ? "border-success/30" : ""}>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {statusIcon(stage.status)}
            <div className="flex items-center gap-2">
              {STAGE_ICONS[stage.id]}
              <CardTitle className="text-base">{stage.label}</CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-sm">
                    {STAGE_EXPLAINERS[stage.id]}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANTS[stage.status]}>{STATUS_LABELS[stage.status]}</Badge>
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
        <div className="mt-2">
          <Progress value={stage.completionPct} className="h-1.5" />
          <p className="text-xs text-muted-foreground mt-1">{stage.completionPct}% complete</p>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Detail */}
          <p className="text-sm text-muted-foreground">{stage.detail}</p>

          {/* Recommended action callout */}
          {recommendedAction && recommendedAction.allowed && hasRoleAccess(userRole, recommendedAction.requiredRole) && (
            <div className="flex items-center gap-3 p-3 rounded-md bg-primary/5 border border-primary/20">
              <ArrowRight className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{recommendedAction.label}</p>
                <p className="text-xs text-muted-foreground">{recommendedAction.description}</p>
              </div>
              <Button size="sm" onClick={() => onAction(recommendedAction)} className="shrink-0">
                Go
              </Button>
            </div>
          )}

          {/* Substeps */}
          {stage.substeps.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Checklist</p>
              {stage.substeps.map((sub, j) => (
                <div key={j} className="flex items-start gap-2 text-sm">
                  {sub.done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className={sub.done ? "text-foreground" : "text-muted-foreground"}>{sub.label}</span>
                    {sub.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5">{sub.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Available actions */}
          {allowedActions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Available Actions</p>
              <div className="flex flex-wrap gap-2">
                {allowedActions
                  .filter(a => a !== recommendedAction)
                  .map(action => (
                    <Button
                      key={action.id}
                      size="sm"
                      variant="outline"
                      onClick={() => onAction(action)}
                      className="h-8 text-xs"
                    >
                      {action.label}
                    </Button>
                  ))}
              </div>
            </div>
          )}

          {/* Blocked actions with reasons */}
          {blockedActions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unavailable</p>
              <TooltipProvider>
                <div className="flex flex-wrap gap-2">
                  {blockedActions.map(action => (
                    <Tooltip key={action.id}>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled
                          className="h-8 text-xs opacity-50 cursor-not-allowed"
                        >
                          {!hasRoleAccess(userRole, action.requiredRole) && <Lock className="h-3 w-3 mr-1" />}
                          {action.label}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs">
                        {!hasRoleAccess(userRole, action.requiredRole)
                          ? `Requires ${action.requiredRole} role`
                          : action.blockedReason || "This action is not available in the current state"}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </TooltipProvider>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
