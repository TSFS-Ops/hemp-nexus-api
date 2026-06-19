/**
 * Facilitation Batch 12 — Admin Notification Template Editor panel.
 *
 * HQ-only authoring UI. Allowed operations:
 *   - create new draft template
 *   - create new draft linked to a previously approved template
 *     (`previous_template_id`)
 *   - edit a draft template
 *   - submit draft for approval (separation of duties; approval still
 *     happens on the existing FacilitationOutreachTemplatePanel via the
 *     facilitation-outreach-template-status function)
 *   - read-only diff against the previously approved version of the same slug
 *   - read-only variable substitution preview using fixed sample data
 *
 * Hard guarantees:
 *   - This panel NEVER sends an email / Slack / SMS / WhatsApp / webhook.
 *   - This panel NEVER approves a template.
 *   - This panel NEVER edits an approved or archived template.
 *   - This panel NEVER renders or edits the requester-safe notification
 *     trigger catalogue.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOutreachRoles } from "@/components/facilitation-outreach/useOutreachRoles";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";
import {
  TEMPLATE_PREVIEW_SAMPLE,
  findForbiddenBodyMatches,
  renderPreview,
} from "@/lib/facilitation-template-editor";

type Template = {
  id: string;
  slug: string;
  name: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  status: "draft" | "approved" | "archived" | string;
  version: number;
  previous_template_id: string | null;
  submitted_for_approval_at: string | null;
  created_by: string | null;
  approved_at: string | null;
  archived_at: string | null;
};

type DraftForm = {
  slug: string;
  name: string;
  subject: string;
  body_text: string;
  body_html: string;
  previous_template_id: string | null;
};

const EMPTY_FORM: DraftForm = {
  slug: "",
  name: "",
  subject: "",
  body_text: "",
  body_html: "",
  previous_template_id: null,
};

function statusBadgeVariant(t: Template) {
  if (t.status === "approved") return "default" as const;
  if (t.status === "archived") return "outline" as const;
  return "secondary" as const;
}

function statusLabel(t: Template): string {
  if (t.status === "draft" && t.submitted_for_approval_at) return "Pending approval";
  if (t.status === "draft") return "Draft";
  if (t.status === "approved") return "Approved";
  if (t.status === "archived") return "Archived";
  return t.status;
}

// Tiny line-by-line diff renderer (read-only). No external dep.
function lineDiff(prev: string, next: string): Array<{ kind: "same" | "add" | "del"; text: string }> {
  const a = (prev ?? "").split("\n");
  const b = (next ?? "").split("\n");
  const out: Array<{ kind: "same" | "add" | "del"; text: string }> = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv && av !== undefined) out.push({ kind: "same", text: av });
    else {
      if (av !== undefined) out.push({ kind: "del", text: av });
      if (bv !== undefined) out.push({ kind: "add", text: bv });
    }
  }
  return out;
}

export const FacilitationTemplateEditorPanel: React.FC = () => {
  const { isPlatformAdmin, isComplianceAnalyst, loading: rolesLoading } = useOutreachRoles();
  const canEdit = isPlatformAdmin || isComplianceAnalyst;
  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [mode, setMode] = useState<"idle" | "create" | "edit">("idle");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("facilitation_outreach_templates")
        .select("id,slug,name,subject,body_text,body_html,status,version,previous_template_id,submitted_for_approval_at,created_by,approved_at,archived_at")
        .order("status", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      setRows((data ?? []) as Template[]);
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not load templates."));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const beginCreate = (previous?: Template) => {
    setMode("create");
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      previous_template_id: previous?.id ?? null,
      name: previous ? `${previous.name} (next version)` : "",
      subject: previous?.subject ?? "",
      body_text: previous?.body_text ?? "",
      body_html: previous?.body_html ?? "",
    });
  };

  const beginEdit = (t: Template) => {
    if (t.status !== "draft") {
      toast.error("Only draft templates can be edited. Create a new draft linked to this approved version instead.");
      return;
    }
    setMode("edit");
    setEditingId(t.id);
    setForm({
      slug: t.slug,
      name: t.name,
      subject: t.subject,
      body_text: t.body_text,
      body_html: t.body_html ?? "",
      previous_template_id: t.previous_template_id,
    });
  };

  const cancel = () => { setMode("idle"); setEditingId(null); setForm(EMPTY_FORM); };

  const previousApproved = useMemo<Template | null>(() => {
    if (!form.previous_template_id) return null;
    return rows.find((r) => r.id === form.previous_template_id) ?? null;
  }, [rows, form.previous_template_id]);

  const forbiddenHits = useMemo(
    () => [
      ...findForbiddenBodyMatches(form.body_text).map((l) => `body_text: ${l}`),
      ...findForbiddenBodyMatches(form.body_html).map((l) => `body_html: ${l}`),
    ],
    [form.body_text, form.body_html],
  );

  const submit = async () => {
    if (!canEdit) return;
    if (forbiddenHits.length > 0) {
      toast.error(`Cannot save — forbidden content: ${forbiddenHits.join(", ")}`);
      return;
    }
    setBusy(true);
    try {
      if (mode === "create") {
        const body = {
          action: "create_draft",
          slug: form.slug.trim(),
          name: form.name.trim(),
          subject: form.subject,
          body_text: form.body_text,
          body_html: form.body_html || null,
          previous_template_id: form.previous_template_id,
        };
        const { error } = await supabase.functions.invoke("facilitation-template-editor", { body });
        if (error) throw error;
        toast.success("Draft created.");
      } else if (mode === "edit" && editingId) {
        const body = {
          action: "update_draft",
          template_id: editingId,
          name: form.name.trim(),
          subject: form.subject,
          body_text: form.body_text,
          body_html: form.body_html || null,
        };
        const { error } = await supabase.functions.invoke("facilitation-template-editor", { body });
        if (error) throw error;
        toast.success("Draft updated.");
      }
      cancel();
      await load();
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not save the draft. Please try again."));
    } finally { setBusy(false); }
  };

  const submitForApproval = async (t: Template) => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-template-editor", {
        body: { action: "submit_for_approval", template_id: t.id },
      });
      if (error) throw error;
      toast.success("Draft submitted for approval.");
      await load();
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not submit for approval."));
    } finally { setBusy(false); }
  };

  if (rolesLoading) return <p className="text-xs text-slate-500">Loading…</p>;
  if (!canEdit) return null;

  return (
    <div className="space-y-3" data-testid="facilitation-template-editor-panel">
      <header className="space-y-1">
        <h3 className="font-medium">Template editor (drafts only)</h3>
        <p className="text-[11px] text-slate-500">
          Author or correct facilitation outreach templates. This panel never sends anything.
          Approval and archival still happen on the template registry panel.
        </p>
      </header>

      {mode === "idle" && (
        <Button size="sm" onClick={() => beginCreate()}>New draft</Button>
      )}

      {mode !== "idle" && (
        <div className="border border-border rounded-sm p-3 space-y-2 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-xs space-y-1">
              <span className="text-slate-500">Slug</span>
              <Input
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                disabled={mode === "edit"}
                placeholder="counterparty-introduction-v2"
                aria-label="slug"
              />
              {mode === "edit" && <span className="text-[10px] text-slate-400">Slug cannot be changed on edit.</span>}
            </label>
            <label className="text-xs space-y-1">
              <span className="text-slate-500">Name</span>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                aria-label="name"
              />
            </label>
          </div>
          <label className="text-xs space-y-1 block">
            <span className="text-slate-500">Subject ({form.subject.length} chars)</span>
            <Input
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              aria-label="subject"
            />
          </label>
          <label className="text-xs space-y-1 block">
            <span className="text-slate-500">Body (text)</span>
            <Textarea
              rows={6}
              value={form.body_text}
              onChange={(e) => setForm((f) => ({ ...f, body_text: e.target.value }))}
              aria-label="body_text"
            />
          </label>
          <label className="text-xs space-y-1 block">
            <span className="text-slate-500">Body (HTML, optional)</span>
            <Textarea
              rows={4}
              value={form.body_html}
              onChange={(e) => setForm((f) => ({ ...f, body_html: e.target.value }))}
              aria-label="body_html"
            />
          </label>

          {forbiddenHits.length > 0 && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-sm p-2">
              Forbidden content: {forbiddenHits.join(", ")}
            </div>
          )}

          {/* Variable preview (read-only, fixed sample, no send) */}
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500">Variable preview (sample data, no send)</summary>
            <div className="mt-2 space-y-1">
              <div><span className="text-slate-500">Subject:</span> {renderPreview(form.subject)}</div>
              <pre className="whitespace-pre-wrap font-mono text-[11px] bg-slate-50 rounded-sm p-2 max-h-40 overflow-auto">{renderPreview(form.body_text)}</pre>
              <div className="text-[10px] text-slate-400">
                Sample: {Object.entries(TEMPLATE_PREVIEW_SAMPLE).map(([k, v]) => `${k}=${v}`).join(", ")}
              </div>
            </div>
          </details>

          {/* Diff against previous approved version (read-only) */}
          {previousApproved && (
            <details className="text-xs" open>
              <summary className="cursor-pointer text-slate-500">
                Diff vs previously approved: {previousApproved.name} (v{previousApproved.version})
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] bg-slate-50 rounded-sm p-2 max-h-48 overflow-auto" data-testid="template-diff">
                {lineDiff(previousApproved.body_text, form.body_text).map((d, i) => (
                  <div key={i} className={d.kind === "add" ? "text-green-700" : d.kind === "del" ? "text-red-700" : "text-slate-700"}>
                    {d.kind === "add" ? "+ " : d.kind === "del" ? "- " : "  "}{d.text}
                  </div>
                ))}
              </pre>
            </details>
          )}

          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={submit}>
              {mode === "create" ? "Create draft" : "Save draft"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}

      {loading && <p className="text-xs text-slate-500">Loading…</p>}
      <ul className="space-y-2">
        {rows.map((t) => (
          <li key={t.id} className="border border-border rounded-sm p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {t.name} <span className="text-slate-400 text-xs">v{t.version}</span>{" "}
                  <span className="text-slate-400 text-xs">· {t.slug}</span>
                </div>
              </div>
              <Badge variant={statusBadgeVariant(t)}>{statusLabel(t)}</Badge>
            </div>
            <div className="mt-2 text-xs text-slate-500">Subject: <span className="text-slate-800">{t.subject}</span></div>
            <div className="mt-2 flex flex-wrap gap-2">
              {t.status === "draft" && (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => beginEdit(t)}>Edit draft</Button>
                  {!t.submitted_for_approval_at && (
                    <Button size="sm" disabled={busy} onClick={() => submitForApproval(t)}>Submit for approval</Button>
                  )}
                </>
              )}
              {t.status === "approved" && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => beginCreate(t)}>
                  Start new draft from this version
                </Button>
              )}
            </div>
          </li>
        ))}
        {!loading && rows.length === 0 && <li className="text-xs text-slate-500">No templates yet.</li>}
      </ul>
    </div>
  );
};

export default FacilitationTemplateEditorPanel;
