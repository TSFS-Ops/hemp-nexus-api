import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Download, ShieldAlert, Search } from "lucide-react";
import { EmptyState } from "@/components/ui/error-state";
import { format } from "date-fns";
import { toast } from "sonner";
import { downloadCSV } from "@/lib/download-utils";
import { WaiverPacketDownloadButton } from "@/components/match/WaiverPacketDownloadButton";

interface WaiverRow {
  id: string;
  created_at: string;
  org_id: string;
  entity_id: string | null;
  actor_user_id: string | null;
  metadata: {
    document_count?: number;
    notes_count?: number;
    waiver_reason?: string;
    [key: string]: unknown;
  } | null;
}

const PAGE_SIZE = 100;

export function AdminEvidenceWaiversPanel() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-evidence-waivers", page],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("audit_logs")
        .select("id, created_at, org_id, entity_id, actor_user_id, metadata", { count: "exact" })
        .eq("action", "poi.evidence_waiver_acknowledged")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      return { rows: (data as WaiverRow[]) || [], totalCount: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const filtered = search.trim()
    ? rows.filter((r) => {
        const q = search.toLowerCase();
        return (
          r.entity_id?.toLowerCase().includes(q) ||
          r.org_id?.toLowerCase().includes(q) ||
          r.actor_user_id?.toLowerCase().includes(q) ||
          r.metadata?.waiver_reason?.toLowerCase().includes(q)
        );
      })
    : rows;

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error("No waiver records to export");
      return;
    }
    const headers = ["Match ID", "Org ID", "Actor User ID", "Documents", "Notes", "Reason", "Waived At"];
    const csvRows = filtered.map((r) => [
      r.entity_id || "",
      r.org_id || "",
      r.actor_user_id || "",
      String(r.metadata?.document_count ?? 0),
      String(r.metadata?.notes_count ?? 0),
      r.metadata?.waiver_reason || "",
      r.created_at,
    ]);
    downloadCSV(headers, csvRows, `evidence-waivers-${new Date().toISOString().split("T")[0]}.csv`);
    toast.success(`Exported ${filtered.length} waiver records`);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">POI Evidence Waivers</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Audit trail of every POI minted without supporting documents and notes. Each entry is an
            explicit, signed acknowledgement by the initiating user.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 sm:mr-2 ${isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        </div>
      </div>

      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <h4 className="font-semibold text-amber-800 dark:text-amber-200">
                Light-evidence POI commitments
              </h4>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                These entries record every Proof-of-Intent that was minted with{" "}
                <strong>zero supporting documents and zero notes</strong>. The user provided an
                explicit waiver reason before credits were burned.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waiver Records</CardTitle>
          <CardDescription>
            {totalCount > 0
              ? `${totalCount} acknowledged waiver${totalCount === 1 ? "" : "s"} on record`
              : "No waivers recorded yet"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by match, org, user, or reason..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              aria-label="Filter waivers"
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No waiver entries"
              message={
                search
                  ? "No records match the current filter."
                  : "POI commitments without docs or notes will appear here."
              }
            />
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {filtered.map((r) => (
                  <div key={r.id} className="border rounded-lg p-3 space-y-2 bg-card">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {r.entity_id?.substring(0, 8)}...
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(r.created_at), "MMM dd HH:mm")}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="secondary">Docs: {r.metadata?.document_count ?? 0}</Badge>
                      <Badge variant="secondary">Notes: {r.metadata?.notes_count ?? 0}</Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Reason</p>
                      <p className="text-sm">{r.metadata?.waiver_reason || "—"}</p>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      Actor: {r.actor_user_id?.substring(0, 8) || "—"}...
                    </div>
                    <WaiverPacketDownloadButton
                      waiverId={r.id}
                      label="Download packet"
                      className="w-full"
                    />
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="rounded-md border hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Match ID</TableHead>
                      <TableHead>Org</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead className="text-center">Docs</TableHead>
                      <TableHead className="text-center">Notes</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Waived At</TableHead>
                      <TableHead className="text-right">Packet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">
                          {r.entity_id?.substring(0, 12) || "—"}...
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.org_id?.substring(0, 8)}...
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.actor_user_id?.substring(0, 8) || "—"}...
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={r.metadata?.document_count ? "secondary" : "outline"}
                            className="font-mono"
                          >
                            {r.metadata?.document_count ?? 0}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={r.metadata?.notes_count ? "secondary" : "outline"}
                            className="font-mono"
                          >
                            {r.metadata?.notes_count ?? 0}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <p className="text-sm truncate" title={r.metadata?.waiver_reason || ""}>
                            {r.metadata?.waiver_reason || "—"}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {format(new Date(r.created_at), "MMM dd, yyyy HH:mm:ss")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages} · {totalCount} total
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0 || isFetching}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1 || isFetching}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
