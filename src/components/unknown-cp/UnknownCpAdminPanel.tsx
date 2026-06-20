/**
 * P012 — Admin structured-actions panel.
 * Every admin transition is a typed form → maps 1:1 to unknown-cp-status-transition.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { UNKNOWN_CP_ADMIN_ACTIONS_LIST, type UnknownCpAdminActionKey } from "./adminActionList";

interface Props { facilitationCaseId: string; isPlatformAdmin: boolean; onChanged?: () => void; }

export function UnknownCpAdminPanel({ facilitationCaseId, isPlatformAdmin, onChanged }: Props) {
  const { toast } = useToast();
  const [action, setAction] = useState<UnknownCpAdminActionKey>("start_review");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("unknown-cp-status-transition", {
        body: {
          facilitation_case_id: facilitationCaseId,
          action,
          reason_code: reason || undefined,
          internal_note: note || undefined,
        },
      });
      if (error) throw error;
      toast({ title: "Status updated" });
      setReason(""); setNote("");
      onChanged?.();
    } catch (e) {
      toast({ title: "Could not update", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Unknown-counterparty admin actions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Action</Label>
          <select
            className="w-full border rounded-md px-2 py-2 text-sm bg-background"
            value={action}
            onChange={(e) => setAction(e.target.value as UnknownCpAdminActionKey)}
          >
            {UNKNOWN_CP_ADMIN_ACTIONS_LIST.map((a) => (
              <option key={a.key} value={a.key} disabled={a.key === "reopen_case" && !isPlatformAdmin}>
                {a.label}{a.key === "reopen_case" ? " (platform_admin only)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Reason code (optional)</Label>
          <input className="w-full border rounded-md px-2 py-2 text-sm bg-background" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div>
          <Label>Internal note (admin-only)</Label>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button onClick={submit} disabled={submitting}>{submitting ? "Saving…" : "Apply action"}</Button>
      </CardContent>
    </Card>
  );
}
