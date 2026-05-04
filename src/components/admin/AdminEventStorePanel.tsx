import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Eye, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

const EVENT_LIMIT = 200;

export function AdminEventStorePanel() {
  const [events, setEvents] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const [countRes, dataRes] = await Promise.all([
        supabase.from("event_store").select("id", { count: "exact", head: true }),
        supabase.from("event_store").select("*").order("occurred_at", { ascending: false }).limit(EVENT_LIMIT),
      ]);
      setTotal(countRes.count);
      if (dataRes.error) throw dataRes.error;
      setEvents(dataRes.data || []);
    } catch (err) {
      console.error("Failed to fetch events:", err);
      toast.error("Failed to load event store");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Showing {events.length}{total !== null ? ` of ${total}` : ""} event(s) (append-only, immutable)
      </p>
      {total !== null && total > EVENT_LIMIT && events.length >= EVENT_LIMIT && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Showing the most recent {EVENT_LIMIT} of {total} events. Older events are not displayed here — query the event store directly to see them.
          </AlertDescription>
        </Alert>
      )}
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Event Type</TableHead><TableHead>Entity</TableHead><TableHead>Hash</TableHead><TableHead>Created</TableHead><TableHead className="w-16">Detail</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell><Badge variant="outline" className="text-xs">{e.event_type}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{(e.entity_id || "N/A").substring(0, 12)}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{(e.payload_hash || "").substring(0, 12)}...</TableCell>
                <TableCell className="text-xs">{e.occurred_at ? new Date(e.occurred_at).toLocaleString() : "—"}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(e)}><Eye className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {events.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No events recorded.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Event Detail (Immutable)</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{selected.id}</span></div>
              <div><span className="text-muted-foreground">Type:</span> {selected.event_type}</div>
              <div><span className="text-muted-foreground">Entity:</span> <span className="font-mono">{selected.entity_id || "N/A"}</span></div>
              <div><span className="text-muted-foreground">Payload Hash:</span> <span className="font-mono text-xs break-all">{selected.payload_hash || "N/A"}</span></div>
              <div><span className="text-muted-foreground">Previous Hash:</span> <span className="font-mono text-xs break-all">{selected.previous_event_hash || "Genesis"}</span></div>
              <div><span className="text-muted-foreground">Actor:</span> <span className="font-mono text-xs">{selected.actor_user_id || "System"}</span></div>
              <div><span className="text-muted-foreground">Created:</span> {new Date(selected.created_at).toLocaleString()}</div>
              {selected.event_data && (
                <div>
                  <span className="text-muted-foreground">Data:</span>
                  <pre className="mt-1 p-2 bg-muted rounded text-xs font-mono overflow-auto max-h-40">{JSON.stringify(selected.event_data, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}