/**
 * MT-009 Phase 2 - Assign Named Contact dialog.
 *
 * Records a controlled named contact on a side. Calls the
 * `match-named-contacts-assign` edge function. Display-text guarantee:
 * "This records the named authorised contact for audit. It does not
 *  invite, email, or notify them."
 *
 * Modal-standard: includes Close/X (via shadcn Dialog default).
 * Zero Swallowed Errors: try/catch/finally with toast errors and reset state.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  assignNamedContact,
  AssignNamedContactError,
  type NamedContactSide,
} from "@/lib/match-named-contacts";

interface AssignNamedContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matchId: string;
  side: NamedContactSide;
  isReplacement: boolean;
  onSaved: () => void;
}

function humaniseError(code: string): string {
  switch (code) {
    case "MFA_REQUIRED":
      return "This override requires multi-factor authentication. Complete an MFA challenge and try again.";
    case "FORBIDDEN":
      return "You do not have permission to assign a named contact for this side.";
    case "SIDE_HAS_NO_ORG":
      return "This side has no organisation attached.";
    case "MATCH_NOT_FOUND":
      return "Match not found.";
    case "VALIDATION_ERROR":
      return "The contact details are not valid. Check the name and email and try again.";
    case "IDEMPOTENCY_KEY_REQUIRED":
      return "Internal error: missing idempotency key. Please retry.";
    default:
      return "Could not save the named contact. Please try again.";
  }
}

export function AssignNamedContactDialog({
  open,
  onOpenChange,
  matchId,
  side,
  isReplacement,
  onSaved,
}: AssignNamedContactDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setNotes("");
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit =
    !submitting && name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await assignNamedContact({
        matchId,
        side,
        contactName: name,
        contactEmail: email,
        notes: notes.trim() || undefined,
      });
      toast.success(
        isReplacement ? "Named contact replaced." : "Named contact saved.",
      );
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const code =
        err instanceof AssignNamedContactError ? err.code : "ASSIGN_FAILED";
      toast.error(humaniseError(code));
    } finally {
      setSubmitting(false);
    }
  };

  const sideLabel = side === "buyer" ? "Buyer" : "Seller";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="assign-named-contact-dialog">
        <DialogHeader>
          <DialogTitle>
            {isReplacement
              ? `Replace ${sideLabel.toLowerCase()} named contact`
              : `Assign ${sideLabel.toLowerCase()} named contact`}
          </DialogTitle>
          <DialogDescription>
            This records the named authorised contact for audit. It does not
            invite, email, or notify them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="mnc-name">Full name</Label>
            <Input
              id="mnc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sarah Anderson"
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mnc-email">Email</Label>
            <Input
              id="mnc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@example.com"
              maxLength={254}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mnc-notes">Notes (optional)</Label>
            <Textarea
              id="mnc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Context for the audit trail (optional)"
            />
          </div>
          {isReplacement && (
            <Alert>
              <AlertDescription className="text-xs">
                The current active contact will be marked as <strong>replaced</strong>
                {" "}and kept for audit history.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isReplacement ? "Replace contact" : "Save contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AssignNamedContactDialog;
