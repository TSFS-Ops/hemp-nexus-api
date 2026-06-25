/**
 * P-5 Batch 3 — Stage 5 grant-state helper.
 *
 * Renders an inline "unavailable" panel for expired/revoked/missing grants
 * or generic edge-function denials. Funder surfaces import this so that
 * denied states never accidentally render summary data.
 */
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function P5B3FunderUnavailable({
  reason,
  message,
}: {
  reason?: string;
  message?: string;
}) {
  let title = "Access unavailable";
  let body = "This release is not currently available to your funder account.";
  if (reason === "grant_expired") {
    title = "Access expired";
    body = "Your access to this transaction has expired. Contact Izenzo to request renewal.";
  } else if (reason === "grant_revoked") {
    title = "Access revoked";
    body = "Your access to this transaction has been revoked by Izenzo.";
  } else if (reason === "no_active_grant") {
    title = "No active grant";
    body = "You do not have an active access grant for this transaction.";
  } else if (reason === "auth_required") {
    title = "Sign-in required";
    body = "Please sign in with your authorised funder account.";
  } else if (message) {
    body = message;
  }
  return (
    <Card data-testid="p5b3-funder-unavailable">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        <p>{body}</p>
        <p>
          <Link to="/funder/p5-batch3" className="underline">
            Return to funder workspace
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
