/**
 * OPS-010 — HQ → Demo Workspaces admin panel.
 *
 * Platform-admin-only. Lists existing demo workspaces, supports create /
 * reset / archive. All mutations call the dedicated admin edge functions
 * which enforce platform_admin + AAL2 + reason ≥ 20 chars server-side.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { OPS_010_MIN_REASON_LENGTH } from "@/lib/ops/ops-010-audit";
import { useToast } from "@/hooks/use-toast";

interface DemoWorkspaceRow {
  id: string;
  org_id: string;
  dataset_id: string;
  status: string;
  created_by: string | null;
  created_at: string;
  reset_at: string | null;
  archived_at: string | null;
  notes: string | null;
}

export function AdminDemoWorkspacesPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<DemoWorkspaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<null | { mode: "create" | "reset" | "archive"; row?: DemoWorkspaceRow }>(null);
  const [reason, setReason] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("demo_workspaces")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data as DemoWorkspaceRow[]) ?? []);
    } catch (e) {
      console.error("[ops-010] list failed", e);
      toast({ title: "Failed to load demo workspaces", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const close = () => { setOpen(null); setReason(""); setOrgName(""); };

  const handleSubmit = async () => {
    if (!open) return;
    if (reason.trim().length < OPS_010_MIN_REASON_LENGTH) {
      toast({ title: `Reason must be at least ${OPS_010_MIN_REASON_LENGTH} characters`, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const fn =
        open.mode === "create" ? "admin-demo-workspace-create"
        : open.mode === "reset" ? "admin-demo-workspace-reset"
        : "admin-demo-workspace-archive";
      const body: Record<string, unknown> = { reason: reason.trim() };
      if (open.mode === "create" && orgName.trim()) body.org_name = orgName.trim();
      if (open.mode !== "create" && open.row) body.dataset_id = open.row.dataset_id;

      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { code?: string; error: string }).code ?? (data as { error: string }).error);

      toast({ title: `Demo workspace ${open.mode} succeeded` });
      close();
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("MFA_REQUIRED")) {
        toast({ title: "MFA required", description: "Re-authenticate with TOTP and try again.", variant: "destructive" });
      } else if (msg.includes("NOT_PLATFORM_ADMIN")) {
        toast({ title: "Platform admin only", variant: "destructive" });
      } else {
        toast({ title: "Operation failed", description: msg, variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Demo Workspaces</h3>
          <p className="text-sm text-muted-foreground">
            OPS-010 — controlled demo isolation. Zero outbound email, zero live payments, zero live compliance.
          </p>
        </div>
        <Button onClick={() => setOpen({ mode: "create" })}>New demo workspace</Button>
      </div>

      <div className="border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 font-mono">Dataset ID</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Last reset</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No demo workspaces yet.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">
                  <Badge variant={r.status === "active" ? "default" : r.status === "reset" ? "secondary" : "outline"}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.dataset_id}</td>
                <td className="px-3 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs">{r.reset_at ? new Date(r.reset_at).toLocaleString() : "—"}</td>
                <td className="px-3 py-2 text-right space-x-2">
                  <Button size="sm" variant="outline" disabled={r.status === "archived"} onClick={() => setOpen({ mode: "reset", row: r })}>Reset</Button>
                  <Button size="sm" variant="destructive" disabled={r.status === "archived"} onClick={() => setOpen({ mode: "archive", row: r })}>Archive</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!open} onOpenChange={(v) => { if (!v) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open?.mode === "create" && "Create demo workspace"}
              {open?.mode === "reset" && "Reset demo workspace"}
              {open?.mode === "archive" && "Archive demo workspace"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {open?.mode === "create" && (
              <div>
                <label className="text-sm font-medium">Demo org name (optional)</label>
                <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="OPS-010 Demo Org" />
              </div>
            )}
            <div>
              <label className="text-sm font-medium">
                Reason (≥ {OPS_010_MIN_REASON_LENGTH} chars) — recorded in audit log
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="Why is this action required? Will be persisted to admin audit."
              />
              <div className="text-xs text-muted-foreground mt-1">{reason.trim().length} / {OPS_010_MIN_REASON_LENGTH}</div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              Requires platform_admin + AAL2 (MFA). All mutations write canonical <code>ops.demo_workspace_*</code> audit rows.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost" disabled={busy}>Cancel</Button></DialogClose>
            <Button onClick={handleSubmit} disabled={busy || reason.trim().length < OPS_010_MIN_REASON_LENGTH}>
              {busy ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
