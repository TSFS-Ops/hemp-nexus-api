import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Mail, RefreshCw, Shield, CheckCircle, XCircle, Download, UserX, UserCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  org_id: string | null;
  organization_name: string;
  status: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  roles: string[];
}

export default function UsersManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("admin-users", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) throw response.error;
      
      setUsers(response.data.users || []);
      setSelectedUserIds(new Set());
    } catch (error) {
      console.error("Error fetching users:", error);
      toast({
        title: "Error",
        description: "Failed to fetch users",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });

      if (error) throw error;

      toast({
        title: "Password Reset Sent",
        description: `Reset email sent to ${email}`,
      });
      setShowResetDialog(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send reset email",
        variant: "destructive",
      });
    }
  };

  const handleResendVerification = async (email: string) => {
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email,
      });

      if (error) throw error;

      toast({
        title: "Verification Email Sent",
        description: `Verification email sent to ${email}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send verification email",
        variant: "destructive",
      });
    }
  };

  const handleUpdateStatus = async (userId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ status: newStatus })
        .eq("id", userId);

      if (error) throw error;

      toast({
        title: "Status Updated",
        description: `User status changed to ${newStatus}`,
      });
      fetchUsers();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update user status",
        variant: "destructive",
      });
    }
  };

  const handleBulkStatusUpdate = async (newStatus: string) => {
    if (selectedUserIds.size === 0) return;
    
    setBulkActionLoading(true);
    try {
      const userIds = Array.from(selectedUserIds);
      
      const { error } = await supabase
        .from("profiles")
        .update({ status: newStatus })
        .in("id", userIds);

      if (error) throw error;

      toast({
        title: "Bulk Update Complete",
        description: `${userIds.length} users set to ${newStatus}`,
      });
      
      setSelectedUserIds(new Set());
      fetchUsers();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update users",
        variant: "destructive",
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const filteredUsers = users.filter((user) =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.organization_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getUserRoles = (user: User) => {
    if (!user.roles || user.roles.length === 0) return "—";
    return user.roles.join(", ");
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString();
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  const toggleSelectAll = () => {
    if (selectedUserIds.size === filteredUsers.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(filteredUsers.map((u) => u.id)));
    }
  };

  const toggleSelectUser = (userId: string) => {
    const newSelected = new Set(selectedUserIds);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUserIds(newSelected);
  };

  const exportToCSV = (usersToExport: User[]) => {
    const headers = ["Email", "Name", "Organization", "Registered", "Last Sign In", "Email Verified", "Roles", "Status"];
    const rows = usersToExport.map((user) => [
      user.email,
      user.full_name || "",
      user.organization_name,
      user.created_at ? new Date(user.created_at).toISOString() : "",
      user.last_sign_in_at ? new Date(user.last_sign_in_at).toISOString() : "",
      user.email_confirmed_at ? "Yes" : "No",
      getUserRoles(user),
      user.status,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `users_export_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: `Exported ${usersToExport.length} users to CSV`,
    });
  };

  const exportAll = () => exportToCSV(filteredUsers);
  
  const exportSelected = () => {
    const selectedUsers = filteredUsers.filter((u) => selectedUserIds.has(u.id));
    exportToCSV(selectedUsers);
  };

  const selectedCount = selectedUserIds.size;
  const allSelected = filteredUsers.length > 0 && selectedCount === filteredUsers.length;
  const someSelected = selectedCount > 0 && selectedCount < filteredUsers.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>
          View and manage all users across organizations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email, name, or organization..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={exportAll} disabled={loading || filteredUsers.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export All
          </Button>
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {selectedCount > 0 && (
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">{selectedCount} selected</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkStatusUpdate("active")}
                disabled={bulkActionLoading}
              >
                <UserCheck className="h-4 w-4 mr-2" />
                Activate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkStatusUpdate("suspended")}
                disabled={bulkActionLoading}
              >
                <UserX className="h-4 w-4 mr-2" />
                Suspend
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportSelected}
                disabled={bulkActionLoading}
              >
                <Download className="h-4 w-4 mr-2" />
                Export Selected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedUserIds(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                      className={someSelected ? "data-[state=checked]:bg-primary/50" : ""}
                    />
                  </TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Last Sign In</TableHead>
                  <TableHead>Email Verified</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TooltipProvider>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id} className={selectedUserIds.has(user.id) ? "bg-muted/50" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={selectedUserIds.has(user.id)}
                          onCheckedChange={() => toggleSelectUser(user.id)}
                          aria-label={`Select ${user.email}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{user.email}</TableCell>
                      <TableCell>{user.full_name || "—"}</TableCell>
                      <TableCell>{user.organization_name}</TableCell>
                      <TableCell className="text-xs">
                        <Tooltip>
                          <TooltipTrigger>{formatDate(user.created_at)}</TooltipTrigger>
                          <TooltipContent>{formatDateTime(user.created_at)}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Tooltip>
                          <TooltipTrigger>{formatDate(user.last_sign_in_at)}</TooltipTrigger>
                          <TooltipContent>{formatDateTime(user.last_sign_in_at)}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        {user.email_confirmed_at ? (
                          <Tooltip>
                            <TooltipTrigger>
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            </TooltipTrigger>
                            <TooltipContent>Verified on {formatDateTime(user.email_confirmed_at)}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger>
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>Not verified</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        {getUserRoles(user) !== "—" ? (
                          <Badge variant="outline" className="flex items-center gap-1 w-fit">
                            <Shield className="h-3 w-3" />
                            {getUserRoles(user)}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={user.status}
                          onValueChange={(value) => handleUpdateStatus(user.id, value)}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="suspended">Suspended</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedUser(user);
                                  setShowResetDialog(true);
                                }}
                              >
                                <Mail className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Send password reset</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleResendVerification(user.email)}
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Resend verification email</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TooltipProvider>
              </TableBody>
            </Table>
          </div>
        )}

        {!loading && filteredUsers.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No users found matching your search
          </div>
        )}
      </CardContent>

      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Password Reset</AlertDialogTitle>
            <AlertDialogDescription>
              Send a password reset email to {selectedUser?.email}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedUser && handleResetPassword(selectedUser.email)}
            >
              Send Reset Email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
