/**
 * Batch V-UI — Friendly IDV blocker notice.
 *
 * Rendered on any controlled-action surface when the server returns HTTP
 * 409 with a blocker code starting `IDV_`. Never renders raw JSON, stack
 * traces, provider payloads, or internal table names.
 */

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export interface IdvBlockerNoticeProps {
  blocker_code: string;
  user_message?: string | null;
  action_label?: string;
  className?: string;
}

const CODE_TITLES: Record<string, string> = {
  IDV_REQUIRED_WAD_SEAL: "Identity verification required before WaD sealing",
  IDV_REQUIRED_FINALITY: "Identity verification required before finality",
  IDV_REQUIRED_FUNDER_READY: "Not ready — identity verification required",
  IDV_REQUIRED_API_READY: "Not ready — identity verification required",
  IDV_REQUIRED_BINDING_POI:
    "Identity verification required before binding this Proof of Intent",
  IDV_REQUIRED_EVIDENCE_APPROVAL:
    "Identity verification required before approving evidence",
  IDV_REQUIRED_TRANSACTION_APPROVAL:
    "Identity verification required before this transaction",
  IDV_REQUIRED_NO_SUBJECT:
    "Identity verification required before this action",
};

export function IdvBlockerNotice({
  blocker_code,
  user_message,
  action_label = "Start identity verification",
  className,
}: IdvBlockerNoticeProps) {
  const title = CODE_TITLES[blocker_code] ?? "Identity verification required";
  return (
    <Alert
      variant="default"
      className={className}
      data-testid="idv-blocker-notice"
      data-blocker-code={blocker_code}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="mt-2 flex flex-col gap-3">
        <span>
          {user_message ??
            "This action is blocked until identity verification is completed or manual review is accepted."}
        </span>
        <div>
          <Button asChild size="sm" variant="outline">
            <Link to="/desk/idv/start">{action_label}</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Parse an error response body from a controlled-action call. Returns
 * blocker props if the response is a recognised IDV block, otherwise
 * null.
 */
export function parseIdvBlockerResponse(
  status: number,
  body: unknown,
): { blocker_code: string; user_message?: string | null } | null {
  if (status !== 409) return null;
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const code = typeof rec.blocker_code === "string" ? rec.blocker_code : null;
  if (!code || !code.startsWith("IDV_")) return null;
  return {
    blocker_code: code,
    user_message:
      typeof rec.user_message === "string" ? rec.user_message : null,
  };
}
