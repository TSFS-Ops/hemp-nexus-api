import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, FileText, Save, Clock, Plus, AlertTriangle, History } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DealTerm {
  id: string;
  payment_terms: string | null;
  delivery_terms: string | null;
  inspection_terms: string | null;
  penalty_terms: string | null;
  partial_shipment: boolean;
  amendment_notes: string | null;
  version: number;
  status: string;
  created_at: string;
  proposed_by: string | null;
}

interface DealTermsPanelProps {
  matchId: string;
  orgId: string;
  /** Called after match commercial fields are updated so parent can refresh */
  onMatchUpdated?: () => void | Promise<void>;
}

const EMPTY_FORM = {
  payment_terms: "",
  delivery_terms: "",
  inspection_terms: "",
  penalty_terms: "",
  partial_shipment: false,
  amendment_notes: "",
  quantity_amount: "",
  quantity_unit: "MT",
  price_amount: "",
  price_currency: "USD",
};

export function DealTermsPanel({ matchId, orgId, onMatchUpdated }: DealTermsPanelProps) {
  const { user } = useAuth();
  const [terms, setTerms] = useState<DealTerm[]>([]);
  const [matchData, setMatchData] = useState<{
    quantity_amount: number | null;
    quantity_unit: string | null;
    price_amount: number | null;
    price_currency: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLeaveWarning, setShowLeaveWarning] = useState(false);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const formDirty = useRef(false);

  const getCurrentForm = useCallback(() => {
    if (!formDirty.current || !showForm) return null;
    return form;
  }, [form, showForm]);

  const {
    restoreDraft: restoreDealDraft,
    clearDraft: clearDealDraft,
    hasRestoredDraft: hasDealDraft,
  } = useDraftPersistence<typeof EMPTY_FORM>(`deal-terms-${matchId}`, getCurrentForm);

  const fetchTerms = useCallback(async () => {
    setFetchError(null);
    try {
      const [termsRes, matchRes] = await Promise.all([
        supabase
          .from("deal_terms")
          .select("*")
          .eq("match_id", matchId)
          .order("version", { ascending: false }),
        supabase
          .from("matches")
          .select("quantity_amount, quantity_unit, price_amount, price_currency")
          .eq("id", matchId)
          .maybeSingle(),
      ]);

      if (termsRes.error) throw termsRes.error;

      setTerms((termsRes.data as DealTerm[]) || []);
      if (matchRes.data) {
        setMatchData(matchRes.data as typeof matchData);
      }
    } catch (err) {
      console.error("[DealTermsPanel] fetch failed:", err);
      setFetchError(err instanceof Error ? err.message : "Failed to load deal terms");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    void fetchTerms();
  }, [fetchTerms]);

  useEffect(() => {
    if (showForm && hasDealDraft) {
      const draft = restoreDealDraft();
      if (draft) {
        setForm(draft);
        toast.info("Unsaved deal terms from your previous session have been restored.", {
          action: {
            label: "Discard",
            onClick: () => {
              setForm({ ...EMPTY_FORM });
              clearDealDraft();
            },
          },
          duration: 8000,
        });
      }
    }
  }, [showForm, hasDealDraft, restoreDealDraft, clearDealDraft]);

  useEffect(() => {
    if (!showForm) {
      formDirty.current = false;
      return;
    }

    const hasContent = Object.entries(form).some(([key, value]) => {
      if (key === "partial_shipment") return value !== false;
      return typeof value === "string" && value.trim().length > 0;
    });

    formDirty.current = hasContent;
  }, [form, showForm]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (formDirty.current && showForm) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [showForm]);

  const handleCancelForm = () => {
    if (formDirty.current) {
      setShowLeaveWarning(true);
      return;
    }

    setShowForm(false);
  };

  const confirmLeave = () => {
    setShowLeaveWarning(false);
    setForm({ ...EMPTY_FORM });
    setShowForm(false);
  };

  const handleSave = async () => {
    if (saving) return;

    setSaving(true);

    try {
      const { data: openDisputes, error: disputeErr } = await supabase
        .from("disputes")
        .select("id")
        .eq("match_id", matchId)
        .eq("status", "open")
        .limit(1);

      if (disputeErr) throw disputeErr;

      if (openDisputes && openDisputes.length > 0) {
        toast.error(
          "Cannot save deal terms while an open dispute exists on this match. Resolve the dispute first.",
          { duration: 6000 }
        );
        return;
      }

      const latestVersion = terms.length > 0 ? terms[0].version : 0;

      const { data: freshTerms, error: freshErr } = await supabase
        .from("deal_terms")
        .select("version")
        .eq("match_id", matchId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (freshErr) throw freshErr;

      const currentLatest = freshTerms?.version ?? 0;
      if (currentLatest !== latestVersion) {
        toast.error(
          "Someone else has updated the deal terms since you started editing. Please review the latest version and try again.",
          { duration: 6000 }
        );
        await fetchTerms();
        return;
      }

      const { error } = await supabase.from("deal_terms").insert({
        match_id: matchId,
        org_id: orgId,
        proposed_by: user?.id,
        payment_terms: form.payment_terms || null,
        delivery_terms: form.delivery_terms || null,
        inspection_terms: form.inspection_terms || null,
        penalty_terms: form.penalty_terms || null,
        partial_shipment: form.partial_shipment,
        amendment_notes: form.amendment_notes || null,
        version: currentLatest + 1,
        status: "proposed",
      });

      if (error) throw error;

      const qtyNum = form.quantity_amount ? parseFloat(form.quantity_amount) : null;
      const priceNum = form.price_amount ? parseFloat(form.price_amount) : null;

      if (qtyNum != null || priceNum != null) {
        const matchUpdate: Record<string, unknown> = {};

        if (qtyNum != null && qtyNum > 0) {
          matchUpdate.quantity_amount = qtyNum;
          matchUpdate.quantity_unit = form.quantity_unit || "MT";
        }

        if (priceNum != null && priceNum > 0) {
          matchUpdate.price_amount = priceNum;
          matchUpdate.price_currency = form.price_currency || "USD";
        }

        if (Object.keys(matchUpdate).length > 0) {
          const { error: matchErr } = await supabase
            .from("matches")
            .update(matchUpdate)
            .eq("id", matchId);

          if (matchErr) {
            console.error("[DealTermsPanel] match update failed:", matchErr);
            toast.error("Terms saved but failed to update match commercial fields", {
              description: matchErr.message,
            });
          } else {
            await onMatchUpdated?.();
          }
        }
      }

      toast.success("Deal terms proposed successfully");
      formDirty.current = false;
      clearDealDraft();
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      await fetchTerms();
    } catch (err: any) {
      const msg = err?.message || "";

      if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("deal_terms_match_id_version")) {
        toast.error(
          "Version conflict: another user submitted terms at the same time. Refreshing to show the latest version.",
          { duration: 8000 }
        );
        await fetchTerms();
      } else {
        toast.error("Failed to save terms", { description: msg });
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <ErrorState
        variant="inline"
        title="Failed to load deal terms"
        message={fetchError}
        onRetry={fetchTerms}
      />
    );
  }

  const latestTerm = terms[0] || null;
  const olderTerms = terms.slice(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Deal Terms
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Terms are versioned - each proposal creates a new immutable record.
            {latestTerm && ' Click "Amend Terms" to propose changes based on the current version.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {olderTerms.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-4 w-4 mr-1" />
              {showHistory ? "Hide history" : `${olderTerms.length} previous version${olderTerms.length > 1 ? "s" : ""}`}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (showForm) {
                handleCancelForm();
                return;
              }

              if (latestTerm) {
                setForm({
                  payment_terms: latestTerm.payment_terms || "",
                  delivery_terms: latestTerm.delivery_terms || "",
                  inspection_terms: latestTerm.inspection_terms || "",
                  penalty_terms: latestTerm.penalty_terms || "",
                  partial_shipment: latestTerm.partial_shipment ?? false,
                  amendment_notes: "",
                  quantity_amount: matchData?.quantity_amount?.toString() || "",
                  quantity_unit: matchData?.quantity_unit || "MT",
                  price_amount: matchData?.price_amount?.toString() || "",
                  price_currency: matchData?.price_currency || "USD",
                });
              } else {
                setForm({
                  ...EMPTY_FORM,
                  quantity_amount: matchData?.quantity_amount?.toString() || "",
                  quantity_unit: matchData?.quantity_unit || "MT",
                  price_amount: matchData?.price_amount?.toString() || "",
                  price_currency: matchData?.price_currency || "USD",
                });
              }

              setShowForm(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            {showForm ? "Cancel" : latestTerm ? "Amend Terms" : "Propose Terms"}
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Propose Deal Terms (v{(latestTerm?.version ?? 0) + 1})</CardTitle>
            <CardDescription>Capture the key commercial terms for this deal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-primary" />
                Commercial Terms (required to proceed to POI)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={form.quantity_amount}
                    onChange={(e) => setForm({ ...form, quantity_amount: e.target.value })}
                    placeholder="e.g. 1000"
                    aria-label="Quantity"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Unit</Label>
                  <Input
                    value={form.quantity_unit}
                    onChange={(e) => setForm({ ...form, quantity_unit: e.target.value })}
                    placeholder="e.g. MT, kg, bags"
                    aria-label="Quantity unit"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Price per unit</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={form.price_amount}
                    onChange={(e) => setForm({ ...form, price_amount: e.target.value })}
                    placeholder="e.g. 500"
                    aria-label="Price"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Currency</Label>
                  <Input
                    value={form.price_currency}
                    onChange={(e) => setForm({ ...form, price_currency: e.target.value })}
                    placeholder="e.g. USD, ZAR, EUR"
                    aria-label="Currency"
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Payment Terms</Label>
              <Textarea
                value={form.payment_terms}
                onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                placeholder="e.g. 30 days net, Letter of Credit, T/T on delivery"
                aria-label="Payment terms"
              />
            </div>
            <div className="space-y-2">
              <Label>Delivery Terms</Label>
              <Textarea
                value={form.delivery_terms}
                onChange={(e) => setForm({ ...form, delivery_terms: e.target.value })}
                placeholder="e.g. FOB Cape Town, CIF Rotterdam, within 45 days"
                aria-label="Delivery terms"
              />
            </div>
            <div className="space-y-2">
              <Label>Inspection / Quality Terms</Label>
              <Textarea
                value={form.inspection_terms}
                onChange={(e) => setForm({ ...form, inspection_terms: e.target.value })}
                placeholder="e.g. SGS inspection at load port, ISO 9001 certificate required"
                aria-label="Inspection terms"
              />
            </div>
            <div className="space-y-2">
              <Label>Penalty / Default Terms</Label>
              <Textarea
                value={form.penalty_terms}
                onChange={(e) => setForm({ ...form, penalty_terms: e.target.value })}
                placeholder="e.g. 1% per week late delivery penalty, force majeure clause"
                aria-label="Penalty terms"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.partial_shipment}
                onCheckedChange={(value) => setForm({ ...form, partial_shipment: value })}
                id="partial-shipment"
              />
              <Label htmlFor="partial-shipment">Allow partial shipments</Label>
            </div>
            <div className="space-y-2">
              <Label>Amendment Notes</Label>
              <Input
                value={form.amendment_notes}
                onChange={(e) => setForm({ ...form, amendment_notes: e.target.value })}
                placeholder="Reason for this version"
                aria-label="Amendment notes"
              />
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Submit Terms
            </Button>
          </CardContent>
        </Card>
      )}

      {!latestTerm ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No terms proposed yet. Click "Propose Terms" to capture deal conditions.
          </CardContent>
        </Card>
      ) : (
        <TermCard term={latestTerm} isCurrent />
      )}

      {showHistory && olderTerms.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <History className="h-4 w-4" />
            Previous Versions
          </h4>
          {olderTerms.map((term) => (
            <TermCard key={term.id} term={term} />
          ))}
        </div>
      )}

      <AlertDialog open={showLeaveWarning} onOpenChange={setShowLeaveWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved deal terms. If you close the form now, your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLeave} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TermCard({ term, isCurrent }: { term: DealTerm; isCurrent?: boolean }) {
  return (
    <Card key={term.id} className={isCurrent ? "" : "opacity-70"}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">v{term.version}</Badge>
            <Badge
              variant={
                term.status === "accepted"
                  ? "default"
                  : term.status === "rejected"
                    ? "destructive"
                    : "secondary"
              }
            >
              {term.status === "proposed"
                ? "Proposed"
                : term.status === "accepted"
                  ? "Accepted"
                  : term.status === "rejected"
                    ? "Rejected"
                    : term.status}
            </Badge>
            {isCurrent && <Badge variant="outline" className="text-xs border-primary text-primary">Current</Badge>}
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {format(new Date(term.created_at), "dd MMM yyyy HH:mm")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {term.payment_terms && <div><span className="font-medium">Payment:</span> {term.payment_terms}</div>}
        {term.delivery_terms && <div><span className="font-medium">Delivery:</span> {term.delivery_terms}</div>}
        {term.inspection_terms && <div><span className="font-medium">Inspection:</span> {term.inspection_terms}</div>}
        {term.penalty_terms && <div><span className="font-medium">Penalties:</span> {term.penalty_terms}</div>}
        <div><span className="font-medium">Partial Shipments:</span> {term.partial_shipment ? "Allowed" : "Not allowed"}</div>
        {term.amendment_notes && <div className="text-muted-foreground italic">Note: {term.amendment_notes}</div>}
      </CardContent>
    </Card>
  );
}
