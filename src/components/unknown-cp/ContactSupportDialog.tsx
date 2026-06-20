import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { UNKNOWN_CP_MESSAGE_MIN_CHARS } from "@/lib/unknown-cp-timeline";

interface Props { open: boolean; onOpenChange: (open: boolean) => void; facilitationCaseId: string; onCompleted?: () => void; }

export function ContactSupportDialog({ open, onOpenChange, facilitationCaseId, onCompleted }: Props) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (body.trim().length < UNKNOWN_CP_MESSAGE_MIN_CHARS) {
      toast({ title: "Message too short", description: `Please write at least ${UNKNOWN_CP_MESSAGE_MIN_CHARS} characters.`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("unknown-cp-user-action", {
        body: { facilitation_case_id: facilitationCaseId, action: "contact_support", message_body: body },
      });
      if (error) throw error;
      toast({ title: "Support contacted", description: "Your message has been linked to this facilitation case." });
      setBody("");
      onOpenChange(false);
      onCompleted?.();
    } catch (e) {
      toast({ title: "Could not submit", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contact Izenzo support</DialogTitle>
          <DialogDescription>Send a message linked to this facilitation case.</DialogDescription>
        </DialogHeader>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Sending…" : "Send"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
