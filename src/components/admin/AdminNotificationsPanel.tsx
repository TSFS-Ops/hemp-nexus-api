import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Eye, Plus, Edit } from "lucide-react";
import { toast } from "sonner";

export function AdminNotificationsPanel() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) toast.error(error.message);
    else setNotifications(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{notifications.length} notification(s) | {notifications.filter(n => !n.read).length} unread</p>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Type</TableHead><TableHead>Title</TableHead><TableHead>User</TableHead><TableHead>Read</TableHead><TableHead>Created</TableHead><TableHead className="w-16">Detail</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {notifications.map((n) => (
              <TableRow key={n.id}>
                <TableCell><Badge variant="outline" className="text-xs">{n.type || "general"}</Badge></TableCell>
                <TableCell className="text-sm max-w-[200px] truncate">{n.title || n.message?.substring(0, 40) || "N/A"}</TableCell>
                <TableCell className="font-mono text-xs">{(n.user_id || "").substring(0, 8)}...</TableCell>
                <TableCell><Badge variant={n.read ? "secondary" : "default"} className="text-xs">{n.read ? "Read" : "Unread"}</Badge></TableCell>
                <TableCell className="text-xs">{new Date(n.created_at).toLocaleString()}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(n)}><Eye className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {notifications.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No notifications found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Notification Detail</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{selected.id}</span></div>
              <div><span className="text-muted-foreground">Type:</span> {selected.type || "general"}</div>
              <div><span className="text-muted-foreground">Title:</span> {selected.title || "N/A"}</div>
              <div><span className="text-muted-foreground">Message:</span> {selected.message || "N/A"}</div>
              <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{selected.user_id}</span></div>
              <div><span className="text-muted-foreground">Read:</span> {selected.read ? "Yes" : "No"}</div>
              <div><span className="text-muted-foreground">Created:</span> {new Date(selected.created_at).toLocaleString()}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
