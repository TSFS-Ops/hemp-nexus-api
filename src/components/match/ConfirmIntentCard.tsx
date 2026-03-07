/**
 * ConfirmIntentCard — CTA card for declaring intent on a match.
 *
 * Single Responsibility: confirm-intent action presentation + trigger.
 */

import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ConfirmIntentCardProps {
  onConfirm: () => void;
  loading: boolean;
}

export function ConfirmIntentCard({ onConfirm, loading }: ConfirmIntentCardProps) {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="pt-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="font-semibold">Ready to Confirm Intent?</h4>
            <p className="text-sm text-muted-foreground">
              Upload any supporting documents above first. 500 credits will be deducted. No legal obligation is created.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LoadingButton
              onClick={onConfirm}
              loading={loading}
              size="lg"
              loadingText="Confirming…"
            >
              Confirm Intent
            </LoadingButton>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Confirms your intent and burns 500 credits. This creates an immutable proof record that will appear in your logs.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
