/**
 * P-5 Batch 3 — Stage 4 funder organisation detail (users & roles).
 *
 * All mutations route through src/lib/p5-batch3/rpc.ts. Reads use the
 * p5_batch3_funder_users table directly (RLS on the server enforces
 * platform-admin visibility).
 *
  * Resend invitation calls p5b3_admin_resend_funder_invite_v1 directly;
   * the RPC only allows resending while status='invited' and re-stamps
    * invited_at/invited_by server-side, with a p5b3_audit trail entry.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { UserPlus, Mail } from "lucide-react";
import { P5B3_FUNDER_ROLES, type P5B3FunderRole } from "@/lib/p5-batch3/constants";
import {
  p5b3AssignFunderRole,
  p5b3InviteFunderUser,
    p5b3ResendFunderInvite,
  p5b3SetFunderUserStatus,
} from "@/lib/p5-batch3/rpc";
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  SectionHeading,
  StatusBadge,
  formatDateTime,
  funderRoleLabel,
} from "@/lib/funder-workspace/ui";

interface FunderUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: P5B3FunderRole;
  status: "invited" | "active" | "deactivated";
  created_at: string;
  updated_at: string;
}

const T_USERS = "p5_batch3_funder_users";

export default function P5Batch3OrganisationDetail() {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [users, setUsers] = useState<FunderUserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<P5B3FunderRole>("funder_viewer");
  const [busy, setBusy] = useState(false);

  // Confirmation-dialog state (deactivate + role change use the same primitive)
  const [deactivating, setDeactivating] = useState<FunderUserRow | null>(null);
  const [roleChange, setRoleChange] = useState<{
    user: FunderUserRow;
    newRole: P5B3FunderRole;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
    const [resendingId, setResendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organisationId) return;
    setErr(null);
    const { data, error } = await (supabase as any)
      .from(T_USERS)
      .select("id, email, display_name, role, status, created_at, updated_at")
      .eq("funder_organisation_id", organisationId)
      .order("created_at", { ascending: false });
    if (error) {
      setErr(error.message);
      setUsers([]);
      return;
    }
    setUsers((data ?? []) as FunderUserRow[]);
  }, [organisationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { pending, active } = useMemo(() => {
    const p: FunderUserRow[] = [];
    const a: FunderUserRow[] = [];
    for (const u of users ?? []) {
      if (u.status === "invited") p.push(u);
      else a.push(u);
    }
    return { pending: p, active: a };
  }, [users]);

  const handleInvite = async () => {
    if (!organisationId) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("Valid email required");
      return;
    }
    setBusy(true);
    try {
      await p5b3InviteFunderUser({
        p_org_id: organisationId,
        p_email: email.trim(),
        p_display_name: displayName.trim() || null,
        p_role: role,
      });
      toast.success("Invite sent");
      setInviteOpen(false);
      setEmail("");
      setDisplayName("");
      setRole("funder_viewer");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async (u: FunderUserRow) => {
        setResendingId(u.id);
        try {
                await p5b3ResendFunderInvite({ p_user_id: u.id });
                toast.success(`Invitation resent to ${u.email}`);
                await load();
        } catch (e) {
                toast.error((e as Error).message);
        } finally {
                setResendingId(null);
        }
  };

  const applyRoleChange = async (reason?: string) => {
    if (!roleChange) return;
    const { user, newRole } = roleChange;
    const previousRole = user.role;
    setConfirmBusy(true);
    // Optimistic UI: update, then rollback on error
    setUsers((cur) =>
      cur?.map((x) => (x.id === user.id ? { ...x, role: newRole } : x)) ?? cur,
    );
    try {
      await p5b3AssignFunderRole({ p_user_id: user.id, p_role: newRole });
      toast.success(
        `Role updated to ${funderRoleLabel(newRole)}${reason ? ` — ${reason}` : ""}`,
      );
      setRoleChange(null);
      await load();
    } catch (e) {
      // Rollback
      setUsers((cur) =>
        cur?.map((x) => (x.id === user.id ? { ...x, role: previousRole } : x)) ?? cur,
      );
      toast.error((e as Error).message);
    } finally {
      setConfirmBusy(false);
    }
  };

  const applyDeactivate = async (reason?: string) => {
    if (!deactivating) return;
    const user = deactivating;
    setConfirmBusy(true);
    // Optimistic
    const previous = user.status;
    setUsers((cur) =>
      cur?.map((x) => (x.id === user.id ? { ...x, status: "deactivated" } : x)) ?? cur,
    );
    try {
      await p5b3SetFunderUserStatus({
        p_user_id: user.id,
        p_status: "deactivated",
        p_reason: reason ?? null,
      });
      toast.success(`${user.email} deactivated`);
      setDeactivating(null);
      await load();
    } catch (e) {
      setUsers((cur) =>
        cur?.map((x) => (x.id === user.id ? { ...x, status: previous } : x)) ?? cur,
      );
      toast.error((e as Error).message);
    } finally {
      setConfirmBusy(false);
    }
  };

  const applyReactivate = async (u: FunderUserRow) => {
    const previous = u.status;
    setUsers((cur) =>
      cur?.map((x) => (x.id === u.id ? { ...x, status: "active" } : x)) ?? cur,
    );
    try {
      await p5b3SetFunderUserStatus({
        p_user_id: u.id,
        p_status: "active",
        p_reason: "reactivated by admin",
      });
      toast.success(`${u.email} reactivated`);
      await load();
    } catch (e) {
      setUsers((cur) =>
        cur?.map((x) => (x.id === u.id ? { ...x, status: previous } : x)) ?? cur,
      );
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/admin/p5-batch3/organisations"
            className="text-sm text-muted-foreground underline"
          >
            ← Organisations
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Funder organisation users</h1>
          <p className="text-sm text-muted-foreground">
            Invite, promote and deactivate the users belonging to this funder
            organisation. Assigning a role does <strong>not</strong> grant access
            to any transaction — access is granted separately via a release.
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button data-testid="p5b3-invite-user-trigger">
              <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
              Invite user
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite funder user</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              A role alone does not grant access to any transaction. Access is
              granted separately under Release to Funder.
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="p5b3-invite-email">Email</Label>
                <Input
                  id="p5b3-invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p5b3-invite-name">Display name (optional)</Label>
                <Input
                  id="p5b3-invite-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p5b3-invite-role">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as P5B3FunderRole)}>
                  <SelectTrigger id="p5b3-invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {P5B3_FUNDER_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {funderRoleLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                onClick={handleInvite}
                disabled={busy}
                data-testid="p5b3-invite-user-confirm"
              >
                {busy ? "Sending…" : "Send invite"}
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
            title="Pending invitations"
            description="Users who have been invited but have not yet accepted."
          />
        </CardHeader>
        <CardContent>
          {users === null ? (
            <LoadingState label="Loading users…" />
          ) : pending.length === 0 ? (
            <EmptyState
              title="No pending invitations"
              description="Invited users will appear here until they accept."
              icon={<Mail className="h-8 w-8" />}
            />
          ) : (
            <UserTable
              rows={pending}
              onResend={handleResend}
                      resendingId={resendingId}
              onDeactivate={(u) => setDeactivating(u)}
              onReactivate={applyReactivate}
              onRoleChange={(user, newRole) => setRoleChange({ user, newRole })}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeading
            title="Active team"
            description="Users who have accepted the invitation."
          />
        </CardHeader>
        <CardContent>
          {users === null ? (
            <LoadingState label="Loading users…" />
          ) : active.length === 0 ? (
            <EmptyState
              title="No active users yet"
              description="Once an invited user accepts, they will appear here."
            />
          ) : (
            <UserTable
              rows={active}
              onResend={handleResend}
                      resendingId={resendingId}
              onDeactivate={(u) => setDeactivating(u)}
              onReactivate={applyReactivate}
              onRoleChange={(user, newRole) => setRoleChange({ user, newRole })}
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`Deactivate ${deactivating?.email ?? "user"}?`}
        description={
          <>
            <p>
              The user will lose access to this funder organisation and all
              releases attached to it. Existing audit records are preserved.
            </p>
            <p className="mt-2">You can reactivate them again later.</p>
          </>
        }
        confirmLabel="Deactivate user"
        destructive
        requireReason
        reasonLabel="Reason for deactivation"
        reasonPlaceholder="e.g. left the organisation, role change requested"
        loading={confirmBusy}
        onConfirm={applyDeactivate}
      />

      <ConfirmDialog
        open={!!roleChange}
        onOpenChange={(o) => !o && setRoleChange(null)}
        title="Change user role?"
        description={
          roleChange ? (
            <p>
              Change <strong>{roleChange.user.email}</strong> from{" "}
              <strong>{funderRoleLabel(roleChange.user.role)}</strong> to{" "}
              <strong>{funderRoleLabel(roleChange.newRole)}</strong>.
            </p>
          ) : null
        }
        confirmLabel="Change role"
        loading={confirmBusy}
        onConfirm={applyRoleChange}
      />
    </div>
  );
}

interface TableProps {
  rows: FunderUserRow[];
  onRoleChange: (user: FunderUserRow, newRole: P5B3FunderRole) => void;
  onDeactivate: (user: FunderUserRow) => void;
  onReactivate: (user: FunderUserRow) => void;
  onResend: (user: FunderUserRow) => void;
    resendingId: string | null;
}

function UserTable({ rows, onRoleChange, onDeactivate, onReactivate, onResend, resendingId }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last update</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="font-medium">{u.display_name || u.email}</div>
                {u.display_name && (
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={u.role}
                  onValueChange={(v) => onRoleChange(u, v as P5B3FunderRole)}
                >
                  <SelectTrigger className="w-44 h-8" aria-label={`Change role for ${u.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {P5B3_FUNDER_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {funderRoleLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <StatusBadge kind="user" value={u.status} />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(u.updated_at)}
              </TableCell>
              <TableCell className="text-right space-x-2">
                {u.status === "invited" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onResend(u)}
disabled={resendingId === u.id}
                                    title="Resend invitation"
                                  >
                                  <Mail className="h-4 w-4 mr-1" aria-hidden="true" />
                    {resendingId === u.id ? "Sending…" : "Resend"}
                  </Button>
                )}
                {u.status === "deactivated" ? (
                  <Button size="sm" variant="outline" onClick={() => onReactivate(u)}>
                    Reactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDeactivate(u)}
                    aria-label={`Deactivate ${u.email}`}
                  >
                    Deactivate
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
