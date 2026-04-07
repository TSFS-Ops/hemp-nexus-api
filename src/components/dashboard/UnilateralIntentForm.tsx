/**
 * UnilateralIntentForm — Create a governed intent record without a named counterparty.
 *
 * This is the "market-maker" flow: a user declares intent to buy or sell,
 * attracting liquidity from the market. The record is governed and sits
 * clearly apart from a bilateral POI.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Megaphone, Info } from "lucide-react";
import { toast } from "sonner";
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

interface UnilateralFormData {
  side: "buyer" | "seller";
  commodity: string;
  quantity: string;
  unit: string;
  price: string;
  currency: string;
  location: string;
  notes: string;
}

const INITIAL: UnilateralFormData = {
  side: "buyer",
  commodity: "",
  quantity: "",
  unit: "MT",
  price: "",
  currency: "USD",
  location: "",
  notes: "",
};

export function UnilateralIntentForm() {
  const [form, setForm] = useState<UnilateralFormData>(INITIAL);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();

  const update = (field: keyof UnilateralFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canSubmit = form.commodity.trim().length >= 2;

  const handleSubmitClick = () => {
    if (!canSubmit) {
      toast.error("Please specify the commodity.");
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setShowConfirm(false);
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
        toast.error("Account setup incomplete. Contact support@izenzo.co.za.");
        return;
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", profile.org_id)
        .maybeSingle();

      const myName = org?.name || profile.full_name || "Your Organisation";
      const quantityAmount = form.quantity ? parseFloat(form.quantity) : null;
      const priceAmount = form.price ? parseFloat(form.price) : null;

      // Only one side is populated — the other is null (no counterparty)
      const buyer = form.side === "buyer"
        ? { id: profile.org_id, name: myName }
        : null;

      const seller = form.side === "seller"
        ? { id: profile.org_id, name: myName }
        : null;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `unilateral_${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            buyer,
            seller,
            commodity: form.commodity.trim(),
            match_type: "unilateral",
            quantity: quantityAmount && !isNaN(quantityAmount) && quantityAmount > 0
              ? { amount: quantityAmount, unit: form.unit || "MT" }
              : null,
            price: priceAmount && !isNaN(priceAmount) && priceAmount > 0
              ? { amount: priceAmount, currency: form.currency || "USD" }
              : null,
            metadata: {
              source: "unilateral",
              intent_side: form.side,
              location: form.location.trim() || null,
              notes: form.notes.trim() || null,
            },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${response.status}`);
      }

      const matchData = await response.json();

      // Persist as trade order for order book visibility
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

      toast.success("Intent published. This record is now visible in your matches.");
      navigate(`${ROUTES.DASHBOARD_MATCHES}/${matchData.id}`);
    } catch (error) {
      console.error("Unilateral intent creation error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create intent.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Megaphone className="h-5 w-5" />
            Publish Unilateral Intent
          </CardTitle>
          <CardDescription>
            Declare your intent to buy or sell without naming a counterparty.
            This creates a governed intent record that can attract liquidity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                <strong>Unilateral intent</strong> is a governed record that declares your
                interest in a commodity without identifying a counterparty.
              </p>
              <p>
                It sits apart from a bilateral POI but operates as a recognised intent record.
                No credits are deducted at creation — only at lifecycle transitions{" "}
                <Badge variant="outline" className="text-xs">R10 per action</Badge>.
              </p>
            </div>
          </div>

          {/* Side */}
          <div className="space-y-2">
            <Label>I want to</Label>
            <Select value={form.side} onValueChange={(v) => update("side", v as "buyer" | "seller")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="buyer">Buy (I am looking to source)</SelectItem>
                <SelectItem value="seller">Sell (I have product available)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Commodity & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="uni-commodity">Commodity / product *</Label>
              <Input
                id="uni-commodity"
                placeholder="e.g. Non-GMO Food-Grade Soybeans"
                value={form.commodity}
                onChange={(e) => update("commodity", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uni-location">Location / jurisdiction</Label>
              <Input
                id="uni-location"
                placeholder="e.g. Free State, South Africa"
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
              />
            </div>
          </div>

          {/* Quantity & Price */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="uni-quantity">Quantity</Label>
              <Input
                id="uni-quantity"
                type="number"
                placeholder="e.g. 100000"
                value={form.quantity}
                onChange={(e) => update("quantity", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uni-unit">Unit</Label>
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
              <Label htmlFor="uni-price">Price per unit</Label>
              <Input
                id="uni-price"
                type="number"
                placeholder="e.g. 450"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uni-currency">Currency</Label>
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

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="uni-notes">Additional notes (optional)</Label>
            <Textarea
              id="uni-notes"
              placeholder="e.g. Seeking consistent supply, 12-month offtake, delivery to Durban port"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
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
                Publishing…
              </>
            ) : (
              <>
                <Megaphone className="h-4 w-4 mr-2" />
                Publish Intent
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish unilateral intent?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will create a governed intent record declaring your interest to{" "}
                  <strong>{form.side === "buyer" ? "buy" : "sell"}</strong>{" "}
                  <strong>{form.commodity}</strong>.
                </p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>No counterparty is named — this is a market-maker signal.</li>
                  <li>No credits are deducted at creation.</li>
                  <li>Each lifecycle action costs R10 (1 credit).</li>
                  <li>This record is separate from bilateral POIs.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Publish Intent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
