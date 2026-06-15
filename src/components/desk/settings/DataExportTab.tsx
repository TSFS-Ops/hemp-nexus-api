import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  ALLOWED_USER_EXPORT_CATEGORIES,
  USER_EXPORT_CATEGORY_LABELS,
  type UserExportCategory,
} from "@/lib/user-export-categories";

interface ExportRequestRow {
  id: string;
  status: string;
  requested_categories: string[] | null;
  resolved_categories: string[] | null;
  block_reason: string | null;
  requested_at: string;
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  requested: "secondary",
  scope_resolved: "default",
  blocked: "destructive",
  queued: "secondary",
  generated: "default",
  downloaded: "outline",
  expired: "outline",
  destroyed: "outline",
};

const STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  scope_resolved: "Eligible categories confirmed",
  blocked: "Blocked",
  queued: "Queued",
  generated: "File generated",
  downloaded: "Downloaded",
  expired: "Expired",
  destroyed: "File destroyed",
};

export function DataExportTab() {
  const { user } = useAuth();
  const [selected, setSelected] = useState<Set<UserExportCategory>>(new Set());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<ExportRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRequests = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("user_export_requests")
        .select(
          "id,status,requested_categories,resolved_categories,block_reason,requested_at",
        )
        .eq("user_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      setRequests((data ?? []) as ExportRequestRow[]);
    } catch (e) {
      console.error("[DataExportTab] load failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const toggle = (cat: UserExportCategory) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (selected.size === 0) {
      toast.error("Pick at least one category to include in your export.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "user-export-request",
        {
          body: {
            categories: Array.from(selected),
            reason: reason.trim() || undefined,
          },
        },
      );
      if (error) throw error;
      const resp = data as {
        status?: string;
        next_step?: string;
        block_reason?: string | null;
      };
      if (resp?.status === "blocked") {
        toast.error(resp.next_step ?? "Your export request was blocked.");
      } else {
        toast.success(
          resp?.next_step ??
            "Export request recorded. We will notify you when it is ready.",
        );
      }
      setSelected(new Set());
      setReason("");
      await loadRequests();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Could not submit export request: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-medium text-foreground">
          Request a copy of my data
        </h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
          You may request an export of your personal and account data.
          Submitting this form records your request and confirms which
          categories are eligible. File generation is reviewed and prepared
          separately - your export is not immediately downloadable. You will
          be notified when it is ready.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Restricted data - passwords, API keys, webhook secrets, payment
          card data, admin-only notes, privileged legal records, raw audit
          logs, and other organisations' or users' data - is never included.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          Categories to include
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ALLOWED_USER_EXPORT_CATEGORIES.map((cat) => (
            <label
              key={cat}
              className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/40 cursor-pointer"
            >
              <Checkbox
                checked={selected.has(cat)}
                onCheckedChange={() => toggle(cat)}
                aria-label={USER_EXPORT_CATEGORY_LABELS[cat]}
              />
              <span className="text-sm text-foreground">
                {USER_EXPORT_CATEGORY_LABELS[cat]}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <label htmlFor="export-reason" className="text-sm font-medium text-foreground">
          Reason (optional)
        </label>
        <Textarea
          id="export-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Optional - tell us why you are requesting this export."
          rows={3}
        />
      </section>

      <div>
        <Button
          onClick={handleSubmit}
          disabled={submitting || selected.size === 0}
        >
          {submitting ? "Submitting…" : "Request a copy of my data"}
        </Button>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          Previous requests
        </h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have not made any export requests yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(r.requested_at).toLocaleString()}
                  </span>
                  <Badge variant={STATUS_VARIANTS[r.status] ?? "secondary"}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Requested:{" "}
                  {(r.requested_categories ?? []).join(", ") || "-"}
                </div>
                {r.resolved_categories && r.resolved_categories.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Eligible: {r.resolved_categories.join(", ")}
                  </div>
                )}
                {r.block_reason && (
                  <div className="mt-1 text-xs text-destructive">
                    Blocked: {r.block_reason}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
