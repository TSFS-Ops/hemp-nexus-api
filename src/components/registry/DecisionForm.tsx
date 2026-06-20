/**
 * Batch 1 — Record a business decision (M018).
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  BUSINESS_DECISION_CATEGORIES,
  BUSINESS_DECISION_CATEGORY_LABEL,
  BUSINESS_DECISION_STATUSES,
  BUSINESS_DECISION_STATUS_LABEL,
  BUSINESS_DECISION_MIN_RATIONALE_LENGTH,
  type BusinessDecisionCategory,
  type BusinessDecisionStatus,
} from "@/lib/business-decisions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}

export function DecisionForm({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<BusinessDecisionCategory>("country");
  const [decisionKey, setDecisionKey] = useState("");
  const [status, setStatus] = useState<BusinessDecisionStatus>("proposed");
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (rationale.trim().length < BUSINESS_DECISION_MIN_RATIONALE_LENGTH) {
      toast({
        title: `Rationale must be at least ${BUSINESS_DECISION_MIN_RATIONALE_LENGTH} characters`,
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("business-decision-record", {
        body: {
          action: "create",
          title: title.trim(),
          category,
          decision_key: decisionKey.trim(),
          status,
          rationale: rationale.trim(),
        },
      });
      if (error) throw error;
      toast({ title: "Decision recorded" });
      onCreated();
    } catch (e) {
      toast({ title: "Could not record", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record business decision</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <select
                className="w-full border rounded-md px-2 py-2 text-sm bg-background"
                value={category}
                onChange={(e) => setCategory(e.target.value as BusinessDecisionCategory)}
              >
                {BUSINESS_DECISION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{BUSINESS_DECISION_CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Status</Label>
              <select
                className="w-full border rounded-md px-2 py-2 text-sm bg-background"
                value={status}
                onChange={(e) => setStatus(e.target.value as BusinessDecisionStatus)}
              >
                {BUSINESS_DECISION_STATUSES.map((s) => (
                  <option key={s} value={s}>{BUSINESS_DECISION_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label>Decision key (e.g. country.ZA, provider.cipc)</Label>
            <Input value={decisionKey} onChange={(e) => setDecisionKey(e.target.value)} />
          </div>
          <div>
            <Label>Rationale (min {BUSINESS_DECISION_MIN_RATIONALE_LENGTH} characters)</Label>
            <Textarea rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting}>{submitting ? "Saving…" : "Record"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
