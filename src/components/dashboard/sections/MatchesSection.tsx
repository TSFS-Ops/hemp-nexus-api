import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Shield } from "lucide-react";
import { MatchesList } from "@/components/MatchesList";
import { SectionHeader } from "@/components/ui/section-header";

interface MatchesSectionProps {
  isDemoMode: boolean;
}

export function MatchesSection({ isDemoMode }: MatchesSectionProps) {
  if (isDemoMode) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <SectionHeader
          title="Matches"
          description="View and manage trade matches with full audit trails"
        />
        <Card className="border-dashed">
          <CardContent className="py-10 sm:py-12 text-center px-4">
            <Lock className="h-10 w-10 sm:h-12 sm:w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">Login Required</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4 leading-relaxed">
              View your real matches and evidence trails after signing in.
            </p>
            <Link to="/auth">
              <Button className="touch-target">
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
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Your Matches"
        description="Review matches, confirm intent, and download evidence packs"
      />
      <MatchesList />
    </div>
  );
}
