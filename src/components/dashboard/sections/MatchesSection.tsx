import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Shield } from "lucide-react";
import { MatchesList } from "@/components/MatchesList";

interface MatchesSectionProps {
  isDemoMode: boolean;
}

export function MatchesSection({ isDemoMode }: MatchesSectionProps) {
  if (isDemoMode) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Matches</h1>
          <p className="text-muted-foreground">
            View and manage trade matches with full audit trails
          </p>
        </div>
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">Login Required</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              View your real matches and evidence trails after signing in.
            </p>
            <Link to="/auth">
              <Button>
                <Shield className="h-4 w-4 mr-2" />
                Sign In to Access
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Matches</h1>
        <p className="text-muted-foreground">
          View and manage trade matches with full audit trails
        </p>
      </div>
      <MatchesList />
    </div>
  );
}
