import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Props { open: boolean; onOpenChange: (open: boolean) => void; facilitationCaseId: string; onCompleted?: () => void; }

export function CancelRequestDialog({ open, onOpenChange, facilitationCaseId, onCompleted }: Props) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("unknown-cp-user-action", {
        body: { facilitation_case_id: facilitationCaseId, action: "cancel_request" },
      });
      if (error) throw error;
      toast({ title: "Request cancelled", description: "No further outreach will be recorded under this case." });
      onOpenChange(false);
      onCompleted?.();
    } catch (e) {
      toast({ title: "Could not cancel", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this facilitation request?</DialogTitle>
          <DialogDescription>
            This will stop further outreach under this unknown-counterparty case. You can create a new request if needed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Keep open</Button></DialogClose>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting ? "Cancelling…" : "Confirm cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
