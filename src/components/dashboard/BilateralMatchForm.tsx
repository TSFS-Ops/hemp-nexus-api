/**
 * BilateralMatchForm - Create a match with a known/offline trading partner.
 * 
 * This allows users to register an intent when they already have a trading partner
 * identified outside the platform (e.g., through direct negotiation).
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Handshake, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { CommoditySelect } from "@/components/ui/commodity-select";
import { ROUTES } from "@/lib/constants";
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

interface BilateralFormData {
  counterpartyName: string;
  counterpartyContact: string;
  commodity: string;
  side: "buyer" | "seller";
  quantity: string;
  unit: string;
  price: string;
  currency: string;
  terms: string;
  location: string;
  originCountry: string;
  destinationCountry: string;
}

const INITIAL_FORM: BilateralFormData = {
  counterpartyName: "",
  counterpartyContact: "",
  commodity: "",
  side: "buyer",
  quantity: "",
  unit: "MT",
  price: "",
  currency: "USD",
  terms: "",
  location: "",
  originCountry: "",
  destinationCountry: "",
};

export function BilateralMatchForm() {
  const [form, setForm] = useState<BilateralFormData>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();

  const formRef = useRef(form);
  formRef.current = form;

  const getCurrentData = useCallback((): BilateralFormData | null => {
    const f = formRef.current;
    if (!f.counterpartyName && !f.commodity && !f.quantity) return null;
    return f;
  }, []);

  const { restoreDraft, saveDraft, clearDraft } = useDraftPersistence<BilateralFormData>("bilateral-match", getCurrentData);

  const draftInitialised = useRef(false);
  useEffect(() => {
    if (draftInitialised.current) return;
    draftInitialised.current = true;
    const draft = restoreDraft();
    if (draft) {
      setForm(draft);
      setDraftRestored(true);
    }
  }, [restoreDraft]);

  useEffect(() => {
    if (!draftInitialised.current) return;
    const f = form;
    if (f.counterpartyName || f.commodity || f.quantity) {
      saveDraft(f);
    }
  }, [form, saveDraft]);

  const update = (field: keyof BilateralFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const isDirty = useMemo(() => form.counterpartyName.trim().length > 0 || form.commodity.trim().length > 0 || form.quantity.length > 0, [form]);
  useUnsavedChanges(isDirty && !isSubmitting);

  const canSubmit =
    form.counterpartyName.trim().length >= 2 &&
    form.commodity.trim().length >= 2;

  const handleSubmitClick = () => {
    if (!canSubmit) {
      toast.error("Please fill in trading partner name and commodity.");
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleConfirm = async () => {
    setShowConfirmDialog(false);
    if (!session) {
      toast.error("Please sign in first.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, org_id, full_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!profile?.org_id) {
        toast.error("Your account setup is incomplete. Please contact support@izenzo.co.za.");
        return;
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", profile.org_id)
        .maybeSingle();

      const myName = org?.name || profile.full_name || "Your Organisation";
      const counterpartyId = `bilateral_${crypto.randomUUID().slice(0, 12)}`;

      const quantityAmount = form.quantity ? parseFloat(form.quantity) : null;
      const priceAmount = form.price ? parseFloat(form.price) : null;

      const buyer = form.side === "buyer"
        ? { id: profile.org_id, name: myName }
        : { id: counterpartyId, name: form.counterpartyName.trim() };

      const seller = form.side === "seller"
        ? { id: profile.org_id, name: myName }
        : { id: counterpartyId, name: form.counterpartyName.trim() };

      const isDraft = (!quantityAmount || isNaN(quantityAmount)) && (!priceAmount || isNaN(priceAmount));

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `bilateral_${session.user.id}_${form.commodity.trim().toLowerCase()}_${form.counterpartyName.trim().toLowerCase()}_${form.side}_${form.quantity || "0"}_${form.price || "0"}`,
          },
          body: JSON.stringify({
            buyer,
            seller,
            commodity: form.commodity.trim(),
            match_type: "bilateral",
            quantity: quantityAmount && !isNaN(quantityAmount) && quantityAmount > 0
              ? { amount: quantityAmount, unit: form.unit || "MT" }
              : null,
            price: priceAmount && !isNaN(priceAmount) && priceAmount > 0
              ? { amount: priceAmount, currency: form.currency || "USD" }
              : null,
            terms: form.terms.trim() || null,
            metadata: {
              source: "bilateral",
              isDraft,
              counterpartyContact: form.counterpartyContact.trim() || null,
              location: form.location.trim() || null,
              draftReason: isDraft
                ? "Created as bilateral match - commercial terms to be confirmed."
                : undefined,
            },
            origin_country: form.originCountry.trim().toUpperCase() || null,
            destination_country: form.destinationCountry.trim().toUpperCase() || null,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${response.status}`);
      }

      const matchData = await response.json();

      // Also persist as trade order
      try {
        await supabase.from("trade_orders").insert({
          org_id: profile.org_id,
          user_id: profile.id,
          side: form.side === "buyer" ? "bid" : "offer",
          product: form.commodity.trim(),
          price: priceAmount && !isNaN(priceAmount) ? priceAmount : null,
          volume: quantityAmount && !isNaN(quantityAmount) ? quantityAmount : null,
          location: form.location.trim() || null,
        } as any);
      } catch {
        // Non-critical
      }

      clearDraft();
      setDraftRestored(false);
      toast.success("Bilateral match created. Add documents and send a trade request when ready.");
      navigate(`${ROUTES.DASHBOARD_MATCHES}/${matchData.id}`);
    } catch (error) {
      console.error("Bilateral match creation error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create match.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Handshake className="h-5 w-5" />
            Create Bilateral Match
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Register a Trade Request with a trading partner you've already identified offline.
            They will need to onboard to the platform to complete the bilateral flow.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Draft restored notice */}
          {draftRestored && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
              <span className="text-sm text-muted-foreground">
                Draft restored from your previous session.
              </span>
              <button
                type="button"
                onClick={() => { clearDraft(); setDraftRestored(false); setForm(INITIAL_FORM); }}
                className="text-sm text-primary underline hover:opacity-80"
              >
                Clear
              </button>
            </div>
          )}

          {/* Your role */}
          <div className="space-y-2">
            <Label>Your role in this transaction</Label>
            <Select value={form.side} onValueChange={(v) => update("side", v as "buyer" | "seller")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="buyer">I am the Buyer</SelectItem>
                <SelectItem value="seller">I am the Seller</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trading Partner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cp-name">Trading partner name *</Label>
              <Input
                id="cp-name"
                placeholder="e.g. Boet Wilken Boerdery"
                value={form.counterpartyName}
                onChange={(e) => update("counterpartyName", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cp-contact">Trading partner contact</Label>
              <Input
                id="cp-contact"
                placeholder="e.g. +27 83 444 1447"
                value={form.counterpartyContact}
                onChange={(e) => update("counterpartyContact", e.target.value)}
              />
            </div>
          </div>

          {/* Commodity & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="commodity">Commodity / product *</Label>
              <CommoditySelect
                id="commodity"
                value={form.commodity}
                onChange={(v) => update("commodity", v)}
                placeholder="e.g. Non-GMO Food-Grade Soybeans"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location / jurisdiction</Label>
              <Input
                id="location"
                placeholder="e.g. Bultfontein, Free State, ZA"
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
              />
            </div>
          </div>

          {/* Origin & Destination */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="origin-country">Origin country</Label>
              <Input
                id="origin-country"
                placeholder="e.g. ZA"
                value={form.originCountry}
                onChange={(e) => update("originCountry", e.target.value)}
                maxLength={2}
              />
              <p className="text-xs text-muted-foreground">ISO country code where goods originate</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="destination-country">Destination country</Label>
              <Input
                id="destination-country"
                placeholder="e.g. MZ"
                value={form.destinationCountry}
                onChange={(e) => update("destinationCountry", e.target.value)}
                maxLength={2}
              />
              <p className="text-xs text-muted-foreground">ISO country code where goods are delivered</p>
            </div>
          </div>

          {/* Quantity & Price */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                placeholder="e.g. 100000"
                value={form.quantity}
                onChange={(e) => update("quantity", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Select value={form.unit} onValueChange={(v) => update("unit", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MT">MT (metric tons)</SelectItem>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="lbs">lbs</SelectItem>
                  <SelectItem value="bushels">bushels</SelectItem>
                  <SelectItem value="units">units</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price per unit</Label>
              <Input
                id="price"
                type="number"
                placeholder="e.g. 450"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => update("currency", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ZAR">ZAR</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Terms */}
          <div className="space-y-2">
            <Label htmlFor="terms">Terms / notes (optional)</Label>
            <Textarea
              id="terms"
              placeholder="e.g. CIF Durban, 90-day payment terms, SGS inspection required"
              value={form.terms}
              onChange={(e) => update("terms", e.target.value)}
              rows={3}
            />
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmitClick}
            disabled={!canSubmit || isSubmitting}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Handshake className="h-4 w-4 mr-2" />
                Create Bilateral Match
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create bilateral match?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will create a draft match with <strong>{form.counterpartyName}</strong> for{" "}
                  <strong>{form.commodity}</strong>.
                </p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>No credits are deducted at creation - only at lifecycle transitions.</li>
                  <li>The trading partner must onboard to complete the bilateral intent.</li>
                  <li>You can add documents and terms before confirming intent.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Create Match
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
