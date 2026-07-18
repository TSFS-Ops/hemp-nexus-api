import { Card } from "@/components/ui/card";
import { Undo2 } from "lucide-react";

export default function ComplianceAppeals() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Appeals</h2>
        <p className="text-sm text-muted-foreground">
          Appeals for Rejected, Blocked, Suspended or materially-conditioned Approved outcomes.
          Appeal window: 10 business days. Reviewer must not have participated in the original
          decision.
        </p>
      </div>
      <Card className="p-8">
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <Undo2 className="h-8 w-8 opacity-60" />
          <div className="font-medium text-foreground">No appeals in flight</div>
          <div className="max-w-md">
            Submitted appeals will appear here with their basis, reviewer assignment and outcome.
            Original decisions remain effective until an appeal is expressly upheld.
          </div>
        </div>
      </Card>
    </div>
  );
}
