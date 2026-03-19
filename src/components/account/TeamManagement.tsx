import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Users, UserPlus, Loader2, Trash2, Info, ShieldCheck, Shield } from "lucide-react";
import { toast } from "sonner";

interface TeamMember {
  id: string;
  email: string;
  full_name: string | null;
  roles: string[];
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export function TeamManagement() {
  const { user, isOrgAdmin } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("org_member");
  const [inviting, setInviting] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; inviteId: string | null }>({ open: false, inviteId: null });
  const [roleChangeDialog, setRoleChangeDialog] = useState<{ open: boolean; member: TeamMember | null; newRole: string }>({ open: false, member: null, newRole: "" });
  const [changingRole, setChangingRole] = useState(false);

  useEffect(() => {
    fetchTeam();
  }, [user]);

  const fetchTeam = async () => {
    try {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user?.id ?? "")
        .maybeSingle();

      if (!profileData?.org_id) return;
      setOrgId(profileData.org_id);

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("org_id", profileData.org_id);

      const memberIds = (profiles || []).map(p => p.id);
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", memberIds.length > 0 ? memberIds : ["00000000-0000-0000-0000-000000000000"]);

      const roleMap = new Map<string, string[]>();
      (roles || []).forEach(r => {
        const existing = roleMap.get(r.user_id) || [];
        existing.push(r.role);
        roleMap.set(r.user_id, existing);
      });

      setMembers((profiles || []).map(p => ({
        id: p.id,
        email: p.email || "",
        full_name: p.full_name,
        roles: roleMap.get(p.id) || [],
      })));

      const { data: invites } = await supabase
        .from("team_invitations")
        .select("id, email, role, status, created_at")
        .eq("org_id", profileData.org_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      setInvitations(invites || []);
    } catch (err) {
      console.error("Error fetching team:", err);
    } finally {
      setLoading(false);
    }
  };

  const ALLOWED_INVITE_ROLES = ["org_member", "org_admin"] as const;

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !orgId || !user) return;

    if (!(ALLOWED_INVITE_ROLES as readonly string[]).includes(inviteRole)) {
      toast.error("Invalid role selected");
      return;
    }

    setInviting(true);
    try {
      const { error } = await supabase
        .from("team_invitations")
        .insert({
          org_id: orgId,
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
          invited_by: user.id,
        });

      if (error) throw error;
      toast.success(`Invitation recorded for ${inviteEmail}`, {
        description: "They will appear in the pending list. Invitation emails are not yet sent automatically — please share the sign-up link with them directly.",
      });
      setInviteEmail("");
      fetchTeam();
    } catch (err: any) {
      console.error("Invite error:", err);
      toast.error("Failed to record invitation", { description: err.message });
    } finally {
      setInviting(false);
    }
  };

  const cancelInvite = async (id: string) => {
    if (!orgId) return;
    try {
      const { error } = await supabase
        .from("team_invitations")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId);

      if (error) throw error;
      toast.success("Invitation cancelled");
      fetchTeam();
    } catch (err) {
      toast.error("Failed to cancel invitation");
    }
  };
  const roleBadgeColour = (role: string) => {
    switch (role) {
      case "platform_admin": return "bg-red-500/10 text-red-700 border-red-200";
      case "org_admin": return "bg-amber-500/10 text-amber-700 border-amber-200";
      case "admin": return "bg-red-500/10 text-red-700 border-red-200";
      default: return "";
    }
  };

  const roleDisplayName = (role: string) => {
    const map: Record<string, string> = {
      org_member: "Member",
      org_admin: "Admin",
      platform_admin: "Platform Admin",
      admin: "Platform Admin",
    };
    return map[role] || role.replace(/_/g, " ");
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Team Members</CardTitle>
          <CardDescription>{members.length} member{members.length !== 1 ? "s" : ""} in your organisation</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                {isOrgAdmin && <TableHead className="w-[100px]">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.full_name || "—"}</TableCell>
                  <TableCell className="text-sm">{m.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {m.roles.map(r => (
                        <Badge key={r} variant="outline" className={`text-xs ${roleBadgeColour(r)}`}>{roleDisplayName(r)}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  {isOrgAdmin && (
                    <TableCell>
                  {m.id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-muted-foreground"
                          onClick={() => toast.info("Role changes are not yet available as a self-service action. Contact support@izenzo.co.za to change a team member's role.", { duration: 6000 })}
                        >
                          Change role
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isOrgAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" />Invite Teammate</CardTitle>
            <CardDescription>Record an invitation for a new team member</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Automated invitation emails are not yet enabled. After recording the invitation below, 
                please share your organisation's sign-up link with the invitee directly.
              </AlertDescription>
            </Alert>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">Email Address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  aria-label="Invite email"
                />
              </div>
              <div className="w-full sm:w-48 space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger aria-label="Select role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="org_member">Member</SelectItem>
                    <SelectItem value="org_admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                  Record Invitation
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Invitations</CardTitle>
            <CardDescription>These invitations have been recorded but require manual follow-up.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{roleDisplayName(inv.role)}</Badge></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setCancelDialog({ open: true, inviteId: inv.id })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Cancel invitation dialog */}
      <AlertDialog open={cancelDialog.open} onOpenChange={(open) => setCancelDialog({ open, inviteId: open ? cancelDialog.inviteId : null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this invitation? The recipient will no longer be able to join your organisation using this invite.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Invitation</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelDialog.inviteId && cancelInvite(cancelDialog.inviteId).then(() => setCancelDialog({ open: false, inviteId: null }))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel Invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
