/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin: Funder Organisations list. Read-only in this batch.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listFunderOrganisations } from "@/lib/funder-workspace/admin-client";
import type { FunderOrganisationRow } from "@/lib/funder-workspace/types";

export default function FunderWorkspaceOrganisations() {
  const [rows, setRows] = useState<FunderOrganisationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalFilter, setApprovalFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setRows(await listFunderOrganisations());
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((o) => {
      if (approvalFilter !== "all" && (o.approval_status ?? "admin_created") !== approvalFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (needle) {
        const hay = `${o.name} ${o.contact_email ?? ""} ${o.jurisdiction ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, approvalFilter, statusFilter, q]);

  return (
    <div className="p-6 space-y-4" data-testid="fw-admin-organisations">
      <div>
        <h1 className="text-2xl font-semibold">Funder Organisations</h1>
        <p className="text-sm text-muted-foreground">Approved and pending funder organisations.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="text-xs text-muted-foreground">Search</label>
          <Input placeholder="Name, email, jurisdiction" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Approval status</label>
          <Select value={approvalFilter} onValueChange={setApprovalFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="admin_created">Admin created</SelectItem>
              <SelectItem value="requested">Requested</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Organisation status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">Failed to load: {error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{filtered.length} organisation(s)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Registration</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Contact email</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell className="font-mono text-xs">{o.registration_number ?? "—"}</TableCell>
                  <TableCell>{o.jurisdiction ?? "—"}</TableCell>
                  <TableCell className="text-xs">{o.contact_email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={o.approval_status === "approved" ? "default" : o.approval_status === "rejected" ? "destructive" : "secondary"}>
                      {o.approval_status ?? "admin_created"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={o.status === "active" ? "default" : "secondary"}>{o.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{o.approved_at ? new Date(o.approved_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(o.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Link to={`/admin/funder-workspace/organisations/${o.id}`} className="text-sm underline">
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {rows !== null && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                    No funder organisations match the filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
