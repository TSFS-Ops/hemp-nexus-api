import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResidencyRequestForm } from "@/components/data-residency/ResidencyRequestForm";

/**
 * DATA-009 — Desk → Settings → Data Residency.
 * Lets a Desk user submit a residency requirement for Izenzo review and see
 * any previously submitted reviews. No technical residency change is made
 * automatically; approval is policy-only and gated on Platform Admin + AAL2.
 */
type Review = {
  id: string;
  status: string;
  requirement_source: string;
  requested_region: string | null;
  requested_country: string | null;
  created_at: string;
};

export function DataResidencyTab() {
  const [reviews, setReviews] = useState<Review[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await supabase
          .from("data_residency_reviews")
          .select("id,status,requirement_source,requested_region,requested_country,created_at")
          .order("created_at", { ascending: false })
          .limit(10);
        if (!cancelled) setReviews((data as Review[]) ?? []);
      } catch {
        if (!cancelled) setReviews([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Data Residency</p>
        <p>
          Submit a residency requirement here so Izenzo can review it separately. No region,
          hosting, backup, export or deletion change happens automatically. Approval is a policy
          exception only and requires Platform Admin sign-off with step-up authentication and a
          recorded reason.
        </p>
      </div>

      <ResidencyRequestForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your residency reviews</CardTitle>
        </CardHeader>
        <CardContent>
          {reviews === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No residency reviews submitted yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {reviews.map((r) => (
                <li key={r.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.requirement_source}</p>
                    <p className="text-xs text-muted-foreground">
                      {[r.requested_region, r.requested_country].filter(Boolean).join(" · ") || "—"}
                      {" · "}
                      {new Date(r.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={r.status === "pending" ? "secondary" : "outline"}>
                    {r.status === "pending" ? "Residency review pending" : r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default DataResidencyTab;
