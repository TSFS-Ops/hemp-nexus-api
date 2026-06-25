/**
 * P-5 Batch 3 — Stage 4 funder organisation detail (users & roles).
 *
 * Invite users, assign roles, activate/deactivate. All mutations via
 * src/lib/p5-batch3/rpc.ts only.
 */
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { P5B3_FUNDER_ROLES, type P5B3FunderRole } from "@/lib/p5-batch3/constants";
import {
  p5b3AssignFunderRole,
  p5b3InviteFunderUser,
  p5b3SetFunderUserStatus,
} from "@/lib/p5-batch3/rpc";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: P5B3FunderRole;
  status: "invited" | "active" | "deactivated";
}

const PLACEHOLDER_USERS: UserRow[] = [
  { id: "u-1", email: "approver@example.com", display_name: "A. Approver", role: "funder_approver", status: "active" },
  { id: "u-2", email: "viewer@example.com", display_name: "V. Viewer", role: "funder_viewer", status: "invited" },
];

export default function P5Batch3OrganisationDetail() {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [users] = useState<UserRow[]>(PLACEHOLDER_USERS);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<P5B3FunderRole>("funder_viewer");
  const [busy, setBusy] = useState(false);

  const handleInvite = async () => {
    if (!organisationId) return;
    if (!email.includes("@")) {
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
      setOpen(false);
      setEmail("");
      setDisplayName("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAssignRole = async (userId: string, newRole: P5B3FunderRole) => {
    try {
      await p5b3AssignFunderRole({ p_user_id: userId, p_role: newRole });
      toast.success("Role updated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleStatus = async (
    userId: string,
    status: "active" | "deactivated",
  ) => {
    try {
      await p5b3SetFunderUserStatus({ p_user_id: userId, p_status: status, p_reason: "admin action" });
      toast.success("Status updated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin/p5-batch3/organisations" className="text-sm text-muted-foreground underline">
            ← Organisations
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Organisation users</h1>
          <p className="text-sm text-muted-foreground">
            Organisation ID: <span className="font-mono">{organisationId}</span>
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="p5b3-invite-user-trigger">Invite user</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite funder user</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              A role alone does not grant access to any transaction. Access is granted
              separately under Release to Funder.
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="p5b3-invite-email">Email</Label>
                <Input id="p5b3-invite-email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p5b3-invite-name">Display name (optional)</Label>
                <Input id="p5b3-invite-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as P5B3FunderRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {P5B3_FUNDER_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={handleInvite} disabled={busy} data-testid="p5b3-invite-user-confirm">
                Send invite
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Users</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Display name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.display_name}</TableCell>
                  <TableCell className="font-mono text-xs">{u.email}</TableCell>
                  <TableCell>
                    <Select
                      defaultValue={u.role}
                      onValueChange={(v) => handleAssignRole(u.id, v as P5B3FunderRole)}
                    >
                      <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {P5B3_FUNDER_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "default" : "secondary"}>{u.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {u.status === "active" ? (
                      <Button size="sm" variant="outline" onClick={() => handleStatus(u.id, "deactivated")}>
                        Deactivate
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleStatus(u.id, "active")}>
                        Activate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
