import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

const EMAIL_LOG_LIMIT = 200;

export function AdminEmailLogsPanel() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const [countRes, dataRes] = await Promise.all([
      supabase.from("email_send_log").select("id", { count: "exact", head: true }),
      supabase.from("email_send_log").select("*").order("created_at", { ascending: false }).limit(EMAIL_LOG_LIMIT),
    ]);
    setTotal(countRes.count);
    if (dataRes.error) toast.error(dataRes.error.message);
    else setLogs(dataRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const statusColor = (s: string) => s === "sent" ? "default" : s === "failed" ? "destructive" : "secondary";

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{logs.length} email(s) | {logs.filter(l => l.status === "failed").length} failed</p>
      {total !== null && logs.length >= EMAIL_LOG_LIMIT && (
        <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Showing {logs.length} of {total} emails. Results are capped at {EMAIL_LOG_LIMIT}.</AlertDescription></Alert>
      )}
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Template</TableHead><TableHead>Recipient</TableHead><TableHead>Status</TableHead><TableHead>Message ID</TableHead><TableHead>Sent</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-sm font-medium">{l.template_name}</TableCell>
                <TableCell className="text-xs">{l.recipient_email}</TableCell>
                <TableCell><Badge variant={statusColor(l.status)} className="text-xs">{l.status}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{l.message_id ? l.message_id.substring(0, 12) + "..." : "N/A"}</TableCell>
                <TableCell className="text-xs">{new Date(l.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No email logs found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
