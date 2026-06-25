/**
 * P-5 Batch 3 — Stage 4 Funder Request queue + multi-funder overview.
 *
 * All decisions (approve/reject/assign/close) are issued through RPC
 * wrappers. The funder's original message is preserved server-side; this
 * UI surfaces it read-only alongside the admin-edited external wording.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  p5b3DecideRequest,
  p5b3EditRequestExternalText,
} from "@/lib/p5-batch3/rpc";
import {
  P5B3_REQUEST_STATUSES,
  type P5B3RequestStatus,
} from "@/lib/p5-batch3/constants";
import { P5B3ReasonedActionDialog } from "./components/P5B3ReasonedActionDialog";

interface RequestRow {
  id: string;
  funder_org: string;
  funder_user: string;
  transaction_ref: string;
  category: string;
  status: P5B3RequestStatus;
  original_message: string;
  admin_external_message: string | null;
  last_activity: string;
}

const PLACEHOLDER_REQUESTS: RequestRow[] = [
  {
    id: "req-1",
    funder_org: "Example Funder A",
    funder_user: "approver@example.com",
    transaction_ref: "TXN-2026-0011",
    category: "financial",
    status: "submitted",
    original_message: "Please confirm aged debtors profile.",
    admin_external_message: null,
    last_activity: "2026-06-25T08:11:00Z",
  },
  {
    id: "req-2",
    funder_org: "Example Funder B",
    funder_user: "viewer@example.com",
    transaction_ref: "TXN-2026-0014",
    category: "legal",
    status: "admin_review",
    original_message: "Material contract for offtaker?",
    admin_external_message: "Material commercial contract for the named offtaker.",
    last_activity: "2026-06-25T07:50:00Z",
  },
];

const STATUS_FILTERS: P5B3RequestStatus[] = [...P5B3_REQUEST_STATUSES];

export default function P5Batch3Requests() {
  const [filter, setFilter] = useState<P5B3RequestStatus | "all">("all");
  const [requests, setRequests] = useState<RequestRow[]>(PLACEHOLDER_REQUESTS);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);

  const doDecision = async (id: string, decision: "approve" | "reject" | "assign" | "close", reason: string) => {
    await p5b3DecideRequest({ p_request_id: id, p_decision: decision, p_reason: reason });
    toast.success(`Request ${decision}d`);
  };

  const saveExternal = async (id: string) => {
    if (editText.trim().length < 4) {
      toast.error("External wording required");
      return;
    }
    try {
      await p5b3EditRequestExternalText({ p_request_id: id, p_admin_external_message: editText.trim() });
      setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, admin_external_message: editText.trim() } : r)));
      toast.success("External wording updated");
      setEditing(null);
      setEditText("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link to="/admin/p5-batch3" className="text-sm text-muted-foreground underline">← Funder Workflow</Link>
        <h1 className="text-2xl font-semibold mt-1">Funder Requests</h1>
        <p className="text-sm text-muted-foreground">
          One funder's decision does not affect any other funder. Funder approval is not finality;
          admin review is required before any finality impact is considered.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue</CardTitle>
          <CardDescription>Original funder text is preserved server-side and shown verbatim.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              className={`border rounded px-2 py-1 ${filter === "all" ? "bg-muted" : ""}`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                className={`border rounded px-2 py-1 ${filter === s ? "bg-muted" : ""}`}
                onClick={() => setFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Funder</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="text-sm">{r.funder_org}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.funder_user}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.transaction_ref}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.last_activity}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(r.id); setEditText(r.admin_external_message ?? ""); }}>
                      Edit external wording
                    </Button>
                    <P5B3ReasonedActionDialog
                      trigger={<Button size="sm" variant="outline">Approve</Button>}
                      title="Approve request"
                      onConfirm={(reason) => doDecision(r.id, "approve", reason)}
                    />
                    <P5B3ReasonedActionDialog
                      trigger={<Button size="sm" variant="outline">Reject</Button>}
                      title="Reject request"
                      onConfirm={(reason) => doDecision(r.id, "reject", reason)}
                    />
                    <P5B3ReasonedActionDialog
                      trigger={<Button size="sm" variant="outline">Close</Button>}
                      title="Close request"
                      onConfirm={(reason) => doDecision(r.id, "close", reason)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit external wording</CardTitle>
            <CardDescription>
              The funder's original text is preserved separately and remains visible in audit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs">
              <div className="text-muted-foreground">Original (preserved in audit):</div>
              <div className="font-mono mt-1">
                {requests.find((r) => r.id === editing)?.original_message}
              </div>
            </div>
            <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setEditing(null); setEditText(""); }}>Cancel</Button>
              <Button onClick={() => saveExternal(editing)}>Save</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Multi-Funder Overview</CardTitle>
          <CardDescription>
            Per-funder status side by side. Funder approval does not equal finality; admin review is required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Funder</TableHead>
                <TableHead>Funder user</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead>Pack version</TableHead>
                <TableHead>Funder status</TableHead>
                <TableHead>Admin review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Example Funder A</TableCell>
                <TableCell className="text-xs font-mono">approver@example.com</TableCell>
                <TableCell className="text-xs font-mono">TXN-2026-0011</TableCell>
                <TableCell>v3</TableCell>
                <TableCell><Badge>interested</Badge></TableCell>
                <TableCell><Badge variant="secondary">pending admin review</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Example Funder B</TableCell>
                <TableCell className="text-xs font-mono">viewer@example.com</TableCell>
                <TableCell className="text-xs font-mono">TXN-2026-0011</TableCell>
                <TableCell>v3</TableCell>
                <TableCell><Badge variant="secondary">declined</Badge></TableCell>
                <TableCell><Badge variant="secondary">no finality impact</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
