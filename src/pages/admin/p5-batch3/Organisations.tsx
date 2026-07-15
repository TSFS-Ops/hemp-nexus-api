/**
 * P-5 Batch 3 — Stage 4 funder organisations admin list.
 *
 * Reads live rows from `p5_batch3_funder_organisations` (RLS enforces
 * platform-admin visibility). Mutations route through
 * @/lib/p5-batch3/rpc — no direct writes from UI.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Building2, Plus } from "lucide-react";
import { p5b3CreateFunderOrg, p5b3UpdateFunderOrg } from "@/lib/p5-batch3/rpc";
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  SectionHeading,
  StatusBadge,
  formatDate,
} from "@/lib/funder-workspace/ui";

interface OrgRow {
  id: string;
  name: string;
  jurisdiction: string | null;
  status: "active" | "suspended" | "closed";
  contact_email: string | null;
  created_at: string;
}

const T_ORGS = "p5_batch3_funder_organisations";

export default function P5Batch3Organisations() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [suspending, setSuspending] = useState<OrgRow | null>(null);
  const [suspendBusy, setSuspendBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const { data, error } = await (supabase as any)
      .from(T_ORGS)
      .select("id, name, jurisdiction, status, contact_email, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      setErr(error.message);
      setOrgs([]);
      return;
    }
    setOrgs((data ?? []) as OrgRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (name.trim().length < 2) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    try {
      await p5b3CreateFunderOrg({
        p_name: name.trim(),
        p_jurisdiction: jurisdiction.trim() || null,
        p_contact_email: contact.trim() || null,
      });
      toast.success("Funder organisation created");
      setCreateOpen(false);
      setName("");
      setJurisdiction("");
      setContact("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applySuspend = async (reason?: string) => {
    if (!suspending) return;
    const target = suspending;
    const previous = target.status;
    const nextStatus = target.status === "suspended" ? "active" : "suspended";
    setSuspendBusy(true);
    setOrgs((cur) =>
      cur?.map((o) => (o.id === target.id ? { ...o, status: nextStatus } : o)) ?? cur,
    );
    try {
      await p5b3UpdateFunderOrg({
        p_org_id: target.id,
        p_patch: {
          status: nextStatus,
          suspension_reason: nextStatus === "suspended" ? reason ?? null : null,
        },
      });
      toast.success(
        nextStatus === "suspended" ? "Organisation suspended" : "Organisation reactivated",
      );
      setSuspending(null);
      await load();
    } catch (e) {
      setOrgs((cur) =>
        cur?.map((o) => (o.id === target.id ? { ...o, status: previous } : o)) ?? cur,
      );
      toast.error((e as Error).message);
    } finally {
      setSuspendBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Funder organisations</h1>
          <p className="text-sm text-muted-foreground">
            Create funder organisations and manage their named users.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="p5b3-create-org-trigger">
              <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              New organisation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create funder organisation</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="p5b3-org-name">Legal name</Label>
                <Input
                  id="p5b3-org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p5b3-org-jx">Jurisdiction</Label>
                <Input
                  id="p5b3-org-jx"
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  placeholder="ISO-3166 alpha-2 (e.g. ZA)"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p5b3-org-contact">Primary contact email</Label>
                <Input
                  id="p5b3-org-contact"
                  type="email"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                onClick={handleCreate}
                disabled={busy}
                data-testid="p5b3-create-org-confirm"
              >
                {busy ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {err && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive" role="alert">
            {err}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <SectionHeading
            title="Organisations"
            description="Suspend an organisation to instantly block every user in it from accessing releases."
          />
        </CardHeader>
        <CardContent>
          {orgs === null ? (
            <LoadingState label="Loading organisations…" />
          ) : orgs.length === 0 ? (
            <EmptyState
              title="No funder organisations yet"
              description="Create one to start inviting funder users and releasing deals."
              icon={<Building2 className="h-8 w-8" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Jurisdiction</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgs.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.name}</TableCell>
                      <TableCell>{o.jurisdiction ?? "—"}</TableCell>
                      <TableCell className="text-sm">{o.contact_email ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge kind="org" value={o.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(o.created_at)}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSuspending(o)}
                        >
                          {o.status === "suspended" ? "Reactivate" : "Suspend"}
                        </Button>
                        <Link
                          to={`/admin/p5-batch3/organisations/${o.id}`}
                          className="text-sm underline text-primary"
                        >
                          Manage users
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!suspending}
        onOpenChange={(o) => !o && setSuspending(null)}
        title={
          suspending?.status === "suspended"
            ? `Reactivate ${suspending?.name ?? "organisation"}?`
            : `Suspend ${suspending?.name ?? "organisation"}?`
        }
        description={
          suspending?.status === "suspended" ? (
            <p>Users in this organisation will regain access to their releases.</p>
          ) : (
            <p>
              Every user in this organisation will immediately lose access to
              every release. Existing audit records are preserved.
            </p>
          )
        }
        confirmLabel={suspending?.status === "suspended" ? "Reactivate" : "Suspend"}
        destructive={suspending?.status !== "suspended"}
        requireReason={suspending?.status !== "suspended"}
        reasonLabel="Reason for suspension"
        reasonPlaceholder="e.g. compliance review, contract terminated"
        loading={suspendBusy}
        onConfirm={applySuspend}
      />
    </div>
  );
}
