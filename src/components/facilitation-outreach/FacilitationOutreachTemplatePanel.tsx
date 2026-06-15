/**
 * Phase 2 Step 4 — Facilitation Outreach template registry panel.
 *
 * HQ-level read panel + lifecycle transitions for the approved-email
 * template registry. platform_admin can approve drafts and archive
 * approved templates via the Step 3 `facilitation-outreach-template-status`
 * edge function. Compliance_analyst may view.
 *
 * Step 4 scope is read + lifecycle status only. Template creation /
 * authoring is intentionally out of scope (no Step 3 endpoint exists);
 * the team seeds templates via migration or a future admin endpoint.
 */
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useOutreachRoles } from "./useOutreachRoles";
import { TEMPLATE_STATUS_LABEL, friendlyFacilitationError } from "@/lib/facilitation-labels";

type Template = {
  id: string;
  slug: string;
  name: string;
  subject: string;
  body_text: string;
  status: "draft" | "approved" | "archived" | string;
  version: number;
  approved_at: string | null;
  archived_at: string | null;
};

export const FacilitationOutreachTemplatePanel: React.FC = () => {
  const { isPlatformAdmin } = useOutreachRoles();
  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("facilitation_outreach_templates")
        .select("id,slug,name,subject,body_text,status,version,approved_at,archived_at")
        .order("name", { ascending: true });
      if (error) throw error;
      setRows((data ?? []) as Template[]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load templates");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const transition = async (tpl: Template, next_status: "approved" | "archived") => {
    if (!isPlatformAdmin) return;
    const reason = (reasonById[tpl.id] ?? "").trim();
    if (!reason) { toast.error("Reason required."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-outreach-template-status", {
        body: { template_id: tpl.id, next_status, reason },
      });
      if (error) throw error;
      toast.success(`Template ${next_status}.`);
      setReasonById((r) => ({ ...r, [tpl.id]: "" }));
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Transition failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="font-medium">Outreach template registry</h3>
        <p className="text-[11px] text-slate-500 font-mono">facilitation-outreach-template-status</p>
      </header>
      {loading && <p className="text-xs text-slate-500">Loading…</p>}
      <ul className="space-y-2">
        {rows.map((t) => (
          <li key={t.id} className="border rounded-sm p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{t.name} <span className="text-slate-400 text-xs">v{t.version}</span></div>
                <div className="font-mono text-[11px] text-slate-500 truncate">{t.slug}</div>
              </div>
              <Badge variant={t.status === "approved" ? "default" : t.status === "archived" ? "outline" : "secondary"}>{t.status}</Badge>
            </div>
            <div className="mt-2 text-xs">
              <div className="text-slate-500">Subject:</div>
              <div>{t.subject}</div>
              <pre className="whitespace-pre-wrap font-mono text-[11px] mt-1 bg-slate-50 rounded-sm p-2 max-h-32 overflow-auto">{t.body_text}</pre>
            </div>
            {isPlatformAdmin && (t.status === "draft" || t.status === "approved") && (
              <div className="mt-2 space-y-2">
                <Textarea
                  rows={2}
                  placeholder={`Reason for ${t.status === "draft" ? "approval" : "archival"}`}
                  value={reasonById[t.id] ?? ""}
                  onChange={(e) => setReasonById((r) => ({ ...r, [t.id]: e.target.value }))}
                />
                {t.status === "draft" && (
                  <Button size="sm" disabled={busy} onClick={() => transition(t, "approved")}>Approve</Button>
                )}
                {t.status === "approved" && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => transition(t, "archived")}>Archive</Button>
                )}
              </div>
            )}
          </li>
        ))}
        {!loading && rows.length === 0 && <li className="text-xs text-slate-500">No templates registered.</li>}
      </ul>
    </div>
  );
};

export default FacilitationOutreachTemplatePanel;
