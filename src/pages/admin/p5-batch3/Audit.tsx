/**
 * P-5 Batch 3 — Stage 4 audit & download admin view (read-only).
 */
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface AuditRow {
  event_id: string;
  occurred_at: string;
  actor: string;
  funder_org: string;
  role: string;
  action: string;
  transaction_ref: string;
  object_type: string;
  prior_state: string | null;
  new_state: string | null;
  source: string;
  outcome: "success" | "failure";
  correlation_id: string;
}

interface DownloadRow {
  download_id: string;
  file_name: string;
  file_type: string;
  pack_version: string;
  watermark: string;
  expires_at: string;
  state: "active" | "expired" | "revoked";
}

const AUDIT_PLACEHOLDER: AuditRow[] = [
  {
    event_id: "evt-1",
    occurred_at: "2026-06-25T08:11:00Z",
    actor: "admin@izenzo",
    funder_org: "Example Funder A",
    role: "platform_admin",
    action: "grant.created",
    transaction_ref: "TXN-2026-0011",
    object_type: "access_grant",
    prior_state: null,
    new_state: "active",
    source: "admin_ui",
    outcome: "success",
    correlation_id: "cor-1",
  },
];

const DOWNLOADS_PLACEHOLDER: DownloadRow[] = [
  {
    download_id: "dl-1",
    file_name: "evidence-pack-v3.pdf",
    file_type: "pdf",
    pack_version: "v3",
    watermark: "Funder A · approver@example.com · 2026-06-25",
    expires_at: "2026-07-02T08:11:00Z",
    state: "active",
  },
];

export default function P5Batch3Audit() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <Link to="/admin/p5-batch3" className="text-sm text-muted-foreground underline">← Funder Workflow</Link>
        <h1 className="text-2xl font-semibold mt-1">Audit & Downloads</h1>
        <p className="text-sm text-muted-foreground">Read-only. Events and downloads are immutable.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit events</CardTitle>
          <CardDescription>All material funder-workflow actions are recorded server-side.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event ID</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Funder org</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead>Object</TableHead>
                <TableHead>Prior → New</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Correlation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AUDIT_PLACEHOLDER.map((e) => (
                <TableRow key={e.event_id}>
                  <TableCell className="font-mono text-xs">{e.event_id}</TableCell>
                  <TableCell className="text-xs">{e.occurred_at}</TableCell>
                  <TableCell>{e.actor}</TableCell>
                  <TableCell>{e.funder_org}</TableCell>
                  <TableCell>{e.role}</TableCell>
                  <TableCell>{e.action}</TableCell>
                  <TableCell className="font-mono text-xs">{e.transaction_ref}</TableCell>
                  <TableCell>{e.object_type}</TableCell>
                  <TableCell className="text-xs">{e.prior_state ?? "—"} → {e.new_state ?? "—"}</TableCell>
                  <TableCell>{e.source}</TableCell>
                  <TableCell>
                    <Badge variant={e.outcome === "success" ? "default" : "destructive"}>{e.outcome}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.correlation_id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Document downloads</CardTitle>
          <CardDescription>Watermarked, expiring PDFs only. No raw document API.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Download ID</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Pack version</TableHead>
                <TableHead>Watermark</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DOWNLOADS_PLACEHOLDER.map((d) => (
                <TableRow key={d.download_id}>
                  <TableCell className="font-mono text-xs">{d.download_id}</TableCell>
                  <TableCell>{d.file_name}</TableCell>
                  <TableCell>{d.file_type}</TableCell>
                  <TableCell>{d.pack_version}</TableCell>
                  <TableCell className="text-xs">{d.watermark}</TableCell>
                  <TableCell className="text-xs">{d.expires_at}</TableCell>
                  <TableCell>
                    <Badge variant={d.state === "active" ? "default" : "secondary"}>{d.state}</Badge>
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
