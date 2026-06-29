/**
 * PayfastCancel — Phase 2J customer-facing cancel page.
 *
 * Static page shown when the customer cancels at PayFast. No DB writes.
 * No wallet credit.
 */
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PayfastCancel() {
  return (
    <div className="max-w-xl mx-auto py-16 px-4">
      <Card data-testid="payfast-cancel-card">
        <CardHeader>
          <CardTitle>Payment cancelled</CardTitle>
          <CardDescription>
            You cancelled the PayFast payment. No charge was made and no
            credits were added to your wallet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/desk/billing">Try again</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
