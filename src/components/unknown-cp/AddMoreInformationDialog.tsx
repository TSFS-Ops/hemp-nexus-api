import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  UNKNOWN_CP_ATTACHMENT_MAX_BYTES,
  UNKNOWN_CP_ATTACHMENT_MIME_ALLOWLIST,
  UNKNOWN_CP_ATTACHMENT_WARNING,
  UNKNOWN_CP_MESSAGE_MIN_CHARS,
  UNKNOWN_CP_USER_MESSAGE_REASONS,
  type UnknownCpUserMessageReason,
} from "@/lib/unknown-cp-timeline";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilitationCaseId: string;
  onCompleted?: () => void;
}

export function AddMoreInformationDialog({ open, onOpenChange, facilitationCaseId, onCompleted }: Props) {
  const { toast } = useToast();
  const [reason, setReason] = useState<UnknownCpUserMessageReason>("corrected_details");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setBody(""); setFile(null); setReason("corrected_details"); };

  const submit = async () => {
    if (body.trim().length < UNKNOWN_CP_MESSAGE_MIN_CHARS) {
      toast({ title: "Message too short", description: `Please write at least ${UNKNOWN_CP_MESSAGE_MIN_CHARS} characters.`, variant: "destructive" });
      return;
    }
    if (file) {
      if (file.size > UNKNOWN_CP_ATTACHMENT_MAX_BYTES) {
        toast({ title: "Attachment too large", description: "Maximum 10 MB.", variant: "destructive" });
        return;
      }
      if (!(UNKNOWN_CP_ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(file.type)) {
        toast({ title: "Unsupported file type", description: "Allowed: PDF, DOCX, PNG, JPG.", variant: "destructive" });
        return;
      }
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("unknown-cp-user-action", {
        body: {
          facilitation_case_id: facilitationCaseId,
          action: "add_more_information",
          message_body: body,
          reason,
          attachment_ids: file ? [file.name] : [],
        },
      });
      if (error) throw error;
      toast({ title: "Information sent", description: "Your information has been sent to Izenzo support and added to this facilitation case." });
      reset();
      onOpenChange(false);
      onCompleted?.();
      void data;
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
          <DialogTitle>Add more information</DialogTitle>
          <DialogDescription>
            Help Izenzo support continue the facilitation case.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as UnknownCpUserMessageReason)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNKNOWN_CP_USER_MESSAGE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} minLength={UNKNOWN_CP_MESSAGE_MIN_CHARS} />
            <p className="text-xs text-muted-foreground mt-1">{body.trim().length}/{UNKNOWN_CP_MESSAGE_MIN_CHARS} minimum</p>
          </div>
          <div>
            <Label>Attachment (optional)</Label>
            <Input
              type="file"
              accept=".pdf,.docx,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Alert>
            <AlertDescription className="text-xs">{UNKNOWN_CP_ATTACHMENT_WARNING}</AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Sending…" : "Send to support"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
