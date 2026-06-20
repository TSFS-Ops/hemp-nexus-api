/**
 * Batch 1 — Readiness state transition dialog. Calls
 * `registry-readiness-transition` edge function.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_READINESS_STATES,
  REGISTRY_READINESS_LABEL,
  type RegistryReadinessState,
} from "@/lib/registry-readiness";

interface Props {
  module: { module_code: string; module_name: string; current_state: RegistryReadinessState };
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}

export function ReadinessTransitionDialog({ module, open, onOpenChange, onChanged }: Props) {
  const { toast } = useToast();
  const [newState, setNewState] = useState<RegistryReadinessState>(module.current_state);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 20) {
      toast({ title: "Reason must be at least 20 characters", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("registry-readiness-transition", {
        body: { module_code: module.module_code, new_state: newState, reason: reason.trim() },
      });
      if (error) throw error;
      toast({ title: "Readiness state updated" });
      onChanged();
    } catch (e) {
      toast({ title: "Could not update", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{module.module_code} — {module.module_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>New state</Label>
            <select
              className="w-full border rounded-md px-2 py-2 text-sm bg-background"
              value={newState}
              onChange={(e) => setNewState(e.target.value as RegistryReadinessState)}
            >
              {REGISTRY_READINESS_STATES.map((s) => (
                <option key={s} value={s}>{REGISTRY_READINESS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Reason (min 20 characters)</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting}>{submitting ? "Saving…" : "Apply"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
