import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export function AdminEmailLogsPanel() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("email_send_log").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) toast.error(error.message);
    else setLogs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const statusColor = (s: string) => s === "sent" ? "default" : s === "failed" ? "destructive" : "secondary";

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{logs.length} email(s) | {logs.filter(l => l.status === "failed").length} failed</p>
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
