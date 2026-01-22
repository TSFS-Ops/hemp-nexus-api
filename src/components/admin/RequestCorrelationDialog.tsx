import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";

type AuditLogItem = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: any;
};

type AuditLogsResponse = {
  items: AuditLogItem[];
  totalCount: number;
};

function actionVariant(action: string) {
  if (action === "intent.confirmed") return "default" as const;
  if (action === "intent.denied") return "destructive" as const;
  return "secondary" as const;
}

export function RequestCorrelationDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string | null;
}) {
  const { open, onOpenChange, requestId } = props;
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AuditLogItem[]>([]);

  const canFetch = useMemo(() => Boolean(open && requestId), [open, requestId]);

  useEffect(() => {
    if (!canFetch) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setItems([]);

        const { data, error } = await supabase.functions.invoke(
          `audit-logs?request_id=${encodeURIComponent(requestId!)}&limit=50`,
          { method: "GET" }
        );

        if (error) throw error;

        const parsed = (data || {}) as Partial<AuditLogsResponse>;
        if (!cancelled) setItems(parsed.items || []);
      } catch (e) {
        console.error("Failed to fetch correlated audit logs", e);
        toast.error("Failed to load correlated audit logs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canFetch, requestId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Correlated Audit Logs</DialogTitle>
          <DialogDescription className="break-all">
            Request ID: {requestId || "-"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">No correlated audit entries found.</div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Entity ID</TableHead>
                  <TableHead>Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs">
                      {format(new Date(log.created_at), "MMM dd, HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionVariant(log.action)}>{log.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{log.entity_type}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.entity_id ? `${log.entity_id.slice(0, 8)}…` : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.metadata?.hash ? `${String(log.metadata.hash).slice(0, 10)}…` : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
