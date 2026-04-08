/**
 * UnilateralIntentForm - Create a governed intent record without a named counterparty.
 *
 * This is the "market-maker" flow: a user declares intent to buy or sell,
 * attracting liquidity from the market. The record is governed and sits
 * clearly apart from a bilateral intent.
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
import { Loader2, Megaphone, Info, Sparkles, Mail } from "lucide-react";
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
  counterpartyEmail: string;
}

const INITIAL: UnilateralFormData = {
  side: "buyer",
  commodity: "",
  quantity: "",
  unit: "MT",
  price: "",
  currency: "ZAR",
  location: "",
  notes: "",
  counterpartyEmail: "",
};

export function UnilateralIntentForm() {
  const [form, setForm] = useState<UnilateralFormData>(INITIAL);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
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

    // FIX #4: Stable idempotency key derived from form content - survives page reload / retry
    const idempotencyKey = `unilateral_${session.user.id}_${form.commodity.trim().toLowerCase()}_${form.side}_${form.quantity || "0"}_${form.price || "0"}`;

    // FIX #4b: AbortController with timeout for network resilience
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30s timeout

    try {
      // FIX #5: Check session freshness before making the request
      const { data: { session: freshSession }, error: refreshErr } = await supabase.auth.getSession();
      if (refreshErr || !freshSession) {
        toast.error("Your session has expired. Please sign in again.", {
          action: {
            label: "Sign in",
            onClick: () => navigate("/auth?returnTo=/dashboard&expired=1"),
          },
        });
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, org_id, full_name")
        .eq("id", freshSession.user.id)
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
            Authorization: `Bearer ${freshSession.access_token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
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
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      // FIX #5b: Handle specific HTTP error codes with actionable messages
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 401) {
          toast.error("Session expired. Please sign in again.", {
            action: {
              label: "Sign in",
              onClick: () => navigate("/auth?returnTo=/dashboard&expired=1"),
            },
          });
          return;
        }
        if (response.status === 409) {
          toast.info("This intent already exists. Redirecting to your matches.");
          navigate(ROUTES.DASHBOARD_MATCHES);
          return;
        }
        if (response.status === 422) {
          toast.error(err.message || "Validation failed. Check your inputs and try again.");
          return;
        }
        if (response.status === 429) {
          toast.error("Too many requests. Please wait a moment and try again.");
          return;
        }
        throw new Error(err.message || err.error || `HTTP ${response.status}`);
      }

      const matchData = await response.json();

      // FIX #1: trade_order insert is non-critical - log failure but don't block
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
      } catch (tradeOrderErr) {
        console.error("Non-critical: trade_order insert failed", tradeOrderErr);
        // Intent was created successfully - don't block the user
      }

      // Send trading partner invite email if provided
      if (form.counterpartyEmail.trim()) {
        try {
          const siteUrl = window.location.origin;
          const acceptUrl = `${siteUrl}/auth?redirect=/dashboard/matches/${matchData.id}`;
          await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "poi-invite",
              recipientEmail: form.counterpartyEmail.trim(),
              idempotencyKey: `poi-invite-${matchData.id}`,
              templateData: {
                commodity: form.commodity.trim(),
                quantity: form.quantity || undefined,
                unit: form.unit || undefined,
                price: form.price || undefined,
                currency: form.currency || undefined,
                senderName: myName,
                acceptUrl,
              },
            },
          });
          toast.success("Invite sent to trading partner.", { duration: 4000 });
        } catch (emailErr) {
          console.error("Non-critical: trading partner invite email failed", emailErr);
          toast.info("Trade request sent, but the invite email could not be sent. Share the link manually.");
        }
      }

      // Reset form state so back-navigation shows a blank slate
      setForm(INITIAL);
      setDraftText("");

      toast.success("Trade request sent. This record is now visible in your matches.");
      navigate(`${ROUTES.DASHBOARD_MATCHES}/${matchData.id}`);
    } catch (error) {
      clearTimeout(timeoutId);

      // FIX #4c: Distinguish abort (timeout) from other errors
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.error(
          "Request timed out. Your intent may have been created. Check your matches before retrying.",
          { duration: 8000 }
        );
        return;
      }

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
            Send Trade Request
          </CardTitle>
          <CardDescription>
            Declare your intent to buy or sell without naming a trading partner.
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
                interest in a commodity without identifying a trading partner.
              </p>
              <p>
                It sits apart from a bilateral intent but operates as a recognised intent record.
                No credits are deducted at creation - only at lifecycle transitions{" "}
                <Badge variant="outline" className="text-xs">R10 ZAR per action</Badge>.
              </p>
            </div>
          </div>

          {/* ── AI Trade Drafter ── */}
          <div className="space-y-3 p-4 rounded-lg border border-accent/30 bg-accent/5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">AI Trade Drafter</span>
              <Badge variant="secondary" className="text-[10px]">AI</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste an email, WhatsApp message, or rough notes and we'll extract the trade details automatically.
            </p>
            <Textarea
              placeholder={'e.g. "Festus wants 25,000 MT of Soybeans from Malawi at $495/MT, delivery to Durban port by Q3"'}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={3}
              disabled={isDrafting}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={draftText.trim().length < 10 || isDrafting}
              onClick={async () => {
                setIsDrafting(true);
                try {
                  const { data, error } = await supabase.functions.invoke("draft-poi", {
                    body: { rawText: draftText.trim() },
                  });
                  if (error) throw error;
                  if (data?.error) {
                    toast.error(data.error);
                    return;
                  }

                  // Auto-fill form fields from AI extraction
                  setForm((prev) => ({
                    ...prev,
                    side: data.side === "seller" ? "seller" : "buyer",
                    commodity: data.commodity || prev.commodity,
                    quantity: data.quantity || prev.quantity,
                    unit: data.unit || prev.unit,
                    price: data.price || prev.price,
                    currency: data.currency || prev.currency,
                    location: data.location || prev.location,
                    notes: data.notes || prev.notes,
                  }));

                  const confidenceLabel =
                    data.confidence === "high" ? "High confidence" :
                    data.confidence === "medium" ? "Medium confidence - please review" :
                    "Low confidence - please verify all fields";

                  toast.success(`Draft extracted. ${confidenceLabel}.`);
                } catch (err) {
                  console.error("AI Trade Drafter error:", err);
                  toast.error(err instanceof Error ? err.message : "Failed to extract draft. Please fill the form manually.");
                } finally {
                  setIsDrafting(false);
                }
              }}
            >
              {isDrafting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Extracting…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Extract from text
                </>
              )}
            </Button>
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

          {/* Counterparty Email (optional invite) */}
          <div className="space-y-2">
            <Label htmlFor="uni-counterparty-email" className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5" />
              Trading partner email (optional)
            </Label>
            <Input
              id="uni-counterparty-email"
              type="email"
              placeholder="e.g. farmer@example.com - they'll receive an invite to review this intent"
              value={form.counterpartyEmail}
              onChange={(e) => update("counterpartyEmail", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              If provided, the trading partner will receive an email invitation to create an account and accept this intent, converting it into a bilateral intent.
            </p>
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
                Sending…
              </>
            ) : (
              <>
                <Megaphone className="h-4 w-4 mr-2" />
                Send Trade Request
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send trade request?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will create a governed intent record declaring your interest to{" "}
                  <strong>{form.side === "buyer" ? "buy" : "sell"}</strong>{" "}
                  <strong>{form.commodity}</strong>.
                </p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>No counterparty is named - this is a market-maker signal.</li>
                  <li>No credits are deducted at creation.</li>
                  <li>Each lifecycle action costs R10 ZAR (1 credit).</li>
                  <li>This record is separate from bilateral intents.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Send Trade Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
