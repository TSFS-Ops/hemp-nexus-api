import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { auditedDownloadCSV } from "@/lib/download-utils";
import { Loader2, Search, Mail, RefreshCw, Shield, CheckCircle, XCircle, Download, UserX, UserCheck, Eye } from "lucide-react";
import UserDetailDrawer from "./UserDetailDrawer";
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
  organisation_name: string;
  status: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  roles: string[];
  deletion_requested_at: string | null;
  deletion_reason: string | null;
  deletion_category: string | null;
}

const DELETION_CATEGORY_LABELS: Record<string, string> = {
  no_longer_needed: "No longer needed",
  switched_provider: "Switched provider",
  privacy_concerns: "Privacy concerns",
  missing_features: "Missing features",
  too_complex: "Too complex",
  cost: "Cost",
  other: "Other",
};

export default function UsersManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [journeyUserId, setJourneyUserId] = useState<string | null>(null);
  

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);

      const response = await apiFetch<{ users: any[] }>("admin-users");

      setUsers(response.users || []);
      setSelectedUserIds(new Set());
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Failed to fetch users");
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

      toast.success(`Reset email sent to ${email}`);
      setShowResetDialog(false);
    } catch (error) {
      toast.error("Failed to send reset email");
    }
  };

  const handleResendVerification = async (email: string) => {
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email,
      });

      if (error) throw error;

      toast.success(`Verification email sent to ${email}`);
    } catch (error) {
      toast.error("Failed to send verification email");
    }
  };

  const handleUpdateStatus = async (userId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ status: newStatus })
        .eq("id", userId);

      if (error) throw error;

      toast.success(`User status changed to ${newStatus}`);
      fetchUsers();
    } catch (error) {
      toast.error("Failed to update user status");
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

      toast.success(`${userIds.length} users set to ${newStatus}`);
      
      setSelectedUserIds(new Set());
      fetchUsers();
    } catch (error) {
      toast.error("Failed to update users");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const filteredUsers = users.filter((user) =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.organisation_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getUserRoles = (user: User) => {
    if (!user.roles || user.roles.length === 0) return "-";
    return user.roles.join(", ");
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
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

  const exportToCSV = async (usersToExport: User[]) => {
    const headers = ["Email", "Name", "Organisation", "Registered", "Last Sign In", "Email Verified", "Roles", "Status", "Deletion Requested", "Deletion Category", "Deletion Reason"];
    const rows = usersToExport.map((user) => [
      user.email,
      user.full_name || "",
      user.organisation_name,
      user.created_at ? new Date(user.created_at).toISOString() : "",
      user.last_sign_in_at ? new Date(user.last_sign_in_at).toISOString() : "",
      user.email_confirmed_at ? "Yes" : "No",
      getUserRoles(user),
      user.status,
      user.deletion_requested_at ? new Date(user.deletion_requested_at).toISOString() : "",
      user.deletion_category ? (DELETION_CATEGORY_LABELS[user.deletion_category] || user.deletion_category) : "",
      user.deletion_reason || "",
    ]);

    // Batch T — AUD-017: users CSV is sensitive (PII + roles).
    // Route through audited helper so the row count, filters and
    // sensitivity are captured BEFORE bytes leave the browser, and
    // AAL2 can block the download for non-MFA admins.
    const result = await auditedDownloadCSV(headers, rows, {
      reportName: "admin-users",
      filename: `users_export_${new Date().toISOString().split("T")[0]}.csv`,
      target_type: "other",
      sensitive: true,
      filters: {
        scope: usersToExport.length === filteredUsers.length ? "all_filtered" : "selected",
        count: usersToExport.length,
      },
      reason: "admin users export",
    });
    if (result.aal_required) {
      toast.error("Multi-factor authentication required for this export.", {
        description: "Please re-authenticate with MFA to download the users CSV.",
      });
      return;
    }

    toast.success(`Exported ${usersToExport.length} users to CSV`);
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
      <CardHeader className="px-3 sm:px-6">
        <CardTitle>User Management</CardTitle>
        <CardDescription>
          View and manage all users across organisations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-3 sm:px-6">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email, name, or organisation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search users"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportAll} disabled={loading || filteredUsers.length === 0} className="flex-1 sm:flex-none">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {loading ? "" : `${filteredUsers.length} of ${users.length} users shown${users.length >= 10000 ? " (list capped at 10,000)" : ""}`}
          </p>
        </div>

        {selectedCount > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 p-3 bg-muted rounded-md">
            <span className="text-sm font-medium">{selectedCount} selected</span>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => handleBulkStatusUpdate("active")} disabled={bulkActionLoading}>
                <UserCheck className="h-4 w-4 mr-1" /> Activate
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkStatusUpdate("suspended")} disabled={bulkActionLoading}>
                <UserX className="h-4 w-4 mr-1" /> Suspend
              </Button>
              <Button variant="outline" size="sm" onClick={exportSelected} disabled={bulkActionLoading}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedUserIds(new Set())}>Clear</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="space-y-3 md:hidden">
              {filteredUsers.map((user) => (
                <div key={user.id} className={`border rounded-md p-3 space-y-2 ${selectedUserIds.has(user.id) ? "bg-muted/50 border-primary/30" : ""}`}>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={selectedUserIds.has(user.id)}
                      onCheckedChange={() => toggleSelectUser(user.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{user.full_name || user.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {user.email_confirmed_at ? (
                        <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{user.organisation_name}</span>
                    {getUserRoles(user) !== "-" && (
                      <Badge variant="outline" className="text-[10px]">
                        <Shield className="h-2.5 w-2.5 mr-0.5" />
                        {getUserRoles(user)}
                      </Badge>
                    )}
                  </div>
                  {user.status === "pending_deletion" && (
                    <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded p-2 space-y-0.5">
                      <p><strong>Requested:</strong> {formatDateTime(user.deletion_requested_at)}</p>
                      {user.deletion_category && (
                        <p><strong>Category:</strong> {DELETION_CATEGORY_LABELS[user.deletion_category] || user.deletion_category}</p>
                      )}
                      {user.deletion_reason && (
                        <p className="break-words"><strong>Reason:</strong> {user.deletion_reason}</p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t gap-2">
                    {user.status === "pending_deletion" ? (
                      <Badge variant="destructive" className="text-[10px]">
                        <UserX className="h-2.5 w-2.5 mr-0.5" />
                        Pending deletion
                      </Badge>
                    ) : (
                      <Select value={user.status} onValueChange={(value) => handleUpdateStatus(user.id, value)}>
                        <SelectTrigger className="w-28 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 touch-target" onClick={() => setJourneyUserId(user.id)} aria-label="View user journey">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 touch-target" onClick={() => { setSelectedUser(user); setShowResetDialog(true); }}>
                        <Mail className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 touch-target" onClick={() => handleResendVerification(user.email)}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="border rounded-md hidden md:block">
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
                    <TableHead className="hidden lg:table-cell">Organisation</TableHead>
                    <TableHead className="hidden xl:table-cell">Registered</TableHead>
                    <TableHead className="hidden xl:table-cell">Last Sign In</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead className="hidden lg:table-cell">Roles</TableHead>
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
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">{user.email}</TableCell>
                        <TableCell className="max-w-[120px] truncate">{user.full_name || "-"}</TableCell>
                        <TableCell className="hidden lg:table-cell max-w-[120px] truncate">{user.organisation_name}</TableCell>
                        <TableCell className="hidden xl:table-cell text-xs">
                          <Tooltip>
                            <TooltipTrigger>{formatDate(user.created_at)}</TooltipTrigger>
                            <TooltipContent>{formatDateTime(user.created_at)}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell text-xs">
                          <Tooltip>
                            <TooltipTrigger>{formatDate(user.last_sign_in_at)}</TooltipTrigger>
                            <TooltipContent>{formatDateTime(user.last_sign_in_at)}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          {user.email_confirmed_at ? (
                            <Tooltip>
                              <TooltipTrigger><CheckCircle className="h-4 w-4 text-green-600" /></TooltipTrigger>
                              <TooltipContent>Verified on {formatDateTime(user.email_confirmed_at)}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger><XCircle className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
                              <TooltipContent>Not verified</TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {getUserRoles(user) !== "-" ? (
                            <Badge variant="outline" className="flex items-center gap-1 w-fit">
                              <Shield className="h-3 w-3" />
                              {getUserRoles(user)}
                            </Badge>
                          ) : "-"}
                        </TableCell>
                        <TableCell>
                          {user.status === "pending_deletion" ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="destructive" className="cursor-help">
                                  <UserX className="h-3 w-3 mr-1" />
                                  Pending deletion
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="space-y-1 text-xs">
                                  <p><strong>Requested:</strong> {formatDateTime(user.deletion_requested_at)}</p>
                                  {user.deletion_category && (
                                    <p><strong>Category:</strong> {DELETION_CATEGORY_LABELS[user.deletion_category] || user.deletion_category}</p>
                                  )}
                                  {user.deletion_reason && (
                                    <p><strong>Reason:</strong> {user.deletion_reason}</p>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Select value={user.status} onValueChange={(value) => handleUpdateStatus(user.id, value)}>
                              <SelectTrigger className="w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="suspended">Suspended</SelectItem>
                                <SelectItem value="inactive">Inactive</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => setJourneyUserId(user.id)} aria-label="View user journey">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View user journey</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => { setSelectedUser(user); setShowResetDialog(true); }}>
                                  <Mail className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Send password reset</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => handleResendVerification(user.email)}>
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
          </>
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
            <AlertDialogAction onClick={() => selectedUser && handleResetPassword(selectedUser.email)}>
              Send Reset Email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UserDetailDrawer
        userId={journeyUserId}
        open={journeyUserId !== null}
        onOpenChange={(open) => { if (!open) setJourneyUserId(null); }}
      />
    </Card>
  );
}
