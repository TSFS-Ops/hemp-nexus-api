import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Users, ShieldCheck, Plus } from "lucide-react";
import { toast } from "sonner";

interface UserRole {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
}

const GOVERNANCE_ROLES = [
  { value: "platform_admin", label: "Platform Admin", description: "Full system access" },
  { value: "org_admin", label: "Org Admin", description: "Full org-level control" },
  { value: "api_admin", label: "API Admin", description: "API key management" },
  { value: "billing_admin", label: "Billing Admin", description: "Token and billing management" },
  { value: "compliance_analyst", label: "Compliance Analyst", description: "Due diligence reviews" },
  { value: "legal_reviewer", label: "Legal Reviewer", description: "Legal document review" },
  { value: "director", label: "Director", description: "Break-glass and BRD changes" },
  { value: "auditor", label: "Auditor (read-only)", description: "View-only access to all logs" },
  { value: "org_member", label: "Org Member", description: "Standard authenticated access" },
];

export function RbacPanel() {
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("");

  useEffect(() => { fetchRoles(); }, []);

  const fetchRoles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setRoles(data || []);
    } catch (error) {
      console.error("Error fetching roles:", error);
    } finally {
      setLoading(false);
    }
  };

  const assignRole = async () => {
    if (!selectedUserId || !selectedRole) {
      toast.error("User ID and role are required");
      return;
    }

    try {
      setAssigning(true);
      const { error } = await supabase
        .from("user_roles")
        .insert([{ user_id: selectedUserId, role: selectedRole as any }]);

      if (error) {
        if (error.code === "23505") {
          toast.error("User already has this role");
          return;
        }
        throw error;
      }

      toast.success(`Role '${selectedRole}' assigned successfully`);
      setSelectedUserId("");
      setSelectedRole("");
      fetchRoles();
    } catch (error) {
      console.error("Error assigning role:", error);
      toast.error("Failed to assign role");
    } finally {
      setAssigning(false);
    }
  };

  const revokeRole = async (roleId: string, userId: string, roleName: string) => {
    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("id", roleId);

      if (error) throw error;
      toast.success(`Role '${roleName}' revoked`);
      fetchRoles();
    } catch (error) {
      console.error("Error revoking role:", error);
      toast.error("Failed to revoke role");
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Group roles by user
  const byUser = roles.reduce<Record<string, UserRole[]>>((acc, r) => {
    if (!acc[r.user_id]) acc[r.user_id] = [];
    acc[r.user_id].push(r);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Role-Based Access Control</h2>
        <p className="text-muted-foreground mt-2">
          Manage governance roles. All role changes are audit logged. No privilege escalation without a log record.
        </p>
      </div>

      {/* Role definitions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Governance Roles
          </CardTitle>
          <CardDescription>Phase 1 BRD-mandated role hierarchy</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {GOVERNANCE_ROLES.map((r) => (
              <div key={r.value} className="border rounded-lg p-3 space-y-1">
                <div className="font-medium text-sm">{r.label}</div>
                <p className="text-xs text-muted-foreground">{r.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Assign role */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Assign Role
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="userId">User ID</Label>
              <input
                id="userId"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="User UUID"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger aria-label="Select role">
                  <SelectValue placeholder="Select role…" />
                </SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={assignRole} disabled={assigning || !selectedUserId || !selectedRole}>
                {assigning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Assign Role
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current assignments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Current Assignments ({roles.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(byUser).map(([userId, userRoles]) => (
              <div key={userId} className="border rounded-lg p-3">
                <div className="font-mono text-xs text-muted-foreground mb-2">
                  {userId.substring(0, 8)}…{userId.substring(userId.length - 4)}
                </div>
                <div className="flex flex-wrap gap-2">
                  {userRoles.map((ur) => (
                    <Badge
                      key={ur.id}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive/20"
                      onClick={() => revokeRole(ur.id, ur.user_id, ur.role)}
                      title="Click to revoke"
                    >
                      {ur.role} ×
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
